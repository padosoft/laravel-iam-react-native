// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import type { ReactNode } from 'react';
import { IamClient, IamProvider, useIam, useCan, usePermission } from '../src/index.js';
import { jsonResponse, mockFetch } from './helpers.js';

const BASE = 'https://iam.example.com/api/iam/v1';

function makeWrapper(client: IamClient, subject?: { type?: string; id: string }) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return createElement(IamProvider, { client, subject }, children);
  };
}

const SUBJECT = { type: 'user', id: 'usr_1' } as const;

describe('useIam', () => {
  it('throws when used outside IamProvider', () => {
    expect(() => renderHook(() => useIam())).toThrow(
      'useIam must be called inside <IamProvider>',
    );
  });

  it('returns the client and subject from the provider', () => {
    const c = new IamClient({ baseUrl: BASE, fetch: mockFetch(new Response()).fetch });
    const { result } = renderHook(() => useIam(), {
      wrapper: makeWrapper(c, SUBJECT),
    });
    expect(result.current.client).toBe(c);
    expect(result.current.subject).toEqual(SUBJECT);
  });
});

describe('useCan', () => {
  it('starts with loading=true and allowed=false (fail-closed during loading)', () => {
    const { fetch } = mockFetch(() => new Promise<Response>(() => undefined));
    const c = new IamClient({ baseUrl: BASE, fetch });
    const { result } = renderHook(
      () => useCan({ subject: SUBJECT, permission: 'doc.read' }),
      { wrapper: makeWrapper(c) },
    );
    expect(result.current.loading).toBe(true);
    expect(result.current.allowed).toBe(false);
  });

  it('resolves to allowed=true after a successful allow decision', async () => {
    const { fetch } = mockFetch(
      jsonResponse({ data: { allowed: true, requires_step_up: false } }),
    );
    const c = new IamClient({ baseUrl: BASE, fetch });
    const { result } = renderHook(
      () => useCan({ subject: SUBJECT, permission: 'doc.read' }),
      { wrapper: makeWrapper(c) },
    );
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.allowed).toBe(true);
    expect(result.current.requiresStepUp).toBe(false);
  });

  it('resolves to allowed=false after a deny decision', async () => {
    const { fetch } = mockFetch(jsonResponse({ data: { allowed: false } }));
    const c = new IamClient({ baseUrl: BASE, fetch });
    const { result } = renderHook(
      () => useCan({ subject: SUBJECT, permission: 'doc.read' }),
      { wrapper: makeWrapper(c) },
    );
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.allowed).toBe(false);
  });

  it('resolves to allowed=false on transport error (fail-closed)', async () => {
    const { fetch } = mockFetch(new Error('ECONNREFUSED'));
    const c = new IamClient({ baseUrl: BASE, fetch });
    const { result } = renderHook(
      () => useCan({ subject: SUBJECT, permission: 'doc.read' }),
      { wrapper: makeWrapper(c) },
    );
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.allowed).toBe(false);
  });

  it('propagates requiresStepUp (allowed but step-up pending → not granted)', async () => {
    const { fetch } = mockFetch(
      jsonResponse({
        data: { allowed: true, requires_step_up: true, required_aal: 'aal2' },
      }),
    );
    const c = new IamClient({ baseUrl: BASE, fetch });
    const { result } = renderHook(
      () => useCan({ subject: SUBJECT, permission: 'doc.write' }),
      { wrapper: makeWrapper(c) },
    );
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.allowed).toBe(false);
    expect(result.current.requiresStepUp).toBe(true);
  });
});

describe('usePermission', () => {
  it('uses subject from IamProvider context', async () => {
    const { fetch, calls } = mockFetch(jsonResponse({ data: { allowed: true } }));
    const c = new IamClient({ baseUrl: BASE, fetch });
    const { result } = renderHook(() => usePermission('stock.adjust'), {
      wrapper: makeWrapper(c, SUBJECT),
    });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.allowed).toBe(true);
    const body = calls[0]!.body as Record<string, unknown>;
    expect((body['subject'] as Record<string, unknown>)['id']).toBe('usr_1');
  });

  it('denies immediately (no network call) when no subject in context', () => {
    const { fetch, calls } = mockFetch(jsonResponse({ data: { allowed: true } }));
    const c = new IamClient({ baseUrl: BASE, fetch });
    const wrapper = ({ children }: { children: ReactNode }) =>
      createElement(IamProvider, { client: c }, children);
    const { result } = renderHook(() => usePermission('doc.read'), { wrapper });
    expect(result.current.loading).toBe(false);
    expect(result.current.allowed).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it('passes resource to the check call', async () => {
    const { fetch, calls } = mockFetch(jsonResponse({ data: { allowed: true } }));
    const c = new IamClient({ baseUrl: BASE, fetch });
    const { result } = renderHook(
      () => usePermission('stock.adjust', { type: 'warehouse', id: 'wh_1' }),
      { wrapper: makeWrapper(c, SUBJECT) },
    );
    await waitFor(() => expect(result.current.loading).toBe(false));
    const body = calls[0]!.body as Record<string, unknown>;
    expect(body['resource']).toEqual({ type: 'warehouse', id: 'wh_1' });
    expect(result.current.allowed).toBe(true);
  });

  it('starts loading=true, allowed=false (fail-closed during loading)', () => {
    const { fetch } = mockFetch(() => new Promise<Response>(() => undefined));
    const c = new IamClient({ baseUrl: BASE, fetch });
    const { result } = renderHook(() => usePermission('doc.read'), {
      wrapper: makeWrapper(c, SUBJECT),
    });
    expect(result.current.loading).toBe(true);
    expect(result.current.allowed).toBe(false);
  });
});