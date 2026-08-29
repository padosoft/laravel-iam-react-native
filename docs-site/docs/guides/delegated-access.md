---
title: "Delegated access (agents acting for the user)"
description: "Agents acting on behalf of a user in a React Native app: why verifyToken now refuses delegated tokens, why this SDK deliberately cannot verify one, and how to drive agent UI with useDelegatedPermission."
---

When an **AI agent acts on behalf of a user**, the token it carries names *two* identities: `sub` is the user, `act` is the agent (nested outermost-first when the chain is longer than one hop, RFC 8693 §4.1).

A mobile app sits differently in this story than a backend does, and this guide is mostly about that difference. This is the client half of [`laravel-iam-agents`](https://doc.laravel-iam-agents.padosoft.com).

## The invariant

> **Two identities, strict intersection, never union, fail-closed.**

The verdict is what the user may do **AND** what every actor in the chain may do — never the union:

- The agent can never do more than the user could.
- The agent can never do more than *it* was allowed.
- **Adding a hop can only narrow authority.** A chain of three agents is bounded by the smallest of the four sets.

A deny at any layer wins.

## What changed for existing apps: `verifyToken` refuses delegated tokens

This is the part worth reading even if you never write an agent feature.

A delegated token has a real ES256 signature, the right `iss`, the right `aud`, and a `sub` naming the user. Handed to `verifyToken`, it would verify **perfectly** — and returning its claims would hand your app the **user's full authority**, silently discarding the bound scope of the agent that actually holds the token. That is the confused deputy, running on the device.

So `verifyToken` now rejects it, with a message saying so:

```ts
try {
  const claims = await iam.verifyToken(token, { audience: 'my-app' });
} catch (err) {
  // TokenVerificationError — including "this is a delegated token"
  return signOut();
}
```

A **malformed** `act` is rejected just as firmly as a well-formed one. "Unreadable" must never quietly become "not delegated": that degradation *is* the escalation.

::: callout warning "This is a behaviour change, deliberately"
If your backend was handing delegated tokens to the app and the app was verifying them locally, that flow was granting more than the delegation allowed — and it now fails loudly instead of quietly. The fix is in the section below, not a workaround for the refusal.
:::

## Why this SDK deliberately cannot verify a delegated token

There is no `verifyDelegatedToken` here, and that absence is a design decision rather than a gap.

Delegated tokens are **introspection-mandatory**. Only the server can confirm the delegation is still live — the grant not revoked, the user's session not ended — and RFC 7662 introspection requires an **authenticated** caller. A mobile app is a **public** OAuth client: it holds no secret to authenticate with, and shipping one would publish it, because anything in an app binary is extractable.

An SDK that offered the method anyway would be inviting exactly that anti-pattern.

**So: if your app receives a delegated token, hand it to your backend.** The backend holds the credentials, performs the introspection, and answers. This is the same split the mobile security rules require of every AI feature — the device never holds the key, and the server re-validates. The backend does the token exchange too; the app never mints a delegated token.

## What the app *can* do: ask the PDP

Asking "may this agent do this, for me?" needs no secret — it is an ordinary authenticated call with the user's own token. That is exactly what you need to drive UI about agents.

```tsx
import { useDelegatedPermission } from '@padosoft/laravel-iam-react-native';

function AssistantDraftButton({ actors, orderId }: { actors: string[]; orderId: string }) {
  // actors = ['agent:assistant'] — CURRENT actor first, root last
  const { allowed, loading, requiresStepUp } = useDelegatedPermission(
    actors,
    'orders.draft',
    { type: 'order', id: orderId },
  );

  if (requiresStepUp) return <StepUpPrompt />;
  return <Button disabled={!allowed || loading} title="Let the assistant draft it" />;
}
```

Fail-closed exactly like [`usePermission`](/guides/checking-permissions):

| Situation | Result |
| --- | --- |
| in flight | `{ allowed: false, loading: true }` — loading is never allow |
| no subject on the provider | denied, **no network call** |
| empty actor chain | denied, **no network call** |
| any error | `{ allowed: false, loading: false }` |
| allowed but step-up pending | `allowed: false`, `requiresStepUp: true` |

An empty chain is **not** a fall-back to the plain user check. That would answer a question about the *user* when you asked about an *agent* — and the user can usually do more than the agent, so the button would light up when it should not.

### Imperatively

```ts
const decision = await iam.checkDelegated(
  { id: userId },              // the USER — never the agent
  ['agent:hop2', 'agent:hop1'], // current actor first
  'orders.draft',
  { resource: { type: 'order', id: orderId }, delegationGrantId: grantId },
);
```

`canDelegated(...)` is the fail-safe boolean. Passing `delegationGrantId` lets the PDP catch a grant revoked seconds ago, rather than waiting for the token to expire.

## Delegated decisions are never cached

Even with the decision cache enabled, a query carrying an act chain always goes to the server. A grant can be revoked at any moment, and a cached delegated allow would outlive the revocation meant to stop it. Plain checks cache exactly as before — see [Caching decisions](/guides/caching).

## Reading the chain for display

```ts
import { inspectDelegatedBearer } from '@padosoft/laravel-iam-react-native';

const bearer = inspectDelegatedBearer(token);
// null → not delegated
// { sub, actors, grantId, scopes } → render "Agent X, acting for you"
```

Parsed locally with no `Buffer` and no `node:crypto` — React Native has neither — and UTF-8 safe, so an agent named `agent:città-アシスタント` renders correctly in a consent screen rather than as mojibake.

It is **display and routing information, never authorization**. There is no `verified` flag on the result, unlike the server SDKs, precisely because nothing here can verify anything. A malformed `act` throws `MalformedDelegationError` rather than degrading into a plain-user reading.

`actorChainFromClaims`, `isDelegated` and `parseScopes` are exported for the same purpose.

## The ordering matters

`actors[0]` is the **current** actor — the one holding the token now. The **last** element is the root: the agent the user actually consented to, whose grant governs the whole chain. Revoke the root and everything downstream stops.

Showing the wrong end of that chain in a consent or audit screen names the wrong agent to the user, so it is pinned by a test rather than left to a comment.

## See also

- [`laravel-iam-agents`](https://doc.laravel-iam-agents.padosoft.com) — the server module
- [Verifying tokens (JWKS)](/guides/verifying-tokens) — the plain-user path
- [Checking permissions with hooks](/guides/checking-permissions)
