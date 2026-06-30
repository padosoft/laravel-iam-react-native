/**
 * Wire and config types for the Laravel IAM React Native SDK.
 *
 * Wire types (Subject, Resource, Decision, etc.) are re-exported from
 * @padosoft/laravel-iam-node via TYPE-ONLY imports — completely erased at
 * build time. No runtime code from the Node SDK is ever bundled or executed.
 */

// ---- Wire types (re-exported from node SDK, type-only) ----------------------
export type {
  Subject,
  Resource,
  DecisionContext,
  DecisionQuery,
  DecisionMatch,
  Decision,
  Claims,
  CacheOptions,
  VerifyOptions,
} from '@padosoft/laravel-iam-node';

import type { CacheOptions, VerifyOptions } from '@padosoft/laravel-iam-node';

// ---- RN-specific config & state types ---------------------------------------

/** Constructor configuration for {@link IamClient}. */
export interface IamClientConfig {
  /**
   * Full API base URL of the IAM server, including the route prefix, e.g.
   * `https://iam.example.com/api/iam/v1`. Identical to the PHP client's
   * `iam-client.http.base_url`.
   */
  baseUrl: string;
  /** Service token (OAuth2 Client Credentials) sent as `Authorization: Bearer`. */
  token?: string | undefined;
  /** Per-request timeout in milliseconds. Default 2000. */
  timeoutMs?: number | undefined;
  /** Retries for idempotent network errors only (never on 4xx/5xx). Default 0. */
  retries?: number | undefined;
  /** Opt-in decision cache (in-memory, RN-safe). Off by default. */
  cache?: CacheOptions | undefined;
  /** Defaults applied to {@link IamClient.verifyToken}. */
  verify?: VerifyOptions | undefined;
  /**
   * Inject a `fetch` implementation. Defaults to `globalThis.fetch`.
   * In React Native, the built-in RN fetch polyfill is used automatically.
   */
  fetch?: typeof globalThis.fetch | undefined;
  /** Path appended to `baseUrl` for the PDP check. Default `decisions/check`. */
  checkPath?: string | undefined;
  /** Path appended to `baseUrl` for list-resources. Default `decisions/list-resources`. */
  listResourcesPath?: string | undefined;
}

/** Live state returned by permission-checking hooks. */
export interface PermissionState {
  /**
   * Whether the PDP granted the permission AND no step-up is pending.
   * Fail-closed: `false` while loading or on any error.
   */
  allowed: boolean;
  /** `true` while the PDP check is in flight. Loading is NEVER treated as allow. */
  loading: boolean;
  /** `true` if the PDP allowed but requires a higher authenticator assurance level. */
  requiresStepUp: boolean;
}
