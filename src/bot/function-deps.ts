import type { MerchantResolverService } from '../merchants/services/merchant-resolver.service';
import type { MerchantPreferencesService } from '../merchants/services/merchant-preferences.service';
import type { InsightsEngineService } from '../insights/engine/insights-engine.service';

/**
 * Cross-cutting services a few function handlers need (merchant resolver,
 * preferences). Kept in its own file so handlers don't import from
 * function-router.ts (would create a cycle).
 *
 * `insightsEngine` se usa SOLO desde el router (no desde handlers) — el
 * router dispara recompute fire-and-forget después de cada mutación.
 */
export interface FunctionRouterDeps {
  merchantResolver?: MerchantResolverService;
  merchantPrefs?: MerchantPreferencesService;
  insightsEngine?: InsightsEngineService;
}
