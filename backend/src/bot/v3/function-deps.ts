import type { MerchantResolverService } from '../../merchants/services/merchant-resolver.service';
import type { MerchantPreferencesService } from '../../merchants/services/merchant-preferences.service';

/**
 * Cross-cutting services a few function handlers need (merchant resolver,
 * preferences). Kept in its own file so handlers don't import from
 * function-router.ts (would create a cycle).
 */
export interface FunctionRouterDeps {
  merchantResolver?: MerchantResolverService;
  merchantPrefs?: MerchantPreferencesService;
}
