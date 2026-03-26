import { Injectable, Inject, Logger } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { RedisService } from '../../redis';

const CALLBACK_TTL = 60; // seconds before a callback expires

@Injectable()
export class CallbackHandlerService {
  private readonly log = new Logger(CallbackHandlerService.name);

  constructor(
    @Inject('SUPABASE') private readonly supabase: SupabaseClient,
    private readonly redis: RedisService,
  ) {}

  /**
   * Handle an inline button callback.
   * Returns the text to show the user, or null if invalid.
   */
  async handle(callbackData: string, userId: string): Promise<string | null> {
    this.log.debug(`[handle] callbackData="${callbackData}" userId="${userId}"`);

    const parts = callbackData.split(':');
    if (parts.length < 2) return null;

    const action = parts[0];

    if (action === 'undo') {
      return this.handleUndo(parts.slice(1), userId);
    }

    this.log.warn(`[handle] Unknown callback action: ${action}`);
    return null;
  }

  private async handleUndo(
    parts: string[],
    userId: string,
  ): Promise<string | null> {
    const type = parts[0];

    if (type === 'tx') {
      const txId = parts[1];
      if (!txId) return null;

      // Check expiration via Redis
      const expired = await this.isExpired(`undo:tx:${txId}`);
      if (expired) return '⏱️ Este botón ya expiró.';

      return this.undoTransaction(txId, userId);
    }

    if (type === 'group') {
      const ids = parts[1]?.split(',').filter(Boolean) ?? [];
      if (ids.length === 0) return null;

      const expired = await this.isExpired(`undo:group:${ids[0]}`);
      if (expired) return '⏱️ Este botón ya expiró.';

      const results = await Promise.all(
        ids.map((id) => this.undoTransaction(id, userId)),
      );
      const succeeded = results.filter((r) => r && !r.startsWith('❌')).length;
      return `↩️ Deshice ${succeeded} de ${ids.length} gastos.`;
    }

    if (type === 'cat') {
      const catName = decodeURIComponent(parts[1] ?? '');
      if (!catName) return null;
      return this.undoCategory(catName, userId);
    }

    if (type === 'cat_rename') {
      const fromName = decodeURIComponent(parts[1] ?? '');
      const toName = decodeURIComponent(parts[2] ?? '');
      if (!fromName || !toName) return null;
      return this.undoCategoryRename(fromName, toName, userId);
    }

    this.log.warn(`[handleUndo] Unknown undo type: ${type}`);
    return null;
  }

  private async isExpired(key: string): Promise<boolean> {
    // We store expiry in Redis when button is created (optional check)
    // For simplicity, we rely on the button's expiresIn for display only.
    // Backend uses the key TTL to invalidate.
    const existing = await this.redis.get(`callback_exp:${key}`);
    if (!existing) return false;
    return Date.now() > parseInt(existing, 10);
  }

  /** Mark a callback key as expired in Redis */
  async markExpired(key: string): Promise<void> {
    await this.redis.set(
      `callback_exp:${key}`,
      String(Date.now() + CALLBACK_TTL * 1000),
      CALLBACK_TTL + 5,
    );
  }

  private async undoTransaction(
    txId: string,
    userId: string,
  ): Promise<string | null> {
    try {
      // Verify ownership
      const { data: tx, error: fetchErr } = await this.supabase
        .from('transactions')
        .select('id, amount, description, category_id, categories(name)')
        .eq('id', txId)
        .eq('user_id', userId)
        .single();

      if (fetchErr || !tx) {
        this.log.warn(`[undoTransaction] tx ${txId} not found for user ${userId}`);
        return '❌ No encontré esa transacción.';
      }

      const { error: deleteErr } = await this.supabase
        .from('transactions')
        .delete()
        .eq('id', txId)
        .eq('user_id', userId);

      if (deleteErr) {
        this.log.error(`[undoTransaction] Delete failed: ${deleteErr.message}`);
        return '❌ No pude deshacer esa transacción.';
      }

      const catName = (tx as any).categories?.name ?? 'gasto';
      const amount = (tx as any).amount ?? 0;
      return `↩️ ~<b>$${Number(amount).toLocaleString('es-CL')}</b> en ${catName}~ — Deshecho`;
    } catch (err) {
      this.log.error(`[undoTransaction] Exception: ${String(err)}`);
      return '❌ Error al deshacer la transacción.';
    }
  }

  private async undoCategory(
    catName: string,
    userId: string,
  ): Promise<string | null> {
    try {
      const { error } = await this.supabase
        .from('categories')
        .delete()
        .eq('name', catName)
        .eq('user_id', userId);

      if (error) {
        this.log.error(`[undoCategory] Delete failed: ${error.message}`);
        return '❌ No pude eliminar la categoría.';
      }

      return `↩️ Categoría <b>${catName}</b> eliminada.`;
    } catch (err) {
      this.log.error(`[undoCategory] Exception: ${String(err)}`);
      return '❌ Error al deshacer.';
    }
  }

  private async undoCategoryRename(
    fromName: string,
    toName: string,
    userId: string,
  ): Promise<string | null> {
    try {
      const { error } = await this.supabase
        .from('categories')
        .update({ name: toName })
        .eq('name', fromName)
        .eq('user_id', userId);

      if (error) {
        this.log.error(`[undoCategoryRename] Update failed: ${error.message}`);
        return '❌ No pude revertir el nombre.';
      }

      return `↩️ <b>${fromName}</b> → <b>${toName}</b> revertido.`;
    } catch (err) {
      this.log.error(`[undoCategoryRename] Exception: ${String(err)}`);
      return '❌ Error al revertir.';
    }
  }
}
