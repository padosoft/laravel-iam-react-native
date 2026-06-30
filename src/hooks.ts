import { useContext, useEffect, useState } from 'react';
import { isGranted } from './decision.js';
import { IamContext } from './provider.js';
import type { IamContextValue } from './provider.js';
import type { DecisionQuery, Resource } from '@padosoft/laravel-iam-node';
import type { PermissionState } from './types.js';

const DENIED_LOADING: PermissionState = { allowed: false, loading: true, requiresStepUp: false };
const DENIED_FINAL: PermissionState = { allowed: false, loading: false, requiresStepUp: false };

/**
 * Returns the {@link IamContextValue} from the nearest {@link IamProvider}.
 * Throws if called outside a provider.
 */
export function useIam(): IamContextValue {
  const ctx = useContext(IamContext);
  if (ctx === null) {
    throw new Error('useIam must be called inside <IamProvider>');
  }
  return ctx;
}

/**
 * Reactive permission check using a full {@link DecisionQuery}.
 * Fail-closed: returns `{ allowed: false, loading: true }` while the check is
 * in flight, and `{ allowed: false, loading: false }` on any error.
 */
export function useCan(query: DecisionQuery): PermissionState {
  const { client } = useIam();
  const [state, setState] = useState<PermissionState>(DENIED_LOADING);

  const queryKey = stableKey(query);

  useEffect(() => {
    let cancelled = false;
    setState(DENIED_LOADING);

    client
      .check(query)
      .then((decision) => {
        if (cancelled) return;
        setState({
          allowed: isGranted(decision),
          loading: false,
          requiresStepUp: decision.requiresStepUp,
        });
      })
      .catch(() => {
        if (!cancelled) setState(DENIED_FINAL);
      });

    return () => {
      cancelled = true;
    };
    // queryKey is a stable serialisation of query — used instead of query (unstable reference)
  }, [client, queryKey]);

  return state;
}

/**
 * Convenience hook: checks a single `permission` (and optionally a `resource`)
 * using the `subject` from the nearest {@link IamProvider}.
 *
 * Fail-closed: if no subject is available, denies immediately without hitting the network.
 */
export function usePermission(
  permission: string,
  resource?: Resource | string | null,
  extra?: Partial<Omit<DecisionQuery, 'permission' | 'resource' | 'subject'>>,
): PermissionState {
  const { client, subject } = useIam();
  const [state, setState] = useState<PermissionState>(DENIED_LOADING);

  const queryKey = stableKey({
    permission,
    resource: resource ?? null,
    subject: subject ?? null,
    extra: extra ?? {},
  });

  useEffect(() => {
    if (!subject || !subject.id) {
      setState(DENIED_FINAL);
      return;
    }

    let cancelled = false;
    setState(DENIED_LOADING);

    const q: DecisionQuery = {
      subject,
      permission,
      ...(resource != null ? { resource } : {}),
      ...(extra ?? {}),
    };

    client
      .check(q)
      .then((decision) => {
        if (cancelled) return;
        setState({
          allowed: isGranted(decision),
          loading: false,
          requiresStepUp: decision.requiresStepUp,
        });
      })
      .catch(() => {
        if (!cancelled) setState(DENIED_FINAL);
      });

    return () => {
      cancelled = true;
    };
    // queryKey is a stable serialisation of all query inputs
  }, [client, queryKey]);

  return state;
}

function stableKey(value: unknown): string {
  return canonicalJson(value);
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