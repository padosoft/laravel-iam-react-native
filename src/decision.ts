import type { Decision, DecisionMatch } from '@padosoft/laravel-iam-node';

export function deny(reason: string): Decision {
  return {
    allowed: false,
    decisionId: '',
    policyVersion: 0,
    requiresStepUp: false,
    requiredAal: null,
    matched: [],
    explanation: [reason],
  };
}

function asMatches(value: unknown): DecisionMatch[] {
  if (!Array.isArray(value)) return [];
  return value.filter((m): m is DecisionMatch => typeof m === 'object' && m !== null);
}

function asStrings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((s): s is string => typeof s === 'string');
}

export function decisionFromBody(body: unknown): Decision {
  if (typeof body !== 'object' || body === null) {
    return deny('invalid body');
  }

  let data: Record<string, unknown> = body as Record<string, unknown>;
  const envelope = data['data'];
  if (
    data['allowed'] === undefined &&
    typeof envelope === 'object' &&
    envelope !== null &&
    !Array.isArray(envelope)
  ) {
    data = envelope as Record<string, unknown>;
  }

  return {
    allowed: data['allowed'] === true,
    decisionId: typeof data['decision_id'] === 'string' ? data['decision_id'] : '',
    policyVersion: typeof data['policy_version'] === 'number' ? data['policy_version'] : 0,
    requiresStepUp: data['requires_step_up'] === true,
    requiredAal: typeof data['required_aal'] === 'string' ? data['required_aal'] : null,
    matched: asMatches(data['matched']),
    explanation: asStrings(data['explanation']),
  };
}

export function isGranted(decision: Decision): boolean {
  return decision.allowed && !decision.requiresStepUp;
}
