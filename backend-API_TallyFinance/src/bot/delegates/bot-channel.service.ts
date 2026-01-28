import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SupabaseClient } from '@supabase/supabase-js';
import { ChannelLinkCodeService } from '../../common/utils/channel-link-code.service';
import { DomainMessage } from '../contracts';

@Injectable()
export class BotChannelService {
  private readonly log = new Logger(BotChannelService.name);
  private readonly linkTtlMs = 10 * 60 * 1000; // 10 minutes

  constructor(
    @Inject('SUPABASE') private readonly supabase: SupabaseClient,
    private readonly linkCodes: ChannelLinkCodeService,
    private readonly cfg: ConfigService,
  ) {}

  /**
   * Handles /start commands from Telegram.
   * Supports two flows:
   * 1. Web-initiated: Code has "pending:{userId}" - complete linking here
   * 2. Bot-initiated: Code has real externalId - redirect to web
   *
   * @param m - The incoming domain message
   * @returns A reply message if /start was handled, null otherwise
   */
  async handleStartCommand(m: DomainMessage): Promise<string | null> {
    const code = this.extractStartCode(m);
    if (!code) return null;

    // First, validate the code to understand the context
    let peeked: { channel: string; externalId: string } | null = null;
    try {
      peeked = await this.linkCodes.peek(code);
    } catch (err) {
      this.log.warn(`[handleStartCommand] Code validation failed: ${err}`);
      // Code might be expired or invalid - generate a new one
      return this.buildLinkReply(m);
    }

    // Check if code matches this channel
    if (peeked.channel !== m.channel) {
      this.log.warn(
        `[handleStartCommand] Channel mismatch: code=${peeked.channel} message=${m.channel}`,
      );
      return '⚠️ Este código es para otro canal. Genera uno nuevo desde la web.';
    }

    // Check if this channel is already linked
    const existingUserId = await this.lookupLinkedUser(m);

    // Check for web-initiated flow (externalId starts with "pending:")
    if (peeked.externalId.startsWith('pending:')) {
      const targetUserId = peeked.externalId.replace('pending:', '');

      // If channel is already linked, check to whom
      if (existingUserId) {
        if (existingUserId === targetUserId) {
          // Already linked to the same user - success
          await this.consumeCodeSafely(code);
          return '✅ Tu canal ya está vinculado a esta cuenta. Puedes empezar a usar el bot.';
        } else {
          // Linked to a different user - conflict!
          this.log.warn(
            `[handleStartCommand] Conflict: channel ${m.channel}/${m.externalId} linked to ${existingUserId}, but code is for ${targetUserId}`,
          );
          // Mark the code as conflicted so frontend can detect it
          const conflictReason = 'Este canal ya está vinculado a otra cuenta de Tally. Para cambiarlo, desvincúlalo primero desde la web de esa cuenta.';
          this.linkCodes.markConflict(code, conflictReason);
          return '⚠️ Este canal ya está vinculado a otra cuenta de Tally.\n\nPara vincularlo a esta cuenta, primero debes desvincularlo desde la web de la otra cuenta (Ajustes > Canal vinculado).';
        }
      }

      return this.completeWebInitiatedLink(code, targetUserId, m);
    }

    // Bot-initiated flow: Check if code matches this user's external ID
    if (peeked.externalId !== m.externalId) {
      this.log.warn(
        `[handleStartCommand] ExternalId mismatch: code=${peeked.externalId} message=${m.externalId}`,
      );
      return '⚠️ Este código no corresponde a este chat. Genera uno nuevo desde la web.';
    }

    // If already linked (bot-initiated flow)
    if (existingUserId) {
      return '✅ Tu canal ya está vinculado. Puedes empezar a usar el bot.';
    }

    // Code is valid for this user - guide them to backend connect endpoint
    const link = this.buildConnectUrl(code);
    if (!link) {
      return '⚠️ No pudimos completar la vinculación. Intenta más tarde.';
    }

    return [
      '👋 ¡Ya casi!',
      'Para completar la vinculación, abre este enlace e inicia sesión:',
      link,
    ].join('\n');
  }

