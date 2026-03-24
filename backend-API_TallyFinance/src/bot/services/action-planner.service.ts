import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import {
  ActionBlock,
  ActionItem,
  ActionStatus,
  BotReply,
  ItemType,
} from '../actions/action-block';
import { GuardrailsService } from './guardrails.service';
import { ResponseBuilderService } from './response-builder.service';
import { ToolRegistry } from '../tools/tool-registry';
import { DomainMessage } from '../contracts';
import { debugLog } from '../../common/utils/debug-logger';

export interface PlannerResult {
  replies: BotReply[];
  updatedBlock: ActionBlock;
  executedCount: number;
  pendingCount: number;
  blockClosed: boolean;
  summaryForPhaseB: string;
}

const ACTION_TOOLS = new Set([
  'register_transaction',
  'manage_transactions',
  'manage_categories',
]);

const QUERY_TOOLS = new Set([
  'ask_balance',
  'ask_budget_status',
  'ask_goal_status',
]);

const QUICK_TOOLS = new Set(['greeting', 'ask_app_info']);

export function getItemType(tool: string): ItemType {
  if (ACTION_TOOLS.has(tool)) return 'action';
  if (QUERY_TOOLS.has(tool)) return 'query';
  if (QUICK_TOOLS.has(tool)) return 'quick';
  return 'direct';
}

@Injectable()
export class ActionPlannerService {
  private readonly log = debugLog.bot;

  constructor(
    private readonly toolRegistry: ToolRegistry,
    private readonly guardrails: GuardrailsService,
    private readonly responseBuilder: ResponseBuilderService,
  ) {}

  static createBlock(
    items: Omit<ActionItem, 'attempts'>[],
    existingId?: string,
  ): ActionBlock {
    return {
      id: existingId ?? randomUUID().substring(0, 8),
      items: items.map((i) => ({ ...i, attempts: 0 })),
      createdAt: new Date().toISOString(),
      maxAttempts: 2,
      maxItems: 3,
    };
  }

