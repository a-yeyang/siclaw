import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { resolveRequiredKubeconfig } from "./kubeconfig-resolver.js";

describe("resolveRequiredKubeconfig", () => {
  let credDir: string;

  beforeEach(() => {
    credDir = mkdtempSync(join(tmpdir(), "kube-test-"));
  });

  afterEach(() => {
    rmSync(credDir, { recursive: true, force: true });
  });

  function writeManifest(entries: Array<{ name: string; type: string; files: string[] }>) {
    writeFileSync(join(credDir, "manifest.json"), JSON.stringify(entries));
    // Create dummy kubeconfig files
    for (const e of entries) {
      for (const f of e.files) {
        writeFileSync(join(credDir, f), "dummy");
      }
    }
  }

  it("returns null path when no credentialsDir", () => {
    const result = resolveRequiredKubeconfig(undefined, undefined);
    expect(result).toEqual({ path: null });
  });

  it("returns null path when no manifest.json", () => {
    const result = resolveRequiredKubeconfig(credDir, undefined);
    expect(result).toEqual({ path: null });
  });

  it("returns null path when no kubeconfig entries", () => {
    writeManifest([{ name: "ssh", type: "ssh_key", files: ["id_rsa"] }]);
    const result = resolveRequiredKubeconfig(credDir, undefined);
    expect(result).toEqual({ path: null });
  });

  it("errors on single kubeconfig without name — no auto-select", () => {
    writeManifest([{ name: "prod", type: "kubeconfig", files: ["prod.kubeconfig"] }]);
    const result = resolveRequiredKubeconfig(credDir, undefined);
    expect("error" in result).toBe(true);
    if ("error" in result) {
      expect(result.error).toContain("must specify the kubeconfig parameter");
      expect(result.availableNames).toEqual(["prod"]);
    }
  });

  it("resolves single kubeconfig by name", () => {
    writeManifest([{ name: "prod", type: "kubeconfig", files: ["prod.kubeconfig"] }]);
    const result = resolveRequiredKubeconfig(credDir, "prod");
    expect(result).toEqual({ path: join(credDir, "prod.kubeconfig") });
  });

  it("errors on multiple kubeconfigs without name", () => {
    writeManifest([
      { name: "prod", type: "kubeconfig", files: ["prod.kubeconfig"] },
      { name: "staging", type: "kubeconfig", files: ["staging.kubeconfig"] },
    ]);
    const result = resolveRequiredKubeconfig(credDir, undefined);
    expect("error" in result).toBe(true);
    if ("error" in result) {
      expect(result.error).toContain("must specify the kubeconfig parameter");
      expect(result.error).toContain("prod");
      expect(result.error).toContain("staging");
      expect(result.availableNames).toEqual(["prod", "staging"]);
    }
  });

  it("resolves by name when multiple kubeconfigs", () => {
    writeManifest([
      { name: "prod", type: "kubeconfig", files: ["prod.kubeconfig"] },
      { name: "staging", type: "kubeconfig", files: ["staging.kubeconfig"] },
    ]);
    const result = resolveRequiredKubeconfig(credDir, "staging");
    expect(result).toEqual({ path: join(credDir, "staging.kubeconfig") });
  });

  it("errors when name not found among multiple kubeconfigs", () => {
    writeManifest([
      { name: "prod", type: "kubeconfig", files: ["prod.kubeconfig"] },
      { name: "staging", type: "kubeconfig", files: ["staging.kubeconfig"] },
    ]);
    const result = resolveRequiredKubeconfig(credDir, "dev");
    expect("error" in result).toBe(true);
    if ("error" in result) {
      expect(result.error).toContain("not found");
      expect(result.error).toContain("dev");
      expect(result.availableNames).toEqual(["prod", "staging"]);
    }
  });

  it("errors when single kubeconfig + explicit name does not match", () => {
    writeManifest([{ name: "prod", type: "kubeconfig", files: ["prod.kubeconfig"] }]);
    const result = resolveRequiredKubeconfig(credDir, "staging");
    expect("error" in result).toBe(true);
    if ("error" in result) {
      expect(result.error).toContain("not found");
      expect(result.error).toContain("staging");
    }
  });

  it("errors on single kubeconfig with empty files array without name", () => {
    writeManifest([{ name: "empty", type: "kubeconfig", files: [] }]);
    const result = resolveRequiredKubeconfig(credDir, undefined);
    expect("error" in result).toBe(true);
    if ("error" in result) {
      expect(result.error).toContain("must specify the kubeconfig parameter");
    }
  });

  it("rejects path traversal in manifest file entries", () => {
    writeFileSync(
      join(credDir, "manifest.json"),
      JSON.stringify([{ name: "evil", type: "kubeconfig", files: ["../../etc/passwd"] }]),
    );
    const result = resolveRequiredKubeconfig(credDir, "evil");
    expect("error" in result).toBe(true);
    if ("error" in result) {
      expect(result.error).toContain("escapes credentials directory");
    }
  });

  it("errors on single kubeconfig among non-kubeconfig entries without name", () => {
    writeManifest([
      { name: "prod", type: "kubeconfig", files: ["prod.kubeconfig"] },
      { name: "ssh-key", type: "ssh_key", files: ["id_rsa"] },
    ]);
    const result = resolveRequiredKubeconfig(credDir, undefined);
    expect("error" in result).toBe(true);
    if ("error" in result) {
      expect(result.error).toContain("must specify the kubeconfig parameter");
    }
  });
});
