// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import type { ReactNode } from 'react';
import { IamClient, IamProvider, useDelegatedPermission } from '../src/index.js';
import { jsonResponse, mockFetch } from './helpers.js';

const BASE = 'https://iam.example.com/api/iam/v1';
const SUBJECT = { type: 'user', id: 'usr_1' } as const;
const CHAIN = ['agent:a1'];

function makeWrapper(client: IamClient, subject?: { type?: string; id: string }) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return createElement(IamProvider, { client, subject }, children);
  };
}

describe('useDelegatedPermission', () => {
  it('resolves to allowed when the PDP grants the delegated action', async () => {
    const { fetch, calls } = mockFetch(jsonResponse({ data: { allowed: true } }));
    const client = new IamClient({ baseUrl: BASE, fetch });

    const { result } = renderHook(
      () => useDelegatedPermission(CHAIN, 'orders.draft', { type: 'order', id: 'ord_1' }),
      { wrapper: makeWrapper(client, SUBJECT) },
    );

    expect(result.current).toEqual({ allowed: false, loading: true, requiresStepUp: false });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.allowed).toBe(true);
    expect(calls[0]?.url).toBe(`${BASE}/decisions/check-delegated`);
    expect(calls[0]?.body).toMatchObject({ actors: ['agent:a1'] });
  });

  it('denies while loading — loading is NEVER treated as allow', async () => {
    const { fetch } = mockFetch(jsonResponse({ data: { allowed: true } }));
    const client = new IamClient({ baseUrl: BASE, fetch });

    const { result } = renderHook(() => useDelegatedPermission(CHAIN, 'orders.draft'), {
      wrapper: makeWrapper(client, SUBJECT),
    });

    expect(result.current.allowed).toBe(false);
  });

  it('denies an empty actor chain without a network call', async () => {
    const { fetch, calls } = mockFetch(jsonResponse({ data: { allowed: true } }));
    const client = new IamClient({ baseUrl: BASE, fetch });

    const { result } = renderHook(() => useDelegatedPermission([], 'orders.draft'), {
      wrapper: makeWrapper(client, SUBJECT),
    });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.allowed).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it('denies without a subject, without a network call', async () => {
    const { fetch, calls } = mockFetch(jsonResponse({ data: { allowed: true } }));
    const client = new IamClient({ baseUrl: BASE, fetch });

    const { result } = renderHook(() => useDelegatedPermission(CHAIN, 'orders.draft'), {
      wrapper: makeWrapper(client),
    });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.allowed).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it('surfaces a pending step-up as not-allowed', async () => {
    const { fetch } = mockFetch(
      jsonResponse({ data: { allowed: true, requires_step_up: true, required_aal: 'aal2' } }),
    );
    const client = new IamClient({ baseUrl: BASE, fetch });

    const { result } = renderHook(() => useDelegatedPermission(CHAIN, 'orders.pay'), {
      wrapper: makeWrapper(client, SUBJECT),
    });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.allowed).toBe(false);
    expect(result.current.requiresStepUp).toBe(true);
  });

  it('denies on a transport error', async () => {
    const { fetch } = mockFetch(new Error('offline'));
    const client = new IamClient({ baseUrl: BASE, fetch });

    const { result } = renderHook(() => useDelegatedPermission(CHAIN, 'orders.draft'), {
      wrapper: makeWrapper(client, SUBJECT),
    });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.allowed).toBe(false);
  });
});