  /**
   * Completes web-initiated linking directly from the bot.
   * Called when user creates code on web, then sends /start CODE to bot.
   */
  private async completeWebInitiatedLink(
    code: string,
    userId: string,
    m: DomainMessage,
  ): Promise<string> {
    this.log.debug(
      `[completeWebInitiatedLink] Completing web-initiated link: userId=${userId}, externalId=${m.externalId}`,
    );

    // Check if channel is already linked to another user
    const { data: existing } = await this.supabase
      .from('channel_accounts')
      .select('user_id')
      .eq('channel', m.channel)
      .eq('external_user_id', m.externalId)
      .maybeSingle<{ user_id: string }>();

    if (existing?.user_id && existing.user_id !== userId) {
      return '⚠️ Este canal ya está vinculado a otra cuenta. Primero desvincula desde la web.';
    }

    if (existing?.user_id === userId) {
      // Already linked to same user
      await this.consumeCodeSafely(code);
      return '✅ Tu canal ya está vinculado. Puedes empezar a usar el bot.';
    }

    // Create channel account entry
    const { error } = await this.supabase.from('channel_accounts').insert({
      user_id: userId,
      channel: m.channel,
      external_user_id: m.externalId,
      username: null,
    });

    if (error) {
      this.log.error(
        `[completeWebInitiatedLink] Insert failed: ${error.message}`,
      );
      return '⚠️ No se pudo vincular el canal. Intenta de nuevo.';
    }

    // Consume the code
    await this.consumeCodeSafely(code);

    this.log.log(
      `[completeWebInitiatedLink] Channel ${m.channel}/${m.externalId} linked to ${userId}`,
    );

    return '✅ ¡Listo! Tu canal ha sido vinculado exitosamente. Ya puedes empezar a usar el bot.';
  }

  /**
   * Safely consumes a code, logging errors but not throwing.
   */
  private async consumeCodeSafely(code: string): Promise<void> {
    try {
      await this.linkCodes.consume(code);
    } catch (err) {
      this.log.warn(`[consumeCodeSafely] Failed to consume code: ${err}`);
    }
  }

  /**
   * Looks up if a user has a linked account for this channel.
   *
   * @param m - The incoming domain message
   * @returns The user ID if linked, null otherwise
   */
  async lookupLinkedUser(m: DomainMessage): Promise<string | null> {
    const { data, error, status } = await this.supabase
      .from('channel_accounts')
      .select('user_id')
      .eq('channel', m.channel)
      .eq('external_user_id', m.externalId)
      .maybeSingle<{ user_id: string }>();

    if (error && status !== 406) {
      this.log.warn(
        `[lookupLinkedUser] Error querying channel_accounts: ${error.message}`,
      );
    } else if (data?.user_id) {
      this.log.debug(`[lookupLinkedUser] Found linked user: ${data.user_id}`);
    } else {
      this.log.debug(
        `[lookupLinkedUser] No linked user for ${m.channel}/${m.externalId}`,
      );
    }

    return data?.user_id ?? null;
  }

  /**
   * Builds a reply message with a link to connect the channel.
   * Creates or reuses a link code for the user.
   *
   * @param m - The incoming domain message
   * @returns A message with the link URL
   */
  async buildLinkReply(m: DomainMessage): Promise<string> {
    // Check if there's an existing valid code for this user
    const existing = await this.linkCodes.findByExternalId(
      m.channel,
      m.externalId,
    );

    let code: string;
    if (existing) {
      code = existing.code;
      this.log.debug(`[buildLinkReply] Reusing existing code: ${code}`);
    } else {
      // Create a new code
      const exp = Date.now() + this.linkTtlMs;
      const result = await this.linkCodes.create({
        channel: m.channel,
        externalId: m.externalId,
        expiresAt: exp,
      });
      code = result.code;
      this.log.debug(`[buildLinkReply] Created new code: ${code}`);
    }

    const link = this.buildConnectUrl(code);
    if (!link) {
      return '⚠️ No pudimos generar el enlace de vinculación. Intenta más tarde.';
    }

    return [
      '👋 ¡Hola! Aún no hemos vinculado tu cuenta.',
      'Para conectar tu canal, abre este enlace e inicia sesión:',
      link,
    ].join('\n');
  }

  /**
   * Builds the URL to the frontend connect page.
   *
   * @param code - The link code
   * @returns The full URL or null if not configured
   */
  private buildConnectUrl(code: string): string | null {
    const linkAccountUrl = this.cfg.get<string>('LINK_ACCOUNT_URL');
    if (!linkAccountUrl) {
      this.log.error('[buildConnectUrl] LINK_ACCOUNT_URL not configured');
      return null;
    }

    // Extract base URL (e.g., https://frontend.vercel.app/connect/ → https://frontend.vercel.app)
    let baseUrl: string;
    try {
      const url = new URL(linkAccountUrl);
      baseUrl = url.origin;
    } catch {
      // If not a valid URL, use as-is without trailing slash
      baseUrl = linkAccountUrl.replace(/\/+$/, '');
    }

    return `${baseUrl}/connect/${code}`;
  }

  /**
   * Extracts a code from a /start command.
   * Only works for Telegram messages.
   *
   * @param m - The incoming domain message
   * @returns The extracted code, or null if not a /start command
   */
  private extractStartCode(m: DomainMessage): string | null {
    if (m.channel !== 'telegram') return null;

    const match = /^\/start(?:\s+(\S+))?$/i.exec(m.text.trim());
    if (!match) return null;

    return match[1] ?? null;
  }
}
