import { Module } from '@nestjs/common';
import { FintocController } from './fintoc.controller';
import { FintocAdminController } from './fintoc-admin.controller';
import { FintocWebhookController } from './fintoc-webhook.controller';
import { FintocApiClient } from './services/fintoc-api.client';
import { FintocCryptoService } from './services/fintoc-crypto.service';
import { FintocLinkService } from './services/fintoc-link.service';
import { FintocSyncService } from './services/fintoc-sync.service';
import { FintocWebhookService } from './services/fintoc-webhook.service';
import { FintocAuditService } from './services/fintoc-audit.service';
import { FintocAdminService } from './services/fintoc-admin.service';
import { FintocWebhookGuard } from './guards/fintoc-webhook.guard';
import { AdminGuard } from '../admin/guards/admin.guard';
import { JwtGuard } from '../auth/middleware/jwt.guard';
import { MfaRequiredGuard } from '../auth/middleware/mfa.guard';
import { MerchantsModule } from '../merchants/merchants.module';

/**
 * Módulo Fintoc — integración de cuentas bancarias chilenas via Fintoc.
 *
 * Seguridad:
 *   - link_token en Supabase Vault (AES-256-GCM)
 *   - webhook: HMAC-SHA256 + IP allowlist opcional + anti-replay 5min
 *   - admin backfill endpoint: AdminGuard (whitelist UUID) + MfaRequiredGuard (aal2)
 * Auditoría: todo acceso/mutación queda en `fintoc_access_log`.
 * Idempotencia: webhook dedup vía Redis SETNX, `transactions.external_id` UNIQUE.
 */
@Module({
  imports: [MerchantsModule],
  controllers: [
    FintocController,
    FintocAdminController,
    FintocWebhookController,
  ],
  providers: [
    FintocApiClient,
    FintocCryptoService,
    FintocLinkService,
    FintocSyncService,
    FintocWebhookService,
    FintocAuditService,
    FintocAdminService,
    FintocWebhookGuard,
    JwtGuard,
    AdminGuard,
    MfaRequiredGuard,
  ],
  exports: [FintocLinkService, FintocSyncService],
})
export class FintocModule {}
