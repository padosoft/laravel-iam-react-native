import { createContext, createElement } from 'react';
import type { Context, ReactNode } from 'react';
import type { IamClient } from './client.js';
import type { Subject } from '@padosoft/laravel-iam-node';

/** Value provided by {@link IamProvider} via React context. */
export interface IamContextValue {
  /** The configured {@link IamClient} instance. */
  client: IamClient;
  /** The current user subject, used by permission hooks automatically. */
  subject?: Subject | undefined;
}

/** Props for {@link IamProvider}. */
export interface IamProviderProps {
  /** Pre-configured {@link IamClient} instance. */
  client: IamClient;
  /** The authenticated subject (current user). */
  subject?: Subject | undefined;
  children?: ReactNode | undefined;
}

// null means "not inside a provider" — caught by useIam().
export const IamContext: Context<IamContextValue | null> =
  createContext<IamContextValue | null>(null);

/**
 * Provide an {@link IamClient} (and optionally the current user subject) to the
 * React tree. Wrap your app or a subtree with this provider.
 */
export function IamProvider(props: IamProviderProps): ReactNode {
  const value: IamContextValue = { client: props.client, subject: props.subject };
  return createElement(IamContext.Provider, { value, children: props.children });
}