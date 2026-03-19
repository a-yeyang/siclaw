/**
 * Log line normalizer — strips Kubernetes log prefixes from raw log output
 * to extract the pure application log message.
 *
 * Supports four formats with multi-layer stripping:
 * 1. CRI prefix (containerd/CRI-O)
 * 2. klog header (Kubernetes standard logging)
 * 3. JSON structured log
 * 4. Plain text passthrough
 */

export interface NormalizeResult {
  /** The cleaned application log message */
  message: string;
  /** Log level extracted from klog header (I/W/E/F), or null if not detected */
  detectedLevel: "info" | "warning" | "error" | "fatal" | null;
}

type StandardLevel = "info" | "warning" | "error" | "fatal";

const KLOG_LEVEL_MAP: Record<string, StandardLevel> = {
  I: "info",
  W: "warning",
  E: "error",
  F: "fatal",
};

/** CRI log format: timestamp stream partialFlag message */
const CRI_PREFIX_RE =
  /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d+Z)\s+(stdout|stderr)\s+[FP]\s+/;

/** klog header: LevelMMDD HH:MM:SS.microseconds PID source:line] message */
const KLOG_HEADER_RE =
  /^([IWEF])(\d{4})\s+(\d{2}:\d{2}:\d{2}\.\d+)\s+(\d+)\s+([^:]+:\d+)\]\s+/;

/**
 * Normalize a JSON level string to a standard level enum value.
 * Returns null if unrecognized.
 */
function normalizeJsonLevel(raw: unknown): StandardLevel | null {
  if (typeof raw !== "string") return null;
  const lower = raw.toLowerCase();
  switch (lower) {
    case "info":
    case "information":
      return "info";
    case "warn":
    case "warning":
      return "warning";
    case "error":
    case "err":
      return "error";
    case "fatal":
    case "critical":
    case "panic":
      return "fatal";
    default:
      return null;
  }
}

/**
 * Strip K8s log prefixes from a raw log line and extract the application message.
 *
 * Multi-layer stripping order:
 * 1. CRI prefix (containerd/CRI-O format)
 * 2. klog header (Kubernetes standard logging)
 * 3. JSON structured log (terminal — no further layers)
 * 4. Plain text passthrough
 *
 * Layers 1 and 2 can stack. Layer 3 is attempted on the result after layers 1-2.
 */
export function normalizeLogLine(raw: string): NormalizeResult {
  let line = raw;
  let detectedLevel: StandardLevel | null = null;

  // Layer 1 — CRI prefix
  const criMatch = CRI_PREFIX_RE.exec(line);
  if (criMatch) {
    line = line.slice(criMatch[0].length);
  }

  // Layer 2 — klog header
  const klogMatch = KLOG_HEADER_RE.exec(line);
  if (klogMatch) {
    detectedLevel = KLOG_LEVEL_MAP[klogMatch[1]] ?? null;
    line = line.slice(klogMatch[0].length);
  }

  // Layer 3 — JSON structured log
  try {
    const parsed: unknown = JSON.parse(line);
    if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
      const obj = parsed as Record<string, unknown>;
      const msg = obj["msg"] ?? obj["message"];
      if (typeof msg === "string") {
        const jsonLevel = normalizeJsonLevel(obj["level"]);
        return {
          message: msg,
          detectedLevel: jsonLevel ?? detectedLevel,
        };
      }
    }
  } catch {
    // Not JSON — fall through to plain text
  }

  // Layer 4 — plain text passthrough
  return { message: line, detectedLevel };
}
