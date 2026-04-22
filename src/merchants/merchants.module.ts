import { Module } from '@nestjs/common';

import { CatalogResolver } from './resolvers/catalog.resolver';
import { TrgmResolver } from './resolvers/trgm.resolver';
import { EmbeddingResolver } from './resolvers/embedding.resolver';
import { LlmResolver } from './resolvers/llm.resolver';
import { MerchantResolverService } from './services/merchant-resolver.service';
import { MerchantPreferencesService } from './services/merchant-preferences.service';

/**
 * Assumes ConfigModule is registered as global (isGlobal: true) at the app root
 * so ConfigService is injectable in resolvers without re-importing here.
 * AppModule and any standalone context (e.g. seed script) must do that.
 */
@Module({
  providers: [
    CatalogResolver,
    TrgmResolver,
    EmbeddingResolver,
    LlmResolver,
    MerchantResolverService,
    MerchantPreferencesService,
  ],
  exports: [
    MerchantResolverService,
    MerchantPreferencesService,
    EmbeddingResolver,
  ],
})
export class MerchantsModule {}
