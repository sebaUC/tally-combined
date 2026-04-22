import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SupabaseClient } from '@supabase/supabase-js';
import { RedisService } from '../../redis/redis.service';
import { FintocApiClient, FintocApiError } from './fintoc-api.client';
import { FintocCryptoService } from './fintoc-crypto.service';
import { FintocAuditService } from './fintoc-audit.service';
import { FintocSyncService } from './fintoc-sync.service';
import { fromFintocMinorUnits } from './fintoc-money';
import {
  FINTOC_INTENT_TTL_SECONDS,
  FINTOC_LINK_STATUS,
  FINTOC_REDIS_KEYS,
} from '../constants/fintoc.constants';
import {
  CreateLinkIntentResponseDto,
  ExchangeTokenResponseDto,
  FintocAccountPublicDto,
  FintocLinkPublicDto,
} from '../dto/fintoc-link-response.dto';
import { FintocAccount, FintocLink } from '../contracts/fintoc-api.types';

interface AuditMeta {
  ip?: string | null;
  userAgent?: string | null;
}

/**
 * Orquesta el ciclo de vida del link bancario via Fintoc.
 * Todas las operaciones dejan registro en `fintoc_access_log`.
 */
@Injectable()
export class FintocLinkService {
  private readonly logger = new Logger(FintocLinkService.name);
  private readonly publicKey: string;

  constructor(
    private readonly config: ConfigService,
    private readonly api: FintocApiClient,
    private readonly crypto: FintocCryptoService,
    private readonly redis: RedisService,
    private readonly audit: FintocAuditService,
    private readonly sync: FintocSyncService,
    @Inject('SUPABASE') private readonly supabase: SupabaseClient,
  ) {
    const publicKey = this.config.get<string>('FINTOC_PUBLIC_KEY');
    if (!publicKey) {
      throw new Error('FINTOC_PUBLIC_KEY env var is required');
    }
    this.publicKey = publicKey;
  }

  // ── Step 1: crear Link Intent ────────────────────────────────

  async createIntent(
    userId: string,
    meta: AuditMeta,
  ): Promise<CreateLinkIntentResponseDto> {
    this.logger.log(`[fintoc] createIntent start user=${userId}`);

    const intent = await this.api.createLinkIntent({
      product: 'movements',
      country: 'cl',
    });

    this.logger.log(
      `[fintoc] createIntent intent_id=${intent.id} mode=${intent.mode}`,
    );

    // CSRF guard: guardamos el widget_token en Redis asociado al user.
    // En `exchange` validamos que el user tenga un intent activo.
    await this.redis.set(
      FINTOC_REDIS_KEYS.intent(userId),
      JSON.stringify({
        widget_token: intent.widget_token,
        intent_id: intent.id,
        created_at: new Date().toISOString(),
      }),
      FINTOC_INTENT_TTL_SECONDS,
    );

    this.audit.log({
      userId,
      actorType: 'user',
      actorId: userId,
      action: 'intent_created',
      ipAddress: meta.ip,
      userAgent: meta.userAgent,
      detail: { intent_id: intent.id, mode: intent.mode },
    });

    return {
      widget_token: intent.widget_token,
      public_key: this.publicKey,
    };
  }

  // ── Step 2: exchange → persistir link + cuentas ──────────────

