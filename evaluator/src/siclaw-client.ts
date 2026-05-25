/**
 * Drives siclaw via Portal's public REST API. Zero-intrusion: the evaluator
 * never touches siclaw internals — it acts as a regular authenticated user.
 *
 * Flow per design §3.4.4:
 *   1. POST /api/v1/siclaw/agents/:id/chat/sessions  → fresh sessionId
 *   2. POST /api/v1/siclaw/agents/:id/chat/send  (SSE) → wait until
 *      `done` event or `prompt_done` chat.event
 *
 * The session-tag prefix `[EVAL:<case>:<run>]` is prepended to the prompt so
 * any downstream tooling can also recognise eval sessions in the chat-repo.
 */

export interface SiclawClientConfig {
  /** Base URL of siclaw Portal, e.g. http://siclaw-portal:3005 */
  portalUrl: string;
  /** Pre-minted JWT for the eval user. */
  jwt: string;
}

export class SiclawClient {
  constructor(private readonly cfg: SiclawClientConfig) {}

  /** Creates a chat session and returns its id. */
  async createSession(agentId: string, title: string): Promise<string> {
    const url = `${this.cfg.portalUrl}/api/v1/siclaw/agents/${encodeURIComponent(agentId)}/chat/sessions`;
    const res = await fetch(url, {
      method: "POST",
      headers: this.authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ title }),
    });
    if (!res.ok) {
      throw new Error(`createSession failed: HTTP ${res.status} ${await safeText(res)}`);
    }
    const body = (await res.json()) as { id?: string };
    if (!body.id) {
      throw new Error(`createSession returned no id: ${JSON.stringify(body)}`);
    }
    return body.id;
  }

  /**
   * Sends a prompt and waits for the SSE stream to close with `done`. Returns
   * a small struct so callers can do their own timing.
   *
   * The signal aborts the underlying fetch; useful to enforce ttl_sec.
   */
  async sendAndWait(opts: {
    agentId: string;
    sessionId: string;
    text: string;
    signal?: AbortSignal;
  }): Promise<{ doneAt: number; events: number }> {
    const url = `${this.cfg.portalUrl}/api/v1/siclaw/agents/${encodeURIComponent(opts.agentId)}/chat/send`;
    const res = await fetch(url, {
      method: "POST",
      headers: this.authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ text: opts.text, session_id: opts.sessionId }),
      signal: opts.signal,
    });
    if (!res.ok || !res.body) {
      throw new Error(`chat/send failed: HTTP ${res.status} ${await safeText(res)}`);
    }
    return await this.consumeSSE(res.body, opts.signal);
  }

  /**
   * Parses an SSE stream until the canonical `done` event fires. Tolerant of
   * partial frames across chunk boundaries. Counts events for trace metrics.
   */
  private async consumeSSE(
    body: ReadableStream<Uint8Array>,
    signal?: AbortSignal,
  ): Promise<{ doneAt: number; events: number }> {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    let events = 0;
    let done = false;
    let doneAt = 0;

    try {
      while (!done) {
        if (signal?.aborted) throw new Error("aborted");
        const { value, done: streamDone } = await reader.read();
        if (streamDone) break;
        buf += decoder.decode(value, { stream: true });
        // SSE frames separated by blank line. Process complete frames only.
        let idx = buf.indexOf("\n\n");
        while (idx !== -1) {
          const frame = buf.slice(0, idx);
          buf = buf.slice(idx + 2);
          const evt = parseSseFrame(frame);
          if (evt) {
            events++;
            if (evt.event === "done") {
              done = true;
              doneAt = Date.now();
              break;
            }
            if (evt.event === "chat.event") {
              try {
                const data = JSON.parse(evt.data) as { type?: string };
                if (data.type === "prompt_done" || data.type === "done") {
                  done = true;
                  doneAt = Date.now();
                  break;
                }
              } catch {
                // ignore malformed inner frames; runtime will close eventually
              }
            }
          }
          idx = buf.indexOf("\n\n");
        }
      }
    } finally {
      // Best-effort release; ignore cancel errors if stream already closed.
      try { reader.releaseLock(); } catch { /* noop */ }
    }
    if (!done) doneAt = Date.now();
    return { doneAt, events };
  }

  /** List all agents accessible with the configured JWT. */
  async listAgents(): Promise<unknown> {
    const url = `${this.cfg.portalUrl}/api/v1/siclaw/agents?page_size=100`;
    const res = await fetch(url, { headers: this.authHeaders() });
    if (!res.ok) throw new Error(`listAgents failed: HTTP ${res.status}`);
    return res.json();
  }

  /** Fetch one page of messages for an eval session (proxied to Portal). */
  async getSessionMessages(
    agentId: string,
    sessionId: string,
    page = 1,
    pageSize = 200,
  ): Promise<unknown> {
    const url = `${this.cfg.portalUrl}/api/v1/siclaw/agents/${encodeURIComponent(agentId)}/chat/sessions/${encodeURIComponent(sessionId)}/messages?page=${page}&page_size=${pageSize}`;
    const res = await fetch(url, { headers: this.authHeaders() });
    if (!res.ok) throw new Error(`getSessionMessages failed: HTTP ${res.status}`);
    return res.json();
  }

  private authHeaders(extra: Record<string, string> = {}): Record<string, string> {
    return {
      Authorization: `Bearer ${this.cfg.jwt}`,
      ...extra,
    };
  }
}

interface SseEvent { event: string; data: string }

function parseSseFrame(raw: string): SseEvent | null {
  let event = "message";
  const dataLines: string[] = [];
  for (const line of raw.split("\n")) {
    if (line.startsWith("event:")) event = line.slice(6).trim();
    else if (line.startsWith("data:")) dataLines.push(line.slice(5).trimStart());
  }
  if (dataLines.length === 0) return null;
  return { event, data: dataLines.join("\n") };
}

async function safeText(res: Response): Promise<string> {
  try { return (await res.text()).slice(0, 500); } catch { return "<no body>"; }
}

/** The eval-session prompt tag, used for grep-style discovery in chat-repo. */
export function buildEvalPrompt(caseId: string, runId: string, prompt: string): string {
  return `[EVAL:${caseId}:${runId}] ${prompt}`;
}
