import { Inject, Injectable, Logger } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { randomBytes } from 'crypto';
import { Channel } from '../../bot/contracts';

/**
 * Input for creating a new link code.
 * Codes are created by the bot when an unlinked user sends a message.
 */
export type CreateCodeInput = {
  channel: Channel;
  externalId: string; // Required: comes from the bot message
  expiresAt: number; // Expiration timestamp in milliseconds
};

/**
 * Database record structure for channel_link_codes.
 */
type CodeRecord = {
  code: string;
  channel: Channel;
  external_user_id: string;
  expires_at: string;
  used_at: string | null;
};

/**
 * Result returned when consuming or peeking a code.
 */
export type CodeLookupResult = {
  code: string;
  channel: Channel;
  externalId: string;
  expiresAt: number;
};

/**
 * Conflict information stored in memory.
 */
export type CodeConflict = {
  code: string;
  reason: string;
  conflictedAt: number;
};

@Injectable()
export class ChannelLinkCodeService {
  private readonly log = new Logger(ChannelLinkCodeService.name);

  // In-memory conflict tracking (TTL: 10 minutes)
  private readonly conflicts = new Map<string, CodeConflict>();
  private readonly conflictTtlMs = 10 * 60 * 1000;

  constructor(@Inject('SUPABASE') private readonly supabase: SupabaseClient) {}

  /**
   * Creates a new link code for the given channel and external user.
   * Uses upsert to update existing codes for the same channel/externalId.
   *
   * @param input - Channel, external user ID, and expiration
   * @returns The generated code and its expiration
   */
  async create({ channel, externalId, expiresAt }: CreateCodeInput): Promise<{
    code: string;
    expiresAt: number;
  }> {
    const payloadBase = {
      channel,
      external_user_id: externalId,
      expires_at: new Date(expiresAt).toISOString(),
      created_at: new Date().toISOString(),
      used_at: null,
    };

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const code = this.generateCode();
      const payload = { ...payloadBase, code };

      // Always upsert on channel + external_user_id to reuse/update existing codes
      const { error } = await this.supabase
        .from('channel_link_codes')
        .upsert(payload, { onConflict: 'channel,external_user_id' });

      if (!error) {
        this.log.debug(
          `[create] Code ${code} issued for channel=${channel} externalId=${externalId}`,
        );
        return { code, expiresAt };
      }

      // Handle unique constraint violation on code (very rare with 8-char hex)
      if (error.code === '23505') {
        this.log.warn(
          `[create] Duplicate code generated (${code}), retrying...`,
        );
        continue;
      }

      this.log.error(`[create] Upsert failed: ${error.message}`);
      break;
    }

    throw new Error('No se pudo generar el código de vinculación.');
  }

  /**
   * Consumes a link code, marking it as used.
   * Returns the code data if valid, throws otherwise.
   *
   * @param code - The 8-character code to consume
   * @returns Channel and external user ID for linking
   */
  async consume(code: string): Promise<CodeLookupResult> {
    const data = await this.lookupValidCode(code, { allowUsed: false });

    const { error: updateError } = await this.supabase
      .from('channel_link_codes')
      .update({ used_at: new Date().toISOString() })
      .eq('code', code);

    if (updateError) {
      this.log.error(
        `[consume] Failed to mark code as used: ${updateError.message}`,
      );
      throw new Error('No se pudo completar la vinculación.');
    }

    this.log.debug(`[consume] Code ${code} consumed successfully`);

    return {
      code: data.code,
      channel: data.channel,
      externalId: data.external_user_id,
      expiresAt: new Date(data.expires_at).getTime(),
    };
  }

  /**
   * Peeks at a link code without consuming it.
   * Useful for validation before performing other operations.
   *
   * @param code - The 8-character code to peek
   * @returns Channel and external user ID
   */
  async peek(code: string): Promise<CodeLookupResult> {
    const data = await this.lookupValidCode(code, { allowUsed: false });

    return {
      code: data.code,
      channel: data.channel,
      externalId: data.external_user_id,
      expiresAt: new Date(data.expires_at).getTime(),
    };
  }

  /**
   * Looks up a code by channel and external user ID.
   * Useful for checking if a code already exists for a user.
   *
   * @param channel - The messaging channel
   * @param externalId - The platform-specific user ID
   * @returns The code data if found and valid, null otherwise
   */
  async findByExternalId(
    channel: Channel,
    externalId: string,
  ): Promise<CodeLookupResult | null> {
    const { data, error } = await this.supabase
      .from('channel_link_codes')
      .select('*')
      .eq('channel', channel)
      .eq('external_user_id', externalId)
      .is('used_at', null)
      .maybeSingle<CodeRecord>();

    if (error) {
      this.log.error(`[findByExternalId] Lookup failed: ${error.message}`);
      return null;
    }

    if (!data) {
      return null;
    }

    // Check expiration
    const expiresAt = new Date(data.expires_at).getTime();
    if (Date.now() > expiresAt) {
      return null;
    }

    return {
      code: data.code,
      channel: data.channel,
      externalId: data.external_user_id,
      expiresAt,
    };
  }

  /**
   * Looks up a code and validates it.
   */
  private async lookupValidCode(
    code: string,
    opts: { allowUsed: boolean },
  ): Promise<CodeRecord> {
    const { data, error } = await this.supabase
      .from('channel_link_codes')
      .select('*')
      .eq('code', code)
      .maybeSingle<CodeRecord>();

    if (error) {
      this.log.error(`[lookupValidCode] Failed lookup: ${error.message}`);
      throw new Error('No se pudo validar el código de vinculación.');
    }

    if (!data) {
      throw new Error('Código de vinculación no encontrado.');
    }

    if (!opts.allowUsed && data.used_at) {
      throw new Error('Este código de vinculación ya fue utilizado.');
    }

    const expiresAt = new Date(data.expires_at).getTime();
    if (Date.now() > expiresAt) {
      throw new Error('El código de vinculación ha expirado.');
    }

    return data;
  }

  /**
   * Generates a random 8-character hex code.
   */
  private generateCode(): string {
    const buf = randomBytes(4);
    return buf.toString('hex').toUpperCase();
  }

  /**
   * Marks a code as having a conflict.
   * Used when a channel is already linked to a different user.
   *
   * @param code - The code that had a conflict
   * @param reason - Human-readable conflict reason
   */
  markConflict(code: string, reason: string): void {
    this.cleanupExpiredConflicts();
    this.conflicts.set(code, {
      code,
      reason,
      conflictedAt: Date.now(),
    });
    this.log.debug(
      `[markConflict] Code ${code} marked as conflicted: ${reason}`,
    );
  }

  /**
   * Gets conflict info for a code if it exists.
   *
   * @param code - The code to check
   * @returns Conflict info or null if no conflict
   */
  getConflict(code: string): CodeConflict | null {
    this.cleanupExpiredConflicts();
    return this.conflicts.get(code) ?? null;
  }

  /**
   * Clears conflict for a code.
   */
  clearConflict(code: string): void {
    this.conflicts.delete(code);
  }

  /**
   * Removes expired conflicts from memory.
   */
  private cleanupExpiredConflicts(): void {
    const now = Date.now();
    for (const [code, conflict] of this.conflicts) {
      if (now - conflict.conflictedAt > this.conflictTtlMs) {
        this.conflicts.delete(code);
      }
    }
  }
}
