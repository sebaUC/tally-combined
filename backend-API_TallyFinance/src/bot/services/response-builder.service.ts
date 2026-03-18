import { Injectable } from '@nestjs/common';
import { ActionItem, BotButton, BotReply } from '../actions/action-block';

@Injectable()
export class ResponseBuilderService {
  // =========================================================================
  // Formatters
  // =========================================================================

  formatCLP(amount: number): string {
    return Math.round(amount).toLocaleString('es-CL');
  }

  formatDate(dateStr?: string): string {
    const d = dateStr ? new Date(dateStr) : new Date();
    return d.toLocaleDateString('es-CL', {
      day: '2-digit',
      month: '2-digit',
      timeZone: 'America/Santiago',
    });
  }

  escapeHtml(text: string): string {
    return String(text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  stripHtml(text: string): string {
    return text.replace(/<[^>]*>/g, '');
  }

  // =========================================================================
  // Confirmation templates (deterministic, no AI)
  // =========================================================================

  buildConfirmation(
    tool: string,
    data: Record<string, any>,
    txId?: string,
  ): BotReply {
    const text = this.buildConfirmationText(tool, data);
    const button = this.buildUndoButton(tool, data, txId);
    return {
      text,
      parseMode: 'HTML',
      ...(button ? { buttons: [button] } : {}),
    };
  }

  private buildConfirmationText(
    tool: string,
    data: Record<string, any>,
  ): string {
    const op = data?.operation;

    switch (tool) {
      case 'register_transaction': {
        const amount = data?.amount ?? data?.transaction?.amount ?? 0;
        const name =
          data?.name ??
          data?.transaction?.name ??
          (data?.type === 'income' ? 'Ingreso' : 'Gasto');
        const category = data?.category ?? data?.transaction?.category;
        const icon = this.getCategoryIcon(category);
        const date = this.formatDate(
          data?.posted_at ?? data?.transaction?.posted_at,
        );
        if (data?.type === 'income' || data?.transaction?.type === 'income') {
          return (
            `✅ <b>$${this.formatCLP(amount)}</b> — ${this.escapeHtml(name)}\n` +
            `💰 Ingreso · ${date}`
          );
        }
        return (
          `✅ <b>$${this.formatCLP(amount)}</b> — ${this.escapeHtml(name)}\n` +
          `${icon} ${this.escapeHtml(category ?? 'Sin categoría')} · ${date}`
        );
      }

      case 'manage_categories': {
        if (op === 'create' || op === 'create_and_register') {
          const catName = data?.category?.name ?? data?.name ?? '';
          let text = `✅ Categoría <b>${this.escapeHtml(catName)}</b> creada`;
          if (op === 'create_and_register' && data?.transaction) {
            const txAmount = data.transaction.amount ?? 0;
            text += `\n✅ <b>$${this.formatCLP(txAmount)}</b> registrado en <b>${this.escapeHtml(catName)}</b>`;
          }
          return text;
        }
        if (op === 'rename') {
          return `✅ <b>${this.escapeHtml(data?.old_name ?? '')}</b> → <b>${this.escapeHtml(data?.new_name ?? '')}</b>`;
        }
        if (op === 'delete') {
          const affected = data?.transactionsAffected ?? 0;
          return (
            `🗑️ Categoría <b>${this.escapeHtml(data?.name ?? '')}</b> eliminada` +
            (affected > 0 ? ` (${affected} transacciones desvinculadas)` : '')
          );
        }
        if (op === 'list') {
          const categories: any[] = data?.categories ?? [];
          if (categories.length === 0) return 'No tienes categorías aún.';
          return (
            `📂 <b>Tus categorías:</b>\n` +
            categories.map((c) => `• ${this.escapeHtml(c.name)}`).join('\n')
          );
        }
        return `✅ Categoría actualizada`;
      }

      case 'ask_balance': {
        const balance = data?.totalBalance ?? data?.unifiedBalance ?? 0;
        const spent = data?.totalSpent ?? 0;
        const income = data?.totalIncome ?? 0;
        let text =
          `💰 Balance: <b>$${this.formatCLP(balance)}</b>\n` +
          `Gastos del mes: $${this.formatCLP(spent)}`;
        if (income > 0) text += ` · Ingresos: $${this.formatCLP(income)}`;
        if (data?.activeBudget?.amount) {
          const remaining =
            data.activeBudget.remaining ??
            data.activeBudget.amount - spent;
          text += `\nPresupuesto: $${this.formatCLP(data.activeBudget.amount)} · Restante: $${this.formatCLP(remaining)}`;
        }
        return text;
      }

      case 'ask_budget_status': {
        const period = data?.period ?? '';
        const amount = data?.amount ?? 0;
        const remaining = data?.remaining ?? 0;
        return `📊 Presupuesto ${period}: <b>$${this.formatCLP(amount)}</b>\nRestante: $${this.formatCLP(remaining)}`;
      }

      case 'ask_goal_status': {
        const goals: any[] = data?.goals ?? [];
        if (goals.length === 0) return 'No tienes metas activas.';
        return goals
          .map(
            (g) =>
              `🎯 <b>${this.escapeHtml(g.name)}</b>: ${g.percentage ?? 0}%` +
              ` ($${this.formatCLP(g.progress_amount ?? 0)} de $${this.formatCLP(g.target_amount ?? 0)})`,
          )
          .join('\n');
      }

      case 'manage_transactions': {
        if (op === 'list') {
          const txs: any[] = data?.transactions ?? [];
          if (txs.length === 0) return 'No hay transacciones recientes.';
          return txs
            .map(
              (tx, i) =>
                `${i + 1}. <b>$${this.formatCLP(tx.amount)}</b> — ${this.escapeHtml(tx.name ?? tx.category ?? '')} · ${this.formatDate(tx.posted_at)}`,
            )
            .join('\n');
        }
        if (op === 'edit') {
          const changes: string[] = data?.changes ?? [];
          return `✏️ Editado: ${changes.map((c) => this.escapeHtml(c)).join(', ')}`;
        }
        if (op === 'delete') {
          const deleted = data?.deleted;
          return `🗑️ Eliminé <b>$${this.formatCLP(deleted?.amount ?? 0)}</b> en ${this.escapeHtml(deleted?.category ?? '')}`;
        }
        return `✅ Transacciones actualizadas`;
      }

      default:
        return `✅ Listo`;
    }
  }

  private buildUndoButton(
    tool: string,
    data: Record<string, any>,
    txId?: string,
  ): BotButton | null {
    const id = txId ?? data?.id ?? data?.transaction?.id;

    switch (tool) {
      case 'register_transaction':
        if (id)
          return {
            text: '↩️ Deshacer',
            callbackData: `undo:tx:${id}`,
            expiresIn: 60,
          };
        return null;

      case 'manage_categories': {
        if (data?.operation === 'create' || data?.operation === 'create_and_register') {
          const catName = data?.category?.name ?? data?.name;
          if (catName) {
            // If create_and_register, undo only the transaction
            const txIdForUndo = data?.transaction?.id;
            if (txIdForUndo) {
              return {
                text: '↩️ Deshacer',
                callbackData: `undo:tx:${txIdForUndo}`,
                expiresIn: 60,
              };
            }
            return {
              text: '↩️ Eliminar',
              callbackData: `undo:cat:${encodeURIComponent(catName)}`,
              expiresIn: 60,
            };
          }
        }
        if (data?.operation === 'rename') {
          const oldName = data?.old_name;
          const newName = data?.new_name;
          if (oldName && newName)
            return {
              text: '↩️ Revertir',
              callbackData: `undo:cat_rename:${encodeURIComponent(newName)}:${encodeURIComponent(oldName)}`,
              expiresIn: 60,
            };
        }
        return null;
      }

      case 'manage_transactions':
        if (data?.operation === 'edit' && id)
          return {
            text: '↩️ Revertir',
            callbackData: `undo:tx_edit:${id}`,
            expiresIn: 60,
          };
        if (data?.operation === 'delete' && id)
          return {
            text: '↩️ Restaurar',
            callbackData: `undo:tx_restore:${id}`,
            expiresIn: 60,
          };
        return null;

      default:
        return null;
    }
  }

  // =========================================================================
  // Question / abandon / group templates
  // =========================================================================

  buildQuestion(items: ActionItem[]): BotReply {
    const needsInfo = items.filter((i) => i.status === 'needs_info');
    if (needsInfo.length === 0) return { text: '' };

    if (needsInfo.length === 1) {
      return {
        text:
          needsInfo[0].question ??
          `¿Falta información para completar la acción?`,
        parseMode: 'HTML',
      };
    }

    const lines = needsInfo.map(
      (item) =>
        `• ${item.question ?? `¿Información para ${item.tool}?`}`,
    );
    return {
      text: `Tengo algunos pendientes:\n${lines.join('\n')}`,
      parseMode: 'HTML',
    };
  }

  buildAbandonNote(item: ActionItem): BotReply {
    const amount = item.args?.amount;
    const name =
      item.args?.name ?? item.args?.category ?? item.tool;
    const amountStr = amount ? `$${this.formatCLP(amount)}` : '';
    const label = [amountStr, name].filter(Boolean).join(' en ');
    return {
      text: `Dejé ${label || 'esa acción'} sin procesar.`,
      parseMode: 'HTML',
    };
  }

  buildGroupedConfirmation(items: ActionItem[]): BotReply {
    const executed = items.filter((i) => i.status === 'executed' && i.result?.ok);
    if (executed.length === 0) return { text: '' };

    const total = executed.reduce(
      (sum, i) => sum + (i.result?.data?.amount ?? i.args?.amount ?? 0),
      0,
    );
    const lines = executed
      .map((i) => {
        const amount = i.result?.data?.amount ?? i.args?.amount ?? 0;
        const name =
          i.result?.data?.name ?? i.args?.name ?? i.args?.category ?? 'Gasto';
        const category = i.result?.data?.category ?? i.args?.category ?? '';
        const icon = this.getCategoryIcon(category);
        return `  • $${this.formatCLP(amount)} — ${this.escapeHtml(name)} ${icon}`.trim();
      })
      .join('\n');

    const ids = executed
      .map((i) => i.result?.data?.id ?? i.result?.data?.transaction?.id ?? '')
      .filter(Boolean)
      .join(',');

    return {
      text:
        `✅ Registré ${executed.length} gastos:\n${lines}\n` +
        `Total: <b>$${this.formatCLP(total)}</b>`,
      parseMode: 'HTML',
      ...(ids ? { buttons: [{ text: '↩️ Deshacer todo', callbackData: `undo:group:${ids}`, expiresIn: 60 }] } : {}),
    };
  }

  buildLimitMessage(remaining: ActionItem[]): BotReply {
    if (remaining.length === 0) return { text: '' };
    const first = remaining[0];
    const amount = first.args?.amount;
    const name = first.args?.name ?? first.args?.category ?? '';
    const amountStr = amount ? ` $${this.formatCLP(amount)}` : '';
    const label = amountStr + (name ? ` en ${this.escapeHtml(name)}` : '');
    return {
      text: `Solo proceso 3 acciones a la vez.${label ? ` ¿Registro también${label}?` : ''}`,
      parseMode: 'HTML',
    };
  }

  // =========================================================================
  // Nudge templates
  // =========================================================================

  buildBudgetNudge(percent: number): BotReply {
    const pct = Math.round(percent * 100);
    return { text: `⚠️ Llevas el ${pct}% del presupuesto mensual`, parseMode: 'HTML' };
  }

  buildStreakNudge(days: number): BotReply {
    return {
      text: `🔥 ${days} días seguidos registrando. ¡Sigue así!`,
      parseMode: 'HTML',
    };
  }

  // =========================================================================
  // Helpers
  // =========================================================================

  private getCategoryIcon(category?: string): string {
    if (!category) return '💳';
    const lower = category.toLowerCase();
    if (lower.includes('aliment') || lower.includes('comida') || lower.includes('restaur')) return '🍽️';
    if (lower.includes('transport') || lower.includes('uber') || lower.includes('metro') || lower.includes('taxi')) return '🚗';
    if (lower.includes('salud') || lower.includes('médic') || lower.includes('farmac') || lower.includes('doctor')) return '💊';
    if (lower.includes('educac') || lower.includes('libro') || lower.includes('curso')) return '📚';
    if (lower.includes('entret') || lower.includes('cine') || lower.includes('ocio')) return '🎬';
    if (lower.includes('hogar') || lower.includes('arriendo') || lower.includes('casa')) return '🏠';
    if (lower.includes('personal') || lower.includes('ropa') || lower.includes('pelu')) return '👕';
    if (lower.includes('suscripc') || lower.includes('netflix') || lower.includes('spotify')) return '📱';
    if (lower.includes('trabajo') || lower.includes('oficin')) return '💼';
    return '💳';
  }
}
