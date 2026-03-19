import { describe, it, expect } from "vitest";
import { normalizeLogLine } from "./normalizer.js";

describe("normalizeLogLine", () => {
  describe("CRI format", () => {
    it("strips CRI prefix from stdout line", () => {
      const result = normalizeLogLine(
        "2024-01-15T10:30:00.123456789Z stdout F pod crashed"
      );
      expect(result.message).toBe("pod crashed");
      expect(result.detectedLevel).toBeNull();
    });

    it("strips CRI prefix from stderr line", () => {
      const result = normalizeLogLine(
        "2024-01-15T10:30:00.123456789Z stderr F error occurred"
      );
      expect(result.message).toBe("error occurred");
      expect(result.detectedLevel).toBeNull();
    });

    it("strips CRI prefix with partial flag P", () => {
      const result = normalizeLogLine(
        "2024-01-15T10:30:00.123456789Z stdout P partial message"
      );
      expect(result.message).toBe("partial message");
      expect(result.detectedLevel).toBeNull();
    });
  });

  describe("klog header", () => {
    it("strips klog info header and detects level", () => {
      const result = normalizeLogLine(
        "I0115 10:30:00.123456 12345 controller.go:42] reconcile completed"
      );
      expect(result.message).toBe("reconcile completed");
      expect(result.detectedLevel).toBe("info");
    });

    it("strips klog error header and detects level", () => {
      const result = normalizeLogLine(
        "E0115 10:30:00.123456 12345 sync.go:99] failed to sync pod"
      );
      expect(result.message).toBe("failed to sync pod");
      expect(result.detectedLevel).toBe("error");
    });

    it("strips klog warning header and detects level", () => {
      const result = normalizeLogLine(
        "W0220 14:05:33.789012 9999 handler.go:15] deprecated API called"
      );
      expect(result.message).toBe("deprecated API called");
      expect(result.detectedLevel).toBe("warning");
    });

    it("strips klog fatal header and detects level", () => {
      const result = normalizeLogLine(
        "F0101 00:00:00.000000 1 main.go:1] process exiting"
      );
      expect(result.message).toBe("process exiting");
      expect(result.detectedLevel).toBe("fatal");
    });
  });

  describe("CRI + klog stacked", () => {
    it("strips both CRI and klog prefixes", () => {
      const result = normalizeLogLine(
        "2024-01-15T10:30:00.123456789Z stderr F E0115 10:30:00.123456 12345 main.go:10] startup failed"
      );
      expect(result.message).toBe("startup failed");
      expect(result.detectedLevel).toBe("error");
    });

    it("strips CRI + klog info stacked", () => {
      const result = normalizeLogLine(
        "2024-01-15T10:30:00.123456789Z stdout F I0115 10:30:00.123456 12345 controller.go:42] all good"
      );
      expect(result.message).toBe("all good");
      expect(result.detectedLevel).toBe("info");
    });
  });

  describe("JSON structured log", () => {
    it("extracts msg field from JSON", () => {
      const result = normalizeLogLine(
        '{"level":"error","msg":"connection refused","ts":"2024-01-15T10:30:00Z"}'
      );
      expect(result.message).toBe("connection refused");
      expect(result.detectedLevel).toBe("error");
    });

    it("extracts message field from JSON", () => {
      const result = normalizeLogLine(
        '{"level":"info","message":"server started","port":8080}'
      );
      expect(result.message).toBe("server started");
      expect(result.detectedLevel).toBe("info");
    });

    it("prefers msg over message when both present", () => {
      const result = normalizeLogLine(
        '{"level":"warn","msg":"primary","message":"secondary"}'
      );
      expect(result.message).toBe("primary");
      expect(result.detectedLevel).toBe("warning");
    });

    it("normalizes uppercase level strings", () => {
      const result = normalizeLogLine(
        '{"level":"ERROR","msg":"something broke"}'
      );
      expect(result.detectedLevel).toBe("error");
    });

    it("normalizes warn to warning", () => {
      const result = normalizeLogLine(
        '{"level":"warn","msg":"disk almost full"}'
      );
      expect(result.detectedLevel).toBe("warning");
    });

    it("returns null level for unrecognized level string", () => {
      const result = normalizeLogLine(
        '{"level":"verbose","msg":"detailed trace"}'
      );
      expect(result.message).toBe("detailed trace");
      expect(result.detectedLevel).toBeNull();
    });

    it("falls through to plain text if JSON has no msg/message field", () => {
      const json = '{"level":"info","data":"something"}';
      const result = normalizeLogLine(json);
      expect(result.message).toBe(json);
      expect(result.detectedLevel).toBeNull();
    });
  });

  describe("CRI + JSON stacked", () => {
    it("strips CRI prefix then parses JSON body", () => {
      const result = normalizeLogLine(
        '2024-01-15T10:30:00.123456789Z stdout F {"level":"error","msg":"timeout waiting for pod"}'
      );
      expect(result.message).toBe("timeout waiting for pod");
      expect(result.detectedLevel).toBe("error");
    });
  });

  describe("plain text passthrough", () => {
    it("returns raw line unchanged for plain text", () => {
      const result = normalizeLogLine("some random log line");
      expect(result.message).toBe("some random log line");
      expect(result.detectedLevel).toBeNull();
    });

    it("preserves whitespace in plain text", () => {
      const result = normalizeLogLine("  indented message  ");
      expect(result.message).toBe("  indented message  ");
      expect(result.detectedLevel).toBeNull();
    });
  });

  describe("edge cases", () => {
    it("handles empty string", () => {
      const result = normalizeLogLine("");
      expect(result.message).toBe("");
      expect(result.detectedLevel).toBeNull();
    });

    it("handles klog-like line without proper format (no closing bracket)", () => {
      const result = normalizeLogLine("I0115 not a real klog line");
      // Does not match klog regex (missing PID, source:line, and ])
      expect(result.message).toBe("I0115 not a real klog line");
      expect(result.detectedLevel).toBeNull();
    });

    it("handles JSON array (not an object)", () => {
      const result = normalizeLogLine('[1, 2, 3]');
      expect(result.message).toBe("[1, 2, 3]");
      expect(result.detectedLevel).toBeNull();
    });

    it("handles JSON null", () => {
      const result = normalizeLogLine("null");
      expect(result.message).toBe("null");
      expect(result.detectedLevel).toBeNull();
    });

    it("klog header with multiline — only first line has header", () => {
      // normalizeLogLine operates on a single line, so the first line is handled
      const result = normalizeLogLine(
        "I0115 10:30:00.123456 12345 controller.go:42] line one of multiline"
      );
      expect(result.message).toBe("line one of multiline");
      expect(result.detectedLevel).toBe("info");
    });

    it("klog + JSON stacked — klog level preserved if JSON has no level", () => {
      const result = normalizeLogLine(
        'I0115 10:30:00.123456 12345 controller.go:42] {"msg":"structured inside klog"}'
      );
      expect(result.message).toBe("structured inside klog");
      // klog level is preserved since JSON has no level field
      expect(result.detectedLevel).toBe("info");
    });

    it("CRI + klog + JSON all stacked", () => {
      const result = normalizeLogLine(
        '2024-01-15T10:30:00.123456789Z stdout F E0115 10:30:00.123456 12345 main.go:10] {"msg":"deeply nested"}'
      );
      expect(result.message).toBe("deeply nested");
      expect(result.detectedLevel).toBe("error");
    });
  });
});