  async processBlock(
    userId: string,
    block: ActionBlock,
    context: any,
    msg: DomainMessage,
    cid: string,
  ): Promise<PlannerResult> {
    const replies: BotReply[] = [];
    let executedCount = 0;
    const executedItems: ActionItem[] = [];

    this.log.state(
      `[block:open] id=${block.id} items=${block.items.length}`,
      undefined,
      cid,
    );

    // 1. Auto-abandon items that exceeded maxAttempts
    for (const item of block.items) {
      if (item.status === 'needs_info' && item.attempts >= block.maxAttempts) {
        item.status = 'abandoned';
        const note = this.responseBuilder.buildAbandonNote(item);
        if (note.text) replies.push(note);
        this.log.warn(
          `[item:${item.id}] Abandoned after ${item.attempts} attempts`,
          undefined,
          cid,
        );
      }
    }

    // 2. Resolve dependencies
    for (const item of block.items) {
      if (item.status === 'depends_on' && item.dependsOn != null) {
        const dep = block.items.find((i) => i.id === item.dependsOn);
        if (dep?.status === 'executed') {
          item.status = 'ready';
          this.log.state(
            `[item:${item.id}] Dependency on item:${item.dependsOn} resolved`,
            undefined,
            cid,
          );
        } else if (dep?.status === 'failed' || dep?.status === 'abandoned') {
          item.status = 'abandoned';
          this.log.warn(
            `[item:${item.id}] Dependency failed/abandoned — auto-abandoning`,
            undefined,
            cid,
          );
        }
      }
    }

    // 3. Execute ready items in topological order.
    // Use a while loop so that when an item unlocks a dependency, the newly
    // unblocked item is also executed in the same pass (not deferred to next turn).
    const processedIds = new Set<number>();
    let madeProgress = true;

    while (madeProgress) {
      madeProgress = false;

      const readyNow = block.items
        .filter((i) => i.status === 'ready' && !processedIds.has(i.id))
        .sort((a, b) => a.id - b.id);

      for (const item of readyNow) {
        processedIds.add(item.id);
        this.log.tool(`[item:${item.id}] Executing ${item.tool}`, { args: item.args }, cid);

        // Amount hallucination guard for register_transaction
        if (
          item.tool === 'register_transaction' &&
          item.args.amount &&
          item.args.type !== 'balance_set'
        ) {
          const amount = Number(item.args.amount);
          const text = msg.text || '';
          const numbers = (text.match(/\d[\d.,]*/g) || []).map((n) =>
            Number(n.replace(/\./g, '').replace(',', '.')),
          );
          const lucasMatch = text.match(/(\d[\d.]*)\s*lucas?/i);
          if (lucasMatch) numbers.push(Number(lucasMatch[1].replace(/\./g, '')) * 1000);
          const milMatch = text.match(/(\d[\d.]*)\s*mil\b/i);
          if (milMatch) numbers.push(Number(milMatch[1].replace(/\./g, '')) * 1000);
          const millonMatch = text.match(/(\d[\d.,]*)\s*mill[oó]n(?:es)?/i);
          if (millonMatch) numbers.push(Number(millonMatch[1].replace(/\./g, '').replace(',', '.')) * 1000000);
          if (!numbers.some((n) => n === amount || Math.abs(n - amount) < 1)) {
            item.status = 'needs_info';
            item.question = '¿Cuánto fue exactamente?';
            item.attempts++;
            this.log.warn(
              `[item:${item.id}] Amount hallucination: ${amount} not in "${text}"`,
              undefined,
              cid,
            );
            continue;
          }
        }

        // Validate with guardrails
        const toolCall = { name: item.tool, args: { ...item.args } };
        const validation = this.guardrails.validate(toolCall);

        if (!validation.valid) {
          item.status = 'failed';
          this.log.warn(
            `[item:${item.id}] Guardrails rejected: ${validation.error}`,
            undefined,
            cid,
          );
          continue;
        }

        const sanitizedArgs = validation.sanitized?.args ?? item.args;

        // Inject categories for tools that need them
        if (
          (item.tool === 'register_transaction' || item.tool === 'manage_transactions') &&
          context.categories?.length
        ) {
          sanitizedArgs._categories = context.categories;
        }

        try {
          const handler = this.toolRegistry.getHandler(item.tool);
          const result = await handler.execute(userId, msg, sanitizedArgs);
          item.result = result;

          // CATEGORY_NOT_FOUND: forward to Phase B for natural question
          if (!result.ok && result.errorCode === 'CATEGORY_NOT_FOUND') {
            item.status = 'executed';
            executedCount++;
            executedItems.push(item);
            madeProgress = true;
            this.log.state(
              `[item:${item.id}] CATEGORY_NOT_FOUND — forwarding to Phase B`,
              { attemptedCategory: result.data?.attemptedCategory },
              cid,
            );
            continue;
          }

          if (result.ok && !result.userMessage) {
            item.status = 'executed';
            executedCount++;
            executedItems.push(item);
            madeProgress = true;

            const txId = result.data?.id ?? result.data?.transaction?.id;
            const confirmation = this.responseBuilder.buildConfirmation(
              item.tool,
              result.data ?? {},
              txId,
            );
            if (confirmation.text) replies.push(confirmation);

            this.log.ok(
              `[item:${item.id}] ${item.tool} OK`,
              { ms: 0 },
              cid,
            );

            // Unlock downstream dependencies — they'll be picked up next iteration
            for (const dep of block.items) {
              if (dep.status === 'depends_on' && dep.dependsOn === item.id) {
                dep.status = 'ready';
                this.log.state(
                  `[item:${dep.id}] Unlocked by item:${item.id}`,
                  undefined,
                  cid,
                );
              }
            }
          } else if (result.userMessage) {
            // Handler needs more info (slot-fill)
            item.status = 'needs_info';
            item.question = result.userMessage;
            item.attempts++;
            if (result.pending) {
              item.args = { ...item.args, ...result.pending.collectedArgs };
            }
            this.log.slot(
              `[item:${item.id}] Needs slot-fill`,
              { question: result.userMessage.substring(0, 50) },
              cid,
            );
          } else {
            item.status = 'failed';
            this.log.err(
              `[item:${item.id}] Handler failed: ${result.errorCode}`,
              undefined,
              cid,
            );
          }
        } catch (err) {
          item.status = 'failed';
          this.log.err(
            `[item:${item.id}] Exception in ${item.tool}: ${String(err)}`,
            undefined,
            cid,
          );
        }
      }
    }

    // 4. Ask for needs_info items
    // Items that transitioned to needs_info during execution already had attempts++
    // inside the loop. Items that were ALREADY needs_info before this pass get
    // incremented here (they are NOT in processedIds).
    const needsInfoItems = block.items.filter((i) => i.status === 'needs_info');
    if (needsInfoItems.length > 0) {
      for (const item of needsInfoItems) {
        if (!processedIds.has(item.id)) {
          item.attempts++;
        }
      }
      const questionReply = this.responseBuilder.buildQuestion(needsInfoItems);
      if (questionReply.text) replies.push(questionReply);
    }

    // 5. Determine block state
    const pendingCount = block.items.filter((i) =>
      ['needs_info', 'ready', 'depends_on'].includes(i.status),
    ).length;
    const blockClosed = pendingCount === 0;

    const summaryForPhaseB = this.buildSummary(executedItems);

    this.log.state(
      `[block:${blockClosed ? 'closed' : 'open'}] id=${block.id} executed=${executedCount} pending=${pendingCount}`,
      undefined,
      cid,
    );

    return {
      replies,
      updatedBlock: block,
      executedCount,
      pendingCount,
      blockClosed,
      summaryForPhaseB,
    };
  }

  // =========================================================================
  // Summary for Phase B closing message
  // =========================================================================

  buildSummary(executedItems: ActionItem[]): string {
    if (executedItems.length === 0) return '';
    return executedItems
      .map((item) => {
        const data = item.result?.data ?? {};
        switch (item.tool) {
          case 'register_transaction': {
            const amount = data.amount ?? item.args.amount ?? 0;
            const cat = data.category ?? item.args.category ?? '';
            const type = data.type ?? item.args.type ?? 'expense';
            return type === 'income'
              ? `Ingreso de $${amount}`
              : `$${amount} en ${cat}`;
          }
          case 'ask_balance':
            return 'Consultó balance';
          case 'ask_budget_status':
            return 'Consultó presupuesto';
          case 'ask_goal_status':
            return 'Consultó metas';
          case 'manage_categories':
            return `Categoría: ${data.operation ?? 'gestión'}`;
          case 'manage_transactions':
            return `Transacciones: ${data.operation ?? 'gestión'}`;
          default:
            return item.tool;
        }
      })
      .join(', ');
  }

  // =========================================================================
  // Detect primary tool for Phase B
  // =========================================================================

  getPrimaryTool(executedItems: ActionItem[]): string {
    if (executedItems.length === 0) return 'greeting';
    const priority = [
      'register_transaction',
      'manage_transactions',
      'manage_categories',
      'ask_balance',
      'ask_budget_status',
      'ask_goal_status',
    ];
    for (const p of priority) {
      if (executedItems.some((i) => i.tool === p)) return p;
    }
    return executedItems[0].tool;
  }
}