  async exchange(
    userId: string,
    exchangeToken: string,
    meta: AuditMeta,
  ): Promise<ExchangeTokenResponseDto> {
    this.logger.log(`[fintoc] exchange start user=${userId}`);
    await this.requireActiveIntent(userId);

    // 1. Canje: exchange_token → link_token + metadata del link
    let fintocLink: FintocLink;
    try {
      fintocLink = await this.api.exchangeLinkToken(exchangeToken);
      this.logger.log(
        `[fintoc] exchange ok fintoc_link=${fintocLink.id} institution=${fintocLink.institution.id}`,
      );
    } catch (err) {
      this.audit.log({
        userId,
        actorType: 'user',
        actorId: userId,
        action: 'exchange_failed',
        ipAddress: meta.ip,
        userAgent: meta.userAgent,
        detail: { error: this.describeError(err) },
      });
      throw new BadRequestException({
        message: 'No pudimos canjear el código de Fintoc.',
        detail: this.describeError(err),
      });
    }

    // 2. Traer cuentas del banco ANTES de persistir para poder rollback limpio
    let fintocAccounts: FintocAccount[];
    try {
      fintocAccounts = await this.api.listAccounts(fintocLink.link_token);
      this.logger.log(
        `[fintoc] listAccounts ok link=${fintocLink.id} count=${fintocAccounts.length}`,
      );
    } catch (err) {
      await this.rollbackRemoteLink(fintocLink.id);
      this.audit.log({
        userId,
        actorType: 'user',
        actorId: userId,
        action: 'exchange_failed',
        ipAddress: meta.ip,
        userAgent: meta.userAgent,
        detail: {
          stage: 'list_accounts',
          error: this.describeError(err),
        },
      });
      throw new InternalServerErrorException(
        'No pudimos leer las cuentas del banco.',
      );
    }

    // 3. Persistir todo de forma atómica manual
    const persisted = await this.persistLinkAndAccounts({
      userId,
      fintocLink,
      fintocAccounts,
    });
    this.logger.log(
      `[fintoc] persist ok link_local=${persisted.link.id} accounts=${persisted.accounts.length}`,
    );

    // 4. Limpiar intent del Redis
    await this.redis.del(FINTOC_REDIS_KEYS.intent(userId));

    this.audit.log({
      linkId: persisted.link.id,
      userId,
      actorType: 'user',
      actorId: userId,
      action: 'exchange_succeeded',
      ipAddress: meta.ip,
      userAgent: meta.userAgent,
      detail: {
        institution_id: fintocLink.institution.id,
        accounts_count: fintocAccounts.length,
      },
    });

    // 5. Sync inicial de movimientos (best-effort: no bloquea la respuesta)
    //    Si falla, el link queda conectado igual y el próximo webhook los traerá.
    try {
      const syncResults = await this.sync.syncLink(persisted.link.id);
      const totalInserted = syncResults.reduce(
        (acc, r) => acc + r.transactionsInserted,
        0,
      );
      this.logger.log(
        `[fintoc] initial sync ok link=${persisted.link.id} movements_inserted=${totalInserted}`,
      );
    } catch (err) {
      this.logger.warn(
        `[fintoc] initial sync failed link=${persisted.link.id}: ${
          err instanceof Error ? err.message : String(err)
        }. El próximo webhook los traerá.`,
      );
    }

    return persisted;
  }

  // ── Listar links (sin exponer tokens) ────────────────────────

  async listUserLinks(userId: string): Promise<FintocLinkPublicDto[]> {
    const { data, error } = await this.supabase
      .from('fintoc_links')
      .select(
        'id, fintoc_link_id, institution_id, institution_name, holder_name, status, last_refresh_at, created_at',
      )
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (error) {
      this.logger.error(`Failed to list links: ${error.message}`);
      throw new InternalServerErrorException('No pudimos leer tus bancos.');
    }
    return (data ?? []) as FintocLinkPublicDto[];
  }

  // ── Revocar link ─────────────────────────────────────────────

  async revokeLink(
    userId: string,
    linkId: string,
    meta: AuditMeta,
  ): Promise<void> {
    this.logger.log(`[fintoc] revoke start user=${userId} link=${linkId}`);
    const link = await this.findLinkOrThrow(userId, linkId);

    // 1. Remote: pedirle a Fintoc que invalide el link
    if (link.fintoc_link_id) {
      try {
        await this.api.deleteLink(link.fintoc_link_id);
      } catch (err) {
        // Seguimos con el cleanup local aunque Fintoc falle.
        this.logger.warn(
          `Fintoc delete failed for link ${linkId}: ${this.describeError(err)}`,
        );
      }
    }

    // 2. Borrar el secret del Vault
    if (link.link_token_secret_id) {
      await this.crypto
        .deleteToken(link.link_token_secret_id)
        .catch((err) =>
          this.logger.error(`Vault delete failed: ${err.message}`),
        );
    }

    // 3. Marcar link como desconectado (no hacemos DELETE — histórico)
    await this.supabase
      .from('fintoc_links')
      .update({
        status: FINTOC_LINK_STATUS.DISCONNECTED,
        link_token_secret_id: null,
      })
      .eq('id', linkId);

    this.audit.log({
      linkId,
      userId,
      actorType: 'user',
      actorId: userId,
      action: 'link_revoked',
      ipAddress: meta.ip,
      userAgent: meta.userAgent,
    });

    this.logger.log(`[fintoc] revoke ok link=${linkId}`);
  }

  // ── Internals ────────────────────────────────────────────────

  private async requireActiveIntent(userId: string): Promise<void> {
    const raw = await this.redis.get(FINTOC_REDIS_KEYS.intent(userId));
    if (!raw) {
      throw new ForbiddenException(
        'No hay un link intent activo. Inicia el flujo de nuevo.',
      );
    }
  }

  private async persistLinkAndAccounts(params: {
    userId: string;
    fintocLink: FintocLink;
    fintocAccounts: FintocAccount[];
  }): Promise<ExchangeTokenResponseDto> {
    const { userId, fintocLink, fintocAccounts } = params;

    // 1. Guardar link_token en Vault (obtener secret_id)
    const secretName = `fintoc_link_${fintocLink.id}_${Date.now()}`;
    const secretId = await this.crypto.storeToken({
      token: fintocLink.link_token,
      name: secretName,
      description: `Fintoc link ${fintocLink.id} para user ${userId}`,
    });

    let insertedLinkId: string | null = null;

    try {
      // 2. INSERT fintoc_links
      const { data: linkRow, error: linkErr } = await this.supabase
        .from('fintoc_links')
        .insert({
          user_id: userId,
          link_token_secret_id: secretId,
          fintoc_link_id: fintocLink.id,
          institution_id: fintocLink.institution.id,
          institution_name: fintocLink.institution.name,
          holder_id: fintocLink.holder_id ?? null,
          holder_name: fintocLink.holder_name ?? null,
          status: FINTOC_LINK_STATUS.ACTIVE,
        })
        .select('*')
        .single();

      if (linkErr || !linkRow) {
        throw new Error(linkErr?.message ?? 'insert fintoc_links failed');
      }
      insertedLinkId = linkRow.id;

      // 3. INSERT accounts (N) — cada cuenta Fintoc crea una account local
      const accountRows = fintocAccounts.map((acc) => ({
        user_id: userId,
        name: acc.name,
        institution: fintocLink.institution.name,
        currency: acc.currency,
        current_balance: fromFintocMinorUnits(
          acc.balance.current ?? 0,
          acc.currency,
        ),
        fintoc_account_id: acc.id,
        fintoc_link_id: linkRow.id,
        last_synced_at: new Date().toISOString(),
      }));

      const { data: accountData, error: accErr } = await this.supabase
        .from('accounts')
        .insert(accountRows)
        .select('*');

      if (accErr || !accountData) {
        throw new Error(accErr?.message ?? 'insert accounts failed');
      }

      // 4. INSERT payment_method para cada cuenta (default: debito)
      const paymentMethodRows = accountData.map((accountRow, idx) => ({
        user_id: userId,
        account_id: accountRow.id,
        name: `${fintocLink.institution.name} — ${fintocAccounts[idx].name}`,
        institution: fintocLink.institution.name,
        currency: accountRow.currency,
        payment_type: 'debito' as const,
        fintoc_account_id: fintocAccounts[idx].id,
        fintoc_link_id: linkRow.id,
      }));

      const { data: pmData, error: pmErr } = await this.supabase
        .from('payment_method')
        .insert(paymentMethodRows)
        .select('id');

      if (pmErr) {
        throw new Error(`insert payment_method failed: ${pmErr.message}`);
      }

      this.logger.log(
        `[fintoc] payment_method inserted count=${pmData?.length ?? 0} expected=${paymentMethodRows.length}`,
      );

      if ((pmData?.length ?? 0) !== paymentMethodRows.length) {
        throw new Error(
          `payment_method insert returned ${pmData?.length ?? 0} rows, expected ${paymentMethodRows.length}`,
        );
      }

      return {
        link: this.toPublicLink(linkRow),
        accounts: accountData.map((a) => this.toPublicAccount(a)),
      };
    } catch (err) {
      await this.rollbackLocalState({
        insertedLinkId,
        secretId,
        fintocLinkId: fintocLink.id,
      });
      throw new InternalServerErrorException({
        message: 'Error guardando tu banco. Reintenta.',
        detail: this.describeError(err),
      });
    }
  }

