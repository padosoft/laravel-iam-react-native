---
title: "Fail-closed discipline"
description: "Keeping the invariant true outside the SDK: gate positively on allowed, never render privileged controls while loading, handle step-up explicitly, treat verifyToken rejection and listResources [] as deny, and don't fall back to allow in any catch."
---

The SDK is fail-closed on the inside. You can still undo it in one line on the outside. This page is the checklist that keeps the boundary honest in your app code.

::: callout danger "The invariant holds inside the SDK; honour it outside too" icon:shield-alert
Every anti-pattern below reintroduces fail-open at the call site. None requires touching the SDK — they're ordinary React mistakes with security consequences.
:::

## 1. Gate positively on `allowed`

Render the privileged control **when `allowed` is true**, not "unless explicitly denied". Because `allowed` is `false` during loading and on error, positive gating is fail-closed automatically.

::: tabs
== tab "Do"
```tsx
const { allowed, loading } = usePermission('doc.publish', resource);
if (loading) return <Spinner />;
return allowed ? <PublishButton /> : null;
```
== tab "Don't"
```tsx
const { allowed } = usePermission('doc.publish', resource);
// renders during loading (allowed === false but treated as "not yet denied")
return state === 'explicitly-denied' ? null : <PublishButton />;
```
:::

## 2. Never render a privileged control while loading

`loading: true` carries `allowed: false`. Show a spinner, a disabled control, or nothing — never the live action. A control that appears for a frame before the verdict is a tappable fail-open window.

```tsx
if (loading) return <ActivityIndicator />; // or a disabled placeholder
```

## 3. Handle step-up explicitly — don't collapse it into "denied"

`requiresStepUp` is a distinct, recoverable state: prompt the user to elevate, then re-check. Collapsing it into a silent `null` hides an action the user *can* perform after authenticating.

```tsx
if (requiresStepUp) return <StepUpButton onDone={recheck} />;
if (!allowed) return null;
```

See [Step-up & AAL](/concepts/step-up-aal).

## 4. `verifyToken` rejection means unauthenticated — full stop

A `TokenVerificationError` is the deny signal for authentication. The catch block must lead to a denied/sign-out path, never to "continue as if verified".

::: tabs
== tab "Do"
```ts
try {
  const claims = await client.verifyToken(jwt);
  return authenticate(claims);
} catch (e) {
  if (e instanceof TokenVerificationError) return signOut();
  throw e;
}
```
== tab "Don't"
```ts
let claims;
try { claims = await client.verifyToken(jwt); }
catch { claims = decodeWithoutVerify(jwt); } // ☠️ trusts an unverified token
authenticate(claims);
```
:::

## 5. `listResources` `[]` means "show nothing"

An empty array is the fail-closed result (missing subject, error, or genuinely empty). Never invert it to "no filter, show everything".

```tsx
const ids = new Set((await client.listResources(subject, 'manager')).map(r => r.id));
const visible = all.filter(x => ids.has(x.id)); // [] → empty, never "all"
```

## 6. Use `can()` / the hooks — never branch on raw `decision.allowed`

If you call `client.check` imperatively, reduce with `can()` or `isGranted()` so step-up is folded in. The hooks already do this.

```ts
if (await client.can(query)) { /* permitted */ }      // ✅ step-up-aware
// if ((await client.check(query)).allowed) { … }     // ❌ ignores requiresStepUp
```

## 7. Keep timeouts tight and let denials read as "not yet"

A short `timeoutMs` (default 2s) bounds how long a hung PDP blocks the UI before it fails closed. Pair it with good loading/empty states so a fail-closed moment looks like "try again", not "broken". Optionally enable a short [cache](/best-practices/caching-safely) and `retries` for transient blips — neither weakens the invariant.

## 8. On a shared device, reset on logout

Changing `subject` stops new checks for the old user, but the decision cache lives on the client. If one device serves multiple users, construct a fresh client (or `clear()` its cache) on logout so a previous user's verdicts can't be served.

## The discipline, as a checklist

::: steps
1. **Gate positively** on `allowed`; treat loading and error as deny.
2. **No privileged control during `loading`** — spinner / disabled / nothing.
3. **Prompt on `requiresStepUp`**, then re-check.
4. **`verifyToken` reject → unauthenticated**; never use an unverified token.
5. **`listResources` `[]` → show nothing**, never "show all".
6. **Reduce with `can()`/hooks**, never raw `allowed`.
7. **Tight `timeoutMs`**; good loading/empty UX.
8. **Reset client/cache on logout** for shared devices.
:::

## Next steps

- [Fail-closed by design](/concepts/fail-closed) — the invariant these rules protect.
- [Caching safely](/best-practices/caching-safely) — TTLs without breaking it.
- [Hermes & Web Crypto](/best-practices/hermes-web-crypto) — the `verifyToken` runtime caveat.
