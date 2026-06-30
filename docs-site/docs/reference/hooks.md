---
title: "Provider & Hooks API"
description: "Complete reference for the React surface: IamProvider and IamContext, the useIam / useCan / usePermission hooks, the IamContextValue and PermissionState shapes, and exact signatures, parameters, and fail-closed return semantics."
---

# Provider & Hooks API

The React layer is one provider, one context, and three hooks. All of it is a thin, fail-closed adapter over [`IamClient`](/reference/client).

```ts
import {
  IamProvider, IamContext,
  useIam, useCan, usePermission,
} from '@padosoft/laravel-iam-react-native';
```

## `<IamProvider>`

Puts a configured client and the current subject into React context. Mount once near the root.

```tsx
<IamProvider client={iam} subject={{ type: 'user', id: userId }}>
  <App />
</IamProvider>
```

### `IamProviderProps`

| Prop | Type | Required | Description |
|---|---|---|---|
| `client` | `IamClient` | yes | A pre-constructed client instance. |
| `subject` | `Subject \| undefined` | no | The authenticated user; `usePermission` uses it automatically. |
| `children` | `ReactNode` | no | Your app tree. |

::: callout tip "Construct the client outside render" icon:box
Build `client` at module scope or memoise it; a new instance per render discards the JWKS and decision caches. See [The IamProvider](/guides/provider).
:::

## `IamContext`

The raw React context (`Context<IamContextValue | null>`), default `null`. You rarely use it directly — prefer `useIam()`. Exposed for advanced cases (custom consumers, testing).

### `IamContextValue`

```ts
interface IamContextValue {
  client: IamClient;
  subject?: Subject | undefined;
}
```

## `useIam(): IamContextValue`

Returns `{ client, subject }` from the nearest provider. **Throws** `useIam must be called inside <IamProvider>` when there is no provider above — a wiring bug should be loud, not silent.

```ts
const { client, subject } = useIam();
const claims = await client.verifyToken(jwt);
```

## `useCan(query): PermissionState`

Full-control reactive check. Accepts a complete [`DecisionQuery`](/reference/types) (your own subject, `application`, `context`, `organization`, `currentAal`, `explain`). Runs the fail-closed lifecycle and returns [`PermissionState`](#permissionstate).

```ts
const { allowed, loading, requiresStepUp } = useCan({
  subject: { type: 'user', id: userId },
  application: 'admin',
  permission: 'panel.view',
  context: { tenant: 'acme' },
});
```

- Starts `{ allowed:false, loading:true }`; re-runs when the query **value** changes (keyed on a canonical-JSON serialisation, so inline object literals are fine).
- Drops stale/late responses (cancellation guard).

## `usePermission(permission, resource?, extra?): PermissionState`

Convenience check that reads the `subject` from context.

```ts
usePermission(
  permission: string,
  resource?: Resource | string | null,
  extra?: Partial<Omit<DecisionQuery, 'permission' | 'resource' | 'subject'>>,
): PermissionState
```

| Parameter | Type | Description |
|---|---|---|
| `permission` | `string` | The permission to check (e.g. `'stock.adjust'`). |
| `resource` | `Resource \| string \| null` | Optional target resource; omit/`null` for a global permission. |
| `extra` | `Partial<…>` | Any remaining query fields: `application`, `context`, `organization`, `currentAal`, `explain`. |

```tsx
const { allowed, loading } = usePermission('orders.approve', { type: 'order', id }, {
  application: 'sales',
  context: { amount },
});
```

::: callout warning "No subject → immediate deny, no network" icon:shield-alert
If the provider has no `subject`, `usePermission` returns `{ allowed:false, loading:false, requiresStepUp:false }` **without** calling the PDP. Fail-closed for anonymous users.
:::

## `PermissionState`

The return shape of both permission hooks.

```ts
interface PermissionState {
  allowed: boolean;        // true ONLY when granted AND not loading
  loading: boolean;        // true while the check is in flight
  requiresStepUp: boolean; // true when allowed-but-needs-higher-AAL
}
```

| Field | While loading | On allow | On deny / error | On step-up |
|---|---|---|---|---|
| `allowed` | `false` | `true` | `false` | `false` |
| `loading` | `true` | `false` | `false` | `false` |
| `requiresStepUp` | `false` | `false` | `false` | `true` |

`allowed` already folds in step-up (`isGranted`), so gate your UI on it directly. See [The hook lifecycle](/concepts/hook-lifecycle).

## Worked example

```tsx
function DeleteButton({ id }: { id: string }) {
  const { allowed, loading, requiresStepUp } = usePermission('item.delete', { type: 'item', id });
  if (loading)        return <ActivityIndicator />;
  if (requiresStepUp) return <Button title="Verify to delete" onPress={stepUp} />;
  if (!allowed)       return null;
  return <Button title="Delete" color="red" onPress={() => del(id)} />;
}
```

## Next steps

- [IamClient API](/reference/client) — the client these hooks wrap.
- [Types](/reference/types) — `DecisionQuery`, `Subject`, `Resource`, `PermissionState`.
- [Checking permissions with hooks](/guides/checking-permissions) — patterns and pitfalls.