  private async rollbackLocalState(params: {
    insertedLinkId: string | null;
    secretId: string;
    fintocLinkId: string;
  }): Promise<void> {
    // 1. Borrar link local (cascada borra accounts/payment_method por FK ON DELETE SET NULL)
    if (params.insertedLinkId) {
      await this.supabase
        .from('accounts')
        .delete()
        .eq('fintoc_link_id', params.insertedLinkId);
      await this.supabase
        .from('payment_method')
        .delete()
        .eq('fintoc_link_id', params.insertedLinkId);
      await this.supabase
        .from('fintoc_links')
        .delete()
        .eq('id', params.insertedLinkId);
    }
    // 2. Borrar secret del Vault
    await this.crypto
      .deleteToken(params.secretId)
      .catch((err) =>
        this.logger.error(`Vault rollback failed: ${err.message}`),
      );
    // 3. Invalidar link remoto en Fintoc
    await this.rollbackRemoteLink(params.fintocLinkId);
  }

  private async rollbackRemoteLink(fintocLinkId: string): Promise<void> {
    try {
      await this.api.deleteLink(fintocLinkId);
    } catch (err) {
      this.logger.warn(
        `Fintoc rollback deleteLink(${fintocLinkId}) failed: ${this.describeError(err)}`,
      );
    }
  }

  private async findLinkOrThrow(
    userId: string,
    linkId: string,
  ): Promise<{
    id: string;
    fintoc_link_id: string | null;
    link_token_secret_id: string | null;
  }> {
    const { data, error } = await this.supabase
      .from('fintoc_links')
      .select('id, fintoc_link_id, link_token_secret_id, user_id')
      .eq('id', linkId)
      .eq('user_id', userId)
      .maybeSingle();

    if (error) {
      throw new InternalServerErrorException('DB read failed.');
    }
    if (!data) {
      throw new NotFoundException('Link no encontrado.');
    }
    return data;
  }

  private toPublicLink(row: Record<string, any>): FintocLinkPublicDto {
    return {
      id: row.id,
      fintoc_link_id: row.fintoc_link_id ?? null,
      institution_id: row.institution_id,
      institution_name: row.institution_name ?? null,
      holder_name: row.holder_name ?? null,
      status: row.status,
      last_refresh_at: row.last_refresh_at ?? null,
      created_at: row.created_at,
    };
  }

  private toPublicAccount(row: Record<string, any>): FintocAccountPublicDto {
    return {
      id: row.id,
      name: row.name,
      institution: row.institution ?? null,
      currency: row.currency,
      current_balance: Number(row.current_balance ?? 0),
      fintoc_account_id: row.fintoc_account_id ?? null,
      last_synced_at: row.last_synced_at ?? null,
    };
  }

  private describeError(err: unknown): string {
    if (err instanceof FintocApiError) {
      return err.message;
    }
    if (err instanceof Error) {
      return err.message;
    }
    return String(err);
  }
}
