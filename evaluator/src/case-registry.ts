/**
 * In-memory case registry. v0 only — v1 swaps to SQLite per design §3.6.
 */

import type { Case } from "./types.js";

export class CaseRegistry {
  private cases = new Map<string, Case>();

  upsert(c: Case): void {
    this.cases.set(c.id, c);
  }

  get(id: string): Case | undefined {
    return this.cases.get(id);
  }

  list(): Case[] {
    return [...this.cases.values()];
  }

  has(id: string): boolean {
    return this.cases.has(id);
  }

  delete(id: string): boolean {
    return this.cases.delete(id);
  }
}
