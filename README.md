# @padosoft/laravel-iam-react-native

> Thin, **fail-closed** React Native client and hooks for the [Laravel IAM](https://github.com/padosoft) control plane.

[![tests](https://github.com/padosoft/laravel-iam-react-native/actions/workflows/tests.yml/badge.svg)](https://github.com/padosoft/laravel-iam-react-native/actions/workflows/tests.yml)
[![npm](https://img.shields.io/npm/v/@padosoft/laravel-iam-react-native.svg)](https://www.npmjs.com/package/@padosoft/laravel-iam-react-native)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

Ask the IAM server *"can this user do this?"* from your React Native (or React) app — with the **exact same wire contract and guarantees as the PHP and Node clients**, plus React hooks that stay fail-closed while loading.

## Why

- **Fail-closed by construction.** Network error, timeout, 5xx, 4xx, malformed body, or unverifiable token resolves to **deny**. Always. Loading resolves to **deny**. No fail-open switch.
- **No PDP logic client-side.** Every verdict comes from the server's `decisions/check`. The client never interprets grants.
- **React Native safe.** No `node:crypto`, no Node built-ins. Uses the RN fetch polyfill and `jose` (Web Crypto / `globalThis.crypto.subtle`).
- **Zero runtime coupling to the Node SDK.** Wire types are imported from `@padosoft/laravel-iam-node` with `import type` — completely erased at build time. No Node SDK runtime code runs in your app.
- **First-class React hooks.** `usePermission` and `useCan` integrate with React context — check a permission in one line.

## Install

```bash
npm install @padosoft/laravel-iam-react-native
```

> Requires React Native >= 0.71 (Hermes with `globalThis.crypto.subtle`) for `verifyToken`. For `check()` / hooks only, any RN version with `fetch` works.

## Quick start

### 1. Configure the client and provider

```tsx
import { IamClient, IamProvider } from '@padosoft/laravel-iam-react-native';

const iam = new IamClient({
  baseUrl: 'https://iam.example.com/api/iam/v1',
  token: process.env.IAM_SERVICE_TOKEN,
  timeoutMs: 2000,
  cache: { ttlMs: 5000 },
});

export default function App() {
  const userId = useAuth().userId;

  return (
    <IamProvider client={iam} subject={{ type: 'user', id: userId }}>
      <Navigation />
    </IamProvider>
  );
}
```

### 2. Check permissions with hooks

```tsx
import { usePermission } from '@padosoft/laravel-iam-react-native';

function StockAdjustButton({ warehouseId }: { warehouseId: string }) {
  const { allowed, loading } = usePermission(
    'stock.adjust',
    { type: 'warehouse', id: warehouseId },
  );

  if (loading) return <ActivityIndicator />;
  if (!allowed) return null;
  return <Button title="Adjust stock" onPress={handleAdjust} />;
}
```

### 3. Or use the client imperatively

```ts
import { IamClient } from '@padosoft/laravel-iam-react-native';

const decision = await iam.check({
  subject: { type: 'user', id: 'usr_123' },
  application: 'warehouse',
  permission: 'stock.adjust',
  resource: { type: 'warehouse', id: 'wh_milan' },
  context: { amount: 300 },
});

if (!decision.allowed) throw new Error('Forbidden');
if (decision.requiresStepUp) promptStepUp(decision.requiredAal);
```

## Fail-closed: read this

`allowed === true` alone is **not** permission. When `requiresStepUp` is `true`, the action is only permitted at a higher AAL. The hooks apply `isGranted()` automatically — they only set `allowed: true` when the PDP allowed **and** no step-up is pending.

## Provider & Hooks API

### `<IamProvider client={...} subject={...}>`

| Prop | Type | Description |
|------|------|-------------|
| `client` | `IamClient` | Pre-configured client instance. |
| `subject` | `Subject` | The authenticated user. Hooks use it automatically. |
| `children` | `ReactNode` | Your app tree. |

### `useIam()`

Returns `{ client, subject }` from the nearest `IamProvider`. Throws if no provider is found.

### `useCan(query: DecisionQuery): PermissionState`

Full-control hook — accepts a complete `DecisionQuery`.

```ts
const { allowed, loading, requiresStepUp } = useCan({
  subject: { type: 'user', id: userId },
  permission: 'doc.publish',
  resource: { type: 'document', id: docId },
});
```

### `usePermission(permission, resource?, extra?): PermissionState`

Convenience hook — reads `subject` from context, you supply `permission` and optionally `resource`.

```ts
const { allowed } = usePermission('orders.approve', { type: 'order', id: orderId });
```

### `PermissionState`

| Field | Type | Description |
|-------|------|-------------|
| `allowed` | `boolean` | `true` only when PDP granted AND no step-up pending. `false` while loading. |
| `loading` | `boolean` | `true` while the check is in flight. |
| `requiresStepUp` | `boolean` | `true` if a higher AAL is required. |

## Client API

### `new IamClient(config)`

| Option | Default | Description |
|--------|---------|-------------|
| `baseUrl` | required | Full API base, e.g. `https://iam.example.com/api/iam/v1`. |
| `token` | — | Service token sent as `Authorization: Bearer`. |
| `timeoutMs` | `2000` | Per-request timeout in ms. |
| `retries` | `0` | Retries for idempotent network errors (never on 4xx/5xx). |
| `cache` | off | `{ ttlMs, maxEntries? }` in-memory decision cache. |
| `verify` | — | `{ issuer?, audience?, jwksUri? }` defaults for `verifyToken`. |
| `fetch` | `globalThis.fetch` | Inject a custom fetch (tests, proxies). |

### `check(query): Promise<Decision>`

`POST {baseUrl}/decisions/check`. Returns a normalised `Decision`. Never throws.

### `can(query): Promise<boolean>`

`check()` reduced to the fail-safe boolean.

### `listResources(subject, relation): Promise<Resource[]>`

ReBAC list-resources. Returns `[]` on any error.

### `verifyToken(jwt, options?): Promise<Claims>`

Verifies an ES256 token against the server JWKS. Rejects with `TokenVerificationError` on any failure.

## Ecosystem

| Package | Runtime | Description |
|---------|---------|-------------|
| [`@padosoft/laravel-iam-node`](https://github.com/padosoft/laravel-iam-node) | Node 18+ | Core TypeScript/Node SDK (middleware included) |
| `@padosoft/laravel-iam-react-native` | React Native / React | This package |
| [`padosoft/laravel-iam-client`](https://github.com/padosoft/laravel-iam-client) | PHP 8.1+ | PHP client — the wire-contract reference |

## License

MIT (c) [Padosoft](https://www.padosoft.com)