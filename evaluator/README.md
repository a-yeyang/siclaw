# siclaw-evaluator

External, zero-intrusion skill-audit harness for siclaw. Borrowed methodology
from Microsoft AIOpsLab (⟨T, C, S⟩ formalism + fault-inject/recover pairing +
quantified metrics) but specialized for siclaw's read-only Kubernetes diagnosis
agent on GPU clusters.

> Design source of truth: `../../2026-05-22-skill-audit-eval-design.md`.

## What it does (v0)

1. Loads a **case YAML** describing a fault scenario and the oracle (must-use /
   must-not-use skills).
2. Injects the fault into the **`siclaw` namespace** with limited RBAC, waits
   for propagation, then asks siclaw (via Portal REST + SSE) to diagnose the
   incident. The prompt is tagged with `[EVAL:<case>:<run>]` so we can find the
   session in chat-repo without modifying siclaw.
3. Reads the message trace back from Portal's REST API, extracts every skill
   call from `local_script` / `pod_script` / `host_script` / `node_script` tool
   inputs, and scores:
   - `sufficiency = |used ∩ must_use| / |must_use|`
   - `necessity   = 1 − |used ∩ must_not_use| / |used|`
   - `noise_ratio = |used − (must_use ∪ may_use)| / |used|`
   - `skill_score = sufficiency × necessity`
   - plus TTL / steps / approximate output-tokens (chars/4)
4. **Unconditionally recovers** the fault, even on timeout/error.

## Scope explicitly excluded (deferred to v1/v2)

- LLM-as-Judge for RCA text
- GPU-specific faults (XID, NCCL hang, straggler)
- HTML report, CI integration
- Mitigation-class faults (siclaw is read-only)
- Any modification to siclaw `.ts` files

## Endpoints

| Method | Path                  | Purpose                              |
| ------ | --------------------- | ------------------------------------ |
| POST   | `/cases`              | Upload a case (YAML in request body) |
| POST   | `/runs?case=<id>`     | Execute the case immediately         |
| GET    | `/runs/:id`           | Fetch run report                     |
| GET    | `/metrics`            | Aggregated per-skill / per-case stats |

## Configuration (env)

| Var                    | Purpose                                                 |
| ---------------------- | ------------------------------------------------------- |
| `EVAL_PORT`            | HTTP port (default `8080`)                              |
| `PORTAL_URL`           | siclaw Portal base URL (e.g. `http://siclaw-portal:3005`) |
| `PORTAL_JWT`           | Pre-minted JWT for the eval user                        |
| `EVAL_NAMESPACE`       | Target namespace (default `siclaw`, **never** prod ns)  |
| `KUBECONFIG`           | Optional — defaults to in-cluster ServiceAccount        |

## Build & run

```bash
npm install
npm run build
npm start
```

Or via Docker (multi-stage Node 22, kubectl pre-installed):

```bash
docker build -f Dockerfile.evaluator -t siclaw-evaluator:latest .
docker run --rm -p 8080:8080 \
  -e PORTAL_URL=http://siclaw-portal:3005 \
  -e PORTAL_JWT=... \
  siclaw-evaluator:latest
```
