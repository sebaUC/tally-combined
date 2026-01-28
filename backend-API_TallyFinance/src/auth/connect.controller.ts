import {
  Controller,
  Get,
  Param,
  Req,
  Res,
  Inject,
  Logger,
  Query,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SupabaseClient } from '@supabase/supabase-js';
import type { Request, Response } from 'express';
import { ChannelLinkCodeService } from '../common/utils/channel-link-code.service';

type RequestWithCookies = Request & { cookies?: Record<string, string> };

/**
 * ConnectController handles the channel linking flow.
 *
 * Flow:
 * 1. Bot sends user to /connect/{code}
 * 2. If user has active session → auto-link and redirect to success
 * 3. If user has NO session → redirect to login with return URL
 * 4. After login → user returns to /connect/{code} → auto-link
 */
@Controller('connect')
export class ConnectController {
  private readonly log = new Logger(ConnectController.name);

  constructor(
    @Inject('SUPABASE') private readonly supabase: SupabaseClient,
    private readonly linkCodes: ChannelLinkCodeService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Main entry point for channel linking.
   * Handles both authenticated and unauthenticated users.
   *
   * @param code - The 8-character link code from the bot
   * @param force - Optional query param to force overwrite existing link
   */
  @Get(':code')
  async handleConnect(
    @Param('code') code: string,
    @Query('force') force: string | undefined,
    @Req() req: RequestWithCookies,
    @Res() res: Response,
  ) {
    const frontendBaseUrl = this.getFrontendBaseUrl();
    const forceOverwrite = force === 'true' || force === '1';

    this.log.debug(`[connect] Processing code: ${code}`);

    // 1. Validate the code exists and is not expired/used
    let codeData: { channel: string; externalId: string };
    try {
      const peeked = await this.linkCodes.peek(code);
      codeData = {
        channel: peeked.channel,
        externalId: peeked.externalId,
      };
      this.log.debug(
        `[connect] Code valid: channel=${codeData.channel}, externalId=${codeData.externalId}`,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Invalid code';
      this.log.warn(`[connect] Code validation failed: ${message}`);
      return res.redirect(
        `${frontendBaseUrl}/connect/error?reason=invalid_code&message=${encodeURIComponent(message)}`,
      );
    }

    // 2. Check if user has active session
    const token = this.extractToken(req);
    if (!token) {
      this.log.debug('[connect] No session, redirecting to login');
      const returnUrl = `${this.getBackendBaseUrl()}/connect/${code}`;
      return res.redirect(
        `${frontendBaseUrl}/login?redirect=${encodeURIComponent(returnUrl)}`,
      );
    }

    // 3. Validate the token and get user
    const { data: userData, error: userError } =
      await this.supabase.auth.getUser(token);
    if (userError || !userData.user) {
      this.log.debug('[connect] Invalid session, redirecting to login');
      const returnUrl = `${this.getBackendBaseUrl()}/connect/${code}`;
      return res.redirect(
        `${frontendBaseUrl}/login?redirect=${encodeURIComponent(returnUrl)}`,
      );
    }

    const userId = userData.user.id;
    this.log.debug(`[connect] User authenticated: ${userId}`);

    // 4. Check if channel is already linked
    const { data: existing } = await this.supabase
      .from('channel_accounts')
      .select('user_id')
      .eq('channel', codeData.channel)
      .eq('external_user_id', codeData.externalId)
      .maybeSingle<{ user_id: string }>();

    // 4a. Already linked to same user - success
    if (existing?.user_id === userId) {
      this.log.debug('[connect] Channel already linked to this user');
      await this.consumeCodeSafely(code);
      return res.redirect(
        `${frontendBaseUrl}/connect/success?channel=${codeData.channel}&already_linked=true`,
      );
    }

    // 4b. Linked to different user - need confirmation
    if (existing?.user_id && existing.user_id !== userId) {
      if (!forceOverwrite) {
        this.log.debug(
          '[connect] Channel linked to different user, need confirmation',
        );
        return res.redirect(
          `${frontendBaseUrl}/connect/confirm?code=${code}&channel=${codeData.channel}`,
        );
      }

      // Force overwrite - update the existing record
      this.log.warn(
        `[connect] Overwriting: ${codeData.channel}/${codeData.externalId} from ${existing.user_id} to ${userId}`,
      );

      const { error: updateError } = await this.supabase
        .from('channel_accounts')
        .update({ user_id: userId })
        .eq('channel', codeData.channel)
        .eq('external_user_id', codeData.externalId);

      if (updateError) {
        this.log.error(`[connect] Overwrite failed: ${updateError.message}`);
        return res.redirect(
          `${frontendBaseUrl}/connect/error?reason=link_failed&message=${encodeURIComponent('No se pudo vincular el canal.')}`,
        );
      }

      await this.consumeCodeSafely(code);
      return res.redirect(
        `${frontendBaseUrl}/connect/success?channel=${codeData.channel}&overwrote=true`,
      );
    }

    // 5. Create new channel account link
    const { error: insertError } = await this.supabase
      .from('channel_accounts')
      .insert({
        user_id: userId,
        channel: codeData.channel,
        external_user_id: codeData.externalId,
        username: null,
      });

    if (insertError) {
      this.log.error(`[connect] Insert failed: ${insertError.message}`);
      return res.redirect(
        `${frontendBaseUrl}/connect/error?reason=link_failed&message=${encodeURIComponent('No se pudo vincular el canal.')}`,
      );
    }

    // 6. Consume the code and redirect to success
    await this.consumeCodeSafely(code);
    this.log.log(
      `[connect] Channel ${codeData.channel}/${codeData.externalId} linked to ${userId}`,
    );

    return res.redirect(
      `${frontendBaseUrl}/connect/success?channel=${codeData.channel}`,
    );
  }

  /**
   * API endpoint for linking via AJAX (alternative to redirect flow).
   * Requires authentication via JWT cookie or Authorization header.
   */
  @Get(':code/api')
  async handleConnectApi(
    @Param('code') code: string,
    @Query('force') force: string | undefined,
    @Req() req: RequestWithCookies,
    @Res() res: Response,
  ) {
    const forceOverwrite = force === 'true' || force === '1';

    // 1. Validate authentication
    const token = this.extractToken(req);
    if (!token) {
      return res.status(401).json({
        ok: false,
        error: 'unauthorized',
        message: 'No hay sesión activa. Inicia sesión primero.',
      });
    }

    const { data: userData, error: userError } =
      await this.supabase.auth.getUser(token);
    if (userError || !userData.user) {
      return res.status(401).json({
        ok: false,
        error: 'unauthorized',
        message: 'Sesión inválida. Inicia sesión nuevamente.',
      });
    }

    const userId = userData.user.id;

    // 2. Validate code
    let codeData: { channel: string; externalId: string };
    try {
      const peeked = await this.linkCodes.peek(code);
      codeData = {
        channel: peeked.channel,
        externalId: peeked.externalId,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Código inválido';
      return res.status(400).json({
        ok: false,
        error: 'invalid_code',
        message,
      });
    }

    // 3. Check existing link
    const { data: existing } = await this.supabase
      .from('channel_accounts')
      .select('user_id')
      .eq('channel', codeData.channel)
      .eq('external_user_id', codeData.externalId)
      .maybeSingle<{ user_id: string }>();

    if (existing?.user_id === userId) {
      await this.consumeCodeSafely(code);
      return res.status(200).json({
        ok: true,
        message: 'Canal ya estaba vinculado.',
        channel: codeData.channel,
        alreadyLinked: true,
      });
    }

    if (existing?.user_id && existing.user_id !== userId) {
      if (!forceOverwrite) {
        return res.status(409).json({
          ok: false,
          error: 'conflict',
          message:
            'Este canal ya está vinculado a otra cuenta. Usa ?force=true para sobrescribir.',
          requiresConfirmation: true,
        });
      }

      const { error: updateError } = await this.supabase
        .from('channel_accounts')
        .update({ user_id: userId })
        .eq('channel', codeData.channel)
        .eq('external_user_id', codeData.externalId);

      if (updateError) {
        return res.status(500).json({
          ok: false,
          error: 'link_failed',
          message: 'No se pudo vincular el canal.',
        });
      }

      await this.consumeCodeSafely(code);
      return res.status(200).json({
        ok: true,
        message: 'Canal vinculado (sobrescribió cuenta anterior).',
        channel: codeData.channel,
        overwrote: true,
      });
    }

    // 4. Create new link
    const { error: insertError } = await this.supabase
      .from('channel_accounts')
      .insert({
        user_id: userId,
        channel: codeData.channel,
        external_user_id: codeData.externalId,
        username: null,
      });

    if (insertError) {
      return res.status(500).json({
        ok: false,
        error: 'link_failed',
        message: 'No se pudo vincular el canal.',
      });
    }

    await this.consumeCodeSafely(code);
    return res.status(200).json({
      ok: true,
      message: 'Canal vinculado exitosamente.',
      channel: codeData.channel,
    });
  }

  /**
   * Extracts JWT token from cookies or Authorization header.
   */
  private extractToken(req: RequestWithCookies): string | undefined {
    const auth = req.headers.authorization;
    if (auth?.startsWith('Bearer ')) {
      return auth.replace('Bearer ', '').trim();
    }

    const cookies = req.cookies ?? this.parseCookieHeader(req.headers.cookie);
    return cookies?.access_token;
  }

  /**
   * Parses cookie header string into key-value pairs.
   */
  private parseCookieHeader(header?: string): Record<string, string> {
    if (!header) return {};
    return header.split(';').reduce<Record<string, string>>((acc, current) => {
      const [rawKey, ...rest] = current.trim().split('=');
      if (!rawKey) return acc;
      acc[rawKey] = decodeURIComponent(rest.join('='));
      return acc;
    }, {});
  }

  /**
   * Gets the frontend base URL from config.
   */
  private getFrontendBaseUrl(): string {
    const linkUrl = this.config.get<string>('LINK_ACCOUNT_URL') ?? '';
    // Extract base URL from LINK_ACCOUNT_URL (e.g., http://localhost:5173/connect/ → http://localhost:5173)
    try {
      const url = new URL(linkUrl);
      return `${url.protocol}//${url.host}`;
    } catch {
      // Fallback to localhost
      return 'http://localhost:5173';
    }
  }

  /**
   * Gets the backend base URL from config.
   */
  private getBackendBaseUrl(): string {
    return this.config.get<string>('APP_BASE_URL') ?? 'http://localhost:3000';
  }

  /**
   * Safely consumes a code, logging errors but not throwing.
   */
  private async consumeCodeSafely(code: string): Promise<void> {
    try {
      await this.linkCodes.consume(code);
    } catch (err) {
      this.log.warn(`[connect] Failed to consume code ${code}: ${err}`);
    }
  }
}
