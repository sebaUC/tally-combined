/**
 * Constantes del módulo Fintoc.
 * Centralizadas acá para evitar strings mágicos dispersos.
 */

export const FINTOC_API_BASE = 'https://api.fintoc.com/v1';

/** IPs desde las que Fintoc envía webhooks (ISO 27001 A.5.15 — network access control). */
export const FINTOC_WEBHOOK_IP_ALLOWLIST = Object.freeze([
  '35.231.182.34',
  '136.109.248.140',
]);

/** Tolerancia del timestamp del webhook contra replay attacks. */
export const FINTOC_WEBHOOK_TIMESTAMP_TOLERANCE_SECONDS = 300; // 5 min

/** TTL del link intent en Redis (widget_token expira en ~15 min en Fintoc). */
export const FINTOC_INTENT_TTL_SECONDS = 15 * 60;

/** TTL del dedup de eventos webhook en Redis. */
export const FINTOC_WEBHOOK_DEDUP_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 días

/** Estados del link. */
export const FINTOC_LINK_STATUS = Object.freeze({
  ACTIVE: 'active',
  CREDENTIALS_CHANGED: 'credentials_changed',
  INVALID: 'invalid',
  DISCONNECTED: 'disconnected',
});

export type FintocLinkStatus =
  (typeof FINTOC_LINK_STATUS)[keyof typeof FINTOC_LINK_STATUS];

/** Redis key patterns. */
export const FINTOC_REDIS_KEYS = Object.freeze({
  intent: (userId: string) => `fintoc:intent:${userId}`,
  event: (eventId: string) => `fintoc:evt:${eventId}`,
});
