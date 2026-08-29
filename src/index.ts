// Client
export { IamClient } from './client.js';
export type { DelegatedDecisionQuery, IamClientConfig, PermissionState } from './types.js';

// Wire types (re-exported from @padosoft/laravel-iam-node, type-only)
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
} from './types.js';

// Delegated access (RFC 8693)
export {
  actorChainFromClaims,
  delegatedBearerFromClaims,
  inspectDelegatedBearer,
  isDelegated,
  parseScopes,
  MalformedDelegationError,
  TYP_DELEGATED,
} from './delegation.js';
export type { ActorId, DelegatedBearer } from './delegation.js';

// Error classes
export { TokenVerificationError } from './errors.js';

// Decision helpers
export { deny, decisionFromBody, isGranted } from './decision.js';

// React integration
export { IamProvider, IamContext } from './provider.js';
export type { IamContextValue, IamProviderProps } from './provider.js';
export { useIam, useCan, usePermission, useDelegatedPermission } from './hooks.js';