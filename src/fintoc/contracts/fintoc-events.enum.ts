/**
 * Eventos de webhook de Fintoc relevantes para TallyFinance.
 * Sólo listamos los que procesamos activamente.
 */

export const FintocEventType = {
  REFRESH_SUCCEEDED: 'account.refresh_intent.succeeded',
  REFRESH_FAILED: 'account.refresh_intent.failed',
  REFRESH_REJECTED: 'account.refresh_intent.rejected',
  MOVEMENTS_MODIFIED: 'account.refresh_intent.movements_modified',
  MOVEMENTS_REMOVED: 'account.refresh_intent.movements_removed',
  CREDENTIALS_CHANGED: 'link.credentials_changed',
} as const;

export type FintocEventType =
  (typeof FintocEventType)[keyof typeof FintocEventType];

export const HANDLED_EVENT_TYPES: readonly string[] = Object.freeze(
  Object.values(FintocEventType),
);

export function isHandledEvent(type: string): type is FintocEventType {
  return HANDLED_EVENT_TYPES.includes(type);
}
