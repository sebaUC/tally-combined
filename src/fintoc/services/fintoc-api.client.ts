import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance, AxiosError } from 'axios';
import {
  FintocAccount,
  FintocLink,
  FintocLinkIntent,
  FintocMovement,
  FintocRefreshIntent,
} from '../contracts/fintoc-api.types';
import { FINTOC_API_BASE } from '../constants/fintoc.constants';

/**
 * HTTP client a api.fintoc.com.
 * SIN lógica de negocio — sólo requests + mapeo de errores.
 *
 * Seguridad:
 * - Autenticación vía Authorization header con secret_key
 * - Nunca loggea el secret_key ni los link_tokens
 * - Timeout de 30s por request
 */
@Injectable()
export class FintocApiClient implements OnModuleInit {
  private readonly logger = new Logger(FintocApiClient.name);
  private http!: AxiosInstance;
  private secretKey!: string;

  constructor(private readonly config: ConfigService) {}

  onModuleInit(): void {
    const secretKey = this.config.get<string>('FINTOC_SECRET_KEY');
    if (!secretKey) {
      throw new Error('FINTOC_SECRET_KEY env var is required');
    }
    this.secretKey = secretKey;

    this.http = axios.create({
      baseURL: this.config.get<string>('FINTOC_API_BASE') ?? FINTOC_API_BASE,
      timeout: 30_000,
      headers: {
        Authorization: this.secretKey,
        'Content-Type': 'application/json',
        'User-Agent': 'TallyFinance-Backend/1.0',
      },
    });
  }

  // ── Link Intents ─────────────────────────────────────────────

  async createLinkIntent(params: {
    product: 'movements';
    country: 'cl';
    holderType?: 'individual' | 'business';
  }): Promise<FintocLinkIntent> {
    return this.request<FintocLinkIntent>('POST', '/link_intents', {
      body: {
        product: params.product,
        country: params.country,
        holder_type: params.holderType ?? 'individual',
      },
    });
  }

  async exchangeLinkToken(exchangeToken: string): Promise<FintocLink> {
    return this.request<FintocLink>('GET', '/links/exchange', {
      query: { exchange_token: exchangeToken },
    });
  }

  // ── Accounts ─────────────────────────────────────────────────

  async listAccounts(linkToken: string): Promise<FintocAccount[]> {
    return this.request<FintocAccount[]>('GET', '/accounts', {
      query: { link_token: linkToken },
    });
  }

  // ── Movements ────────────────────────────────────────────────

  async listMovements(params: {
    linkToken: string;
    accountId: string;
    since?: string;
    until?: string;
    page?: number;
    perPage?: number;
  }): Promise<FintocMovement[]> {
    return this.request<FintocMovement[]>(
      'GET',
      `/accounts/${params.accountId}/movements`,
      {
        query: {
          link_token: params.linkToken,
          since: params.since,
          until: params.until,
          page: params.page,
          per_page: params.perPage,
        },
      },
    );
  }

  // ── Refresh Intents ──────────────────────────────────────────

  async createRefreshIntent(
    linkToken: string,
    refreshType: 'only_last' | 'historical' = 'only_last',
  ): Promise<FintocRefreshIntent> {
    return this.request<FintocRefreshIntent>('POST', '/refresh_intents', {
      query: {
        link_token: linkToken,
        refresh_type: refreshType,
      },
    });
  }

  // ── Link revoke ──────────────────────────────────────────────

  async deleteLink(linkId: string): Promise<void> {
    await this.request<void>('DELETE', `/links/${linkId}`);
  }

  // ── Internal ─────────────────────────────────────────────────

  private async request<T>(
    method: 'GET' | 'POST' | 'DELETE',
    path: string,
    opts: {
      query?: Record<string, unknown>;
      body?: Record<string, unknown>;
    } = {},
  ): Promise<T> {
    try {
      const response = await this.http.request<T>({
        method,
        url: path,
        params: opts.query,
        data: opts.body,
      });
      return response.data;
    } catch (err) {
      throw this.normalizeError(err, method, path);
    }
  }

  private normalizeError(
    err: unknown,
    method: string,
    path: string,
  ): FintocApiError {
    if (axios.isAxiosError(err)) {
      const axiosErr = err as AxiosError<{ error?: { message?: string } }>;
      const status = axiosErr.response?.status ?? 0;
      const message =
        axiosErr.response?.data?.error?.message ?? axiosErr.message;
      this.logger.warn(`Fintoc API ${method} ${path} -> ${status}: ${message}`);
      return new FintocApiError(status, message, path);
    }
    const message = err instanceof Error ? err.message : String(err);
    this.logger.error(`Fintoc API ${method} ${path} unknown error: ${message}`);
    return new FintocApiError(0, message, path);
  }
}

export class FintocApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly path: string,
  ) {
    super(`[Fintoc ${status}] ${path}: ${message}`);
    this.name = 'FintocApiError';
  }
}
