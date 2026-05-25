import { Module } from '@nestjs/common';
import { Layer1MetricsService } from './engine/layer1-metrics.service';
import { InsightsEngineService } from './engine/insights-engine.service';
import { InsightsWriterService } from './io/insights-writer.service';
import { InsightsReaderService } from './io/insights-reader.service';
import { OnDemandController } from './triggers/on-demand.controller';

/**
 * Módulo Insights — PR1.
 *
 * Estado actual:
 *   - Layer 1 (métricas) ✓
 *   - Writer + Reader ✓
 *   - Endpoint on-demand ✓
 *
 * Pendiente (próximos PRs):
 *   - PR2: triggers incremental (hook en register/edit/delete) + batch semanal
 *   - PR2: Layer 2 (beats + observations)
 *   - PR3: commitments (tabla, detección, evaluator)
 *   - PR4: Layer 3 (money diary) + tool get_user_insights
 *   - PR5: rewrite del prompt + reportes proactivos
 *
 * Los servicios IO se exportan para que otros módulos (BotModule, UsersModule)
 * puedan leer/invalidar el cache sin importar el engine completo.
 */
@Module({
  controllers: [OnDemandController],
  providers: [
    Layer1MetricsService,
    InsightsEngineService,
    InsightsWriterService,
    InsightsReaderService,
  ],
  exports: [
    InsightsEngineService,
    InsightsReaderService,
    InsightsWriterService,
  ],
})
export class InsightsModule {}
