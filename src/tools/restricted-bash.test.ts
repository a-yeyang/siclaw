import { describe, it, expect } from "vitest";
import {
  validateKubectlInPipeline,
  extractCommands,
} from "./restricted-bash.js";

describe("credential protection in restricted-bash", () => {
  describe("kubectl config view --raw blocking", () => {
    it("blocks kubectl config view --raw", () => {
      const result = validateKubectlInPipeline(["kubectl config view --raw"]);
      expect(result).not.toBeNull();
      expect(result).toContain("not allowed");
    });

    it("blocks kubectl config view --raw with extra flags", () => {
      const result = validateKubectlInPipeline(["kubectl config view --raw -o json"]);
      expect(result).not.toBeNull();
    });

    it("allows kubectl config view (without --raw)", () => {
      const result = validateKubectlInPipeline(["kubectl config view"]);
      expect(result).toBeNull();
    });

    it("allows kubectl config get-contexts", () => {
      const result = validateKubectlInPipeline(["kubectl config get-contexts"]);
      expect(result).toBeNull();
    });
  });

  describe("sensitive path patterns", () => {
    const SENSITIVE_PATH_RE = [
      /\.siclaw\/config\/settings\.json/,
      /\.siclaw\/credentials\//,
      /\$\{?KUBECONFIG\}?/,
    ];

    it("matches .siclaw/credentials/ paths", () => {
      expect(SENSITIVE_PATH_RE.some((r) => r.test("cat .siclaw/credentials/prod.kubeconfig"))).toBe(true);
    });

    it("matches settings.json", () => {
      expect(SENSITIVE_PATH_RE.some((r) => r.test("grep apiKey .siclaw/config/settings.json"))).toBe(true);
    });

    it("matches $KUBECONFIG", () => {
      expect(SENSITIVE_PATH_RE.some((r) => r.test("cat $KUBECONFIG"))).toBe(true);
    });

    it("matches ${KUBECONFIG}", () => {
      expect(SENSITIVE_PATH_RE.some((r) => r.test("head ${KUBECONFIG}"))).toBe(true);
    });

    it("does not match normal kubectl commands", () => {
      expect(SENSITIVE_PATH_RE.some((r) => r.test("kubectl get pods -n default"))).toBe(false);
    });
  });
});
