import type { Decision } from '@padosoft/laravel-iam-node';

interface Entry {
  decision: Decision;
  expiresAt: number;
}

/**
 * Tiny in-memory TTL cache for decisions. Opt-in and off by default.
 *
 * React Native adaptation: uses canonical JSON string as the cache key
 * instead of SHA-256 (which requires `node:crypto`, unavailable in RN).
 * Semantics are identical to the Node SDK's DecisionCache.
 */
export class DecisionCache {
  private readonly ttlMs: number;
  private readonly maxEntries: number;
  private readonly store = new Map<string, Entry>();
  private policyVersion = 0;

  constructor(ttlMs: number, maxEntries = 1000) {
    this.ttlMs = ttlMs;
    this.maxEntries = maxEntries > 0 ? maxEntries : 1000;
  }

  get enabled(): boolean {
    return this.ttlMs > 0;
  }

  get(key: string): Decision | undefined {
    if (!this.enabled) return undefined;
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= Date.now()) {
      this.store.delete(key);
      return undefined;
    }
    return entry.decision;
  }

  set(key: string, decision: Decision): void {
    if (!this.enabled) return;

    if (decision.policyVersion > this.policyVersion) {
      this.policyVersion = decision.policyVersion;
      this.store.clear();
    }

    if (this.store.size >= this.maxEntries) {
      const oldest = this.store.keys().next().value;
      if (oldest !== undefined) this.store.delete(oldest);
    }

    this.store.set(key, { decision, expiresAt: Date.now() + this.ttlMs });
  }

  clear(): void {
    this.store.clear();
  }
}

/**
 * Stable, order-independent cache key from the full query payload.
 * Uses canonical JSON string directly (no SHA-256 / node:crypto).
 */
export function cacheKey(parts: unknown): string {
  return canonicalJson(parts);
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value ?? null);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(',')}]`;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(',')}}`;
}
