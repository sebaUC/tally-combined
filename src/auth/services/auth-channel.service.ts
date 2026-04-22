import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { ChannelLinkCodeService } from '../../common/utils/channel-link-code.service';
import { Channel } from '../../bot/contracts';

/**
 * DTO for linking a channel via code.
 * In the new simplified flow, only linkCode is supported.
 */
export interface LinkChannelDto {
  linkCode: string;
  force?: boolean;
}

@Injectable()
export class AuthChannelService {
  private readonly logger = new Logger(AuthChannelService.name);

  constructor(
    @Inject('SUPABASE') private readonly supabase: SupabaseClient,
    private readonly linkCodes: ChannelLinkCodeService,
  ) {}

  /**
   * Links a messaging channel to a user account.
   * Consumes the link code and creates/updates channel_accounts entry.
   *
   * Flow:
   * 1. Consume the link code (validates and marks as used)
   * 2. Check for existing channel_accounts entry
   * 3. Handle conflicts (force flag required for overwrite)
   * 4. Create or update channel_accounts entry
   *
   * @param userId - The authenticated user's ID
   * @param dto - Contains the link code and optional force flag
   * @returns The linked channel account record
   */
  async linkChannel(userId: string, dto: LinkChannelDto) {
    if (!dto.linkCode) {
      throw new BadRequestException(
        'Debe proporcionar un código de vinculación.',
      );
    }

    // Consume the code (validates and marks as used)
    let codeData: { channel: Channel; externalId: string };
    try {
      const result = await this.linkCodes.consume(dto.linkCode);
      codeData = {
        channel: result.channel,
        externalId: result.externalId,
      };
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Error al validar el código.';
      throw new BadRequestException(message);
    }

    const { channel, externalId } = codeData;

    // Check for existing channel account
    const {
      data: existing,
      error: existingError,
      status,
    } = await this.supabase
      .from('channel_accounts')
      .select('user_id')
      .eq('channel', channel)
      .eq('external_user_id', externalId)
      .maybeSingle<{ user_id: string }>();

    if (existingError && status !== 406) {
      this.logger.error(
        `[linkChannel] Lookup failed: ${existingError.message}`,
      );
      throw new InternalServerErrorException('Error buscando canal existente.');
    }

    // Handle conflict: channel linked to different user
    if (existing?.user_id && existing.user_id !== userId) {
      if (!dto.force) {
        throw new ConflictException(
          '⚠️ Este canal ya está vinculado a otra cuenta. ¿Deseas vincularlo a tu cuenta actual y desconectar la anterior? Reintenta con "force": true.',
        );
      }

      this.logger.warn(
        `[linkChannel] Overwrite: ${channel}/${externalId} reassigned to ${userId} (was ${existing.user_id})`,
      );

      const { error: overwriteError } = await this.supabase
        .from('channel_accounts')
        .update({ user_id: userId })
        .eq('channel', channel)
        .eq('external_user_id', externalId);

      if (overwriteError) {
        this.logger.error(
          `[linkChannel] Overwrite failed: ${overwriteError.message}`,
        );
        throw new InternalServerErrorException(
          'No se pudo sobreescribir la vinculación del canal.',
        );
      }

      return this.fetchChannelAccount(channel, externalId);
    }

    // Handle idempotent case: already linked to same user
    if (existing?.user_id === userId) {
      this.logger.log(`[linkChannel] Channel already linked for ${userId}`);
      return this.fetchChannelAccount(channel, externalId);
    }

    // Create new channel account entry
    const { data, error } = await this.supabase
      .from('channel_accounts')
      .insert({
        user_id: userId,
        channel,
        external_user_id: externalId,
        username: null,
      })
      .select('id, user_id, channel, external_user_id, username, created_at')
      .single();

    if (error) {
      this.logger.error(`[linkChannel] Insert failed: ${error.message}`);
      throw new InternalServerErrorException('No se pudo vincular el canal.');
    }

    this.logger.log(
      `[linkChannel] Channel ${channel}/${externalId} linked to ${userId}`,
    );
    return data;
  }

  /**
   * Creates a link token for web-initiated channel linking.
   * User starts from web → gets code → sends to bot.
   *
   * @param userId - The authenticated user's ID
   * @param channel - The channel to link (telegram or whatsapp)
   * @returns Link code and expiration info
   */
  async createLinkToken(userId: string, channel: Channel) {
    const expiresInMs = 5 * 60 * 1000; // 5 minutes
    const expiresAt = Date.now() + expiresInMs;

    // Create code with a placeholder external_user_id (will be updated by bot)
    // We use the format "pending:{userId}" to mark it as web-initiated
    const result = await this.linkCodes.create({
      channel,
      externalId: `pending:${userId}`,
      expiresAt,
    });

    const expiresAtIso = new Date(expiresAt).toISOString();

    this.logger.log(
      `[createLinkToken] Created code ${result.code} for user ${userId}, channel ${channel}`,
    );

    return {
      linkCode: result.code,
      expiresAt: expiresAtIso,
      expiresInSeconds: Math.floor(expiresInMs / 1000),
      channel,
      // Instructions for the user
      instructions: this.getLinkInstructions(channel, result.code),
    };
  }

  /**
   * Gets instructions for linking based on channel.
   */
  private getLinkInstructions(channel: Channel, code: string): string {
    if (channel === 'telegram') {
      return `Abre Telegram y envía /start ${code} al bot @TallyFinanceBot`;
    }
    return `Envía el código ${code} al bot de TallyFinance en WhatsApp`;
  }

  /**
   * Gets the link status for all channels linked to a user.
   *
   * @param userId - The authenticated user's ID
   * @returns Object with linked status and list of channel accounts
   */
  async getLinkStatus(userId: string) {
    const { data, error } = await this.supabase
      .from('channel_accounts')
      .select('channel, external_user_id, username, created_at')
      .eq('user_id', userId);

    if (error) {
      this.logger.error(
        `[getLinkStatus] Failed to fetch channel accounts: ${error.message}`,
      );
      throw new InternalServerErrorException(
        'No se pudo obtener el estado de vinculación.',
      );
    }

    const accounts = data ?? [];
    return {
      linked: accounts.length > 0,
      channels: accounts,
    };
  }

  /**
   * Unlinks a channel from a user account.
   *
   * @param userId - The authenticated user's ID
   * @param channel - The channel to unlink (telegram or whatsapp)
   * @returns Success status
   */
  async unlinkChannel(userId: string, channel: Channel) {
    const { error, count } = await this.supabase
      .from('channel_accounts')
      .delete()
      .eq('user_id', userId)
      .eq('channel', channel);

    if (error) {
      this.logger.error(`[unlinkChannel] Delete failed: ${error.message}`);
      throw new InternalServerErrorException(
        'No se pudo desvincular el canal.',
      );
    }

    if (count === 0) {
      throw new BadRequestException('No hay canal vinculado para desvincular.');
    }

    this.logger.log(
      `[unlinkChannel] Channel ${channel} unlinked for ${userId}`,
    );
    return { success: true };
  }

  /**
   * Fetches a channel account by channel and external user ID.
   */
  private async fetchChannelAccount(channel: Channel, externalId: string) {
    const { data, error } = await this.supabase
      .from('channel_accounts')
      .select('id, user_id, channel, external_user_id, username, created_at')
      .eq('channel', channel)
      .eq('external_user_id', externalId)
      .single();

    if (error) {
      throw new InternalServerErrorException(
        'Error obteniendo canal vinculado.',
      );
    }

    return data;
  }
}
