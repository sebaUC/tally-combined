import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { MinimalUserContext } from './user-context.service';
import { ToolSchema } from '../tools/tool-schemas';
import { ActionResult } from '../actions/action-result';
import {
  ConversationMessage,
  PhaseARequest,
  PhaseAResponse,
  PhaseBRequest,
  PhaseBResponse,
  RuntimeContext,
  OrchestratorError,
  PendingSlotContext,
} from './orchestrator.contracts';
import {
  CircuitBreaker,
  CircuitOpenError,
} from '../../common/utils/resilience';
import { AiWarmupService } from '../../common/services/ai-warmup.service';

@Injectable()
export class OrchestratorClient {
  private readonly log = new Logger(OrchestratorClient.name);
  private readonly shortTimeout = 8_000; // 8s for quick check
  private readonly longTimeout = 55_000; // 55s for cold start retry
  private readonly wakeUpTimeout = 60_000; // 60s to wait for service wake-up
  private readonly circuitBreaker: CircuitBreaker;

  constructor(
    private readonly cfg: ConfigService,
    private readonly warmup: AiWarmupService,
  ) {
    // Circuit breaker: 5 failures -> open for 30s
    this.circuitBreaker = new CircuitBreaker('ai-service', {
      failureThreshold: 5,
      resetTimeoutMs: 30_000,
      halfOpenMaxAttempts: 2,
    });
  }

  /**
   * Wake up the AI service by calling /health endpoint.
   * Render free tier returns 502 on POST when sleeping, but GET wakes it up.
   */
  private async wakeUpService(): Promise<boolean> {
    const baseUrl = this.cfg.get<string>('AI_SERVICE_URL');
    if (!baseUrl) return false;

    this.log.log('😴 AI service sleeping, attempting to wake up...');
    this.warmup.startWarming();

    try {
      const response = await axios.get(`${baseUrl}/health`, {
        timeout: this.wakeUpTimeout,
      });

      if (response.status === 200) {
        this.log.log('☀️ AI service is now awake!');
        this.warmup.finishWarming();
        return true;
      }
    } catch (err) {
      this.log.warn(
        `😴 Wake-up failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    return false;
  }

  /**
   * Check if AI service is likely experiencing a cold start.
   */
  isLikelyColdStart(): boolean {
    return this.warmup.isLikelyCold();
  }

  /**
   * Get the wake-up message to show users during cold start.
   */
  getWakeUpMessage(): string {
    return this.warmup.getWakeUpMessage();
  }

  async phaseA(
    userText: string,
    context: MinimalUserContext,
    tools: ToolSchema[],
    pending?: PendingSlotContext | null,
    availableCategories?: string[],
    conversationHistory?: ConversationMessage[],
  ): Promise<PhaseAResponse> {
    const baseUrl = this.cfg.get<string>('AI_SERVICE_URL');

    if (!baseUrl) {
      this.log.warn('[phaseA] AI_SERVICE_URL not configured, using stub');
      return this.stubPhaseA(userText, pending, availableCategories);
    }

    const request: PhaseARequest = {
      phase: 'A',
      user_id: context.userId,
      user_text: userText,
      user_context: this.buildAiUserContext(context),
      tools,
      pending: pending ?? null,
      available_categories: availableCategories ?? [],
      conversation_history: conversationHistory ?? [],
    };

    // Determine timeout based on cold start likelihood
    const isLikelyCold = this.warmup.isLikelyCold();
    const timeout = isLikelyCold ? this.longTimeout : this.shortTimeout;

    this.log.debug(
      `[phaseA] Calling AI service (cold=${isLikelyCold}, timeout=${timeout}ms): "${userText.substring(0, 50)}..."`,
    );

    try {
      // Use circuit breaker to protect against cascading failures
      const data = await this.circuitBreaker.execute(async () => {
        const { data } = await axios.post<PhaseAResponse>(
          `${baseUrl}/orchestrate`,
          request,
          { timeout },
        );
        return data;
      });

      // Mark service as warm on success
      this.warmup.finishWarming();

      this.log.debug(`[phaseA] Response type: ${data.response_type}`);

      if (!this.isValidPhaseAResponse(data)) {
        this.log.error('[phaseA] Invalid response structure from AI service');
        throw new OrchestratorError(
          'INVALID_RESPONSE',
          'Invalid Phase A response',
        );
      }

      // Post-process: intercept amount=0 hallucination from AI
      if (
        data.response_type === 'tool_call' &&
        data.tool_call?.name === 'register_transaction' &&
        (data.tool_call.args?.amount === 0 ||
          data.tool_call.args?.amount === null ||
          data.tool_call.args?.amount === undefined)
      ) {
        this.log.warn(
          `[phaseA] Intercepted amount=${data.tool_call.args?.amount} hallucination, converting to clarification`,
        );
        return {
          phase: 'A',
          response_type: 'clarification',
          clarification: '¿Cuánto fue el gasto exactamente?',
        } as PhaseAResponse;
      }

      return data;
    } catch (err) {
      if (err instanceof OrchestratorError) throw err;

      // Circuit is open - fall back to stub mode
      if (err instanceof CircuitOpenError) {
        this.log.warn(
          `[phaseA] Circuit breaker open, using stub. Retry in ${err.retryAfterMs}ms`,
        );
        return this.stubPhaseA(userText);
      }

      if (axios.isAxiosError(err)) {
        if (err.response?.status === 404) {
          this.log.warn('[phaseA] /orchestrate endpoint not found, using stub');
          return this.stubPhaseA(userText);
        }

        // Handle 502 - Render returns this when service is sleeping
        if (err.response?.status === 502) {
          this.log.warn(
            '[phaseA] 😴 Got 502 - AI service is sleeping, waking up...',
          );

          // Try to wake up the service
          const wokeUp = await this.wakeUpService();

          if (wokeUp) {
            // Retry the request after waking up
            this.log.log('[phaseA] Retrying request after wake-up...');
            try {
              const retryData = await this.circuitBreaker.execute(async () => {
                const { data } = await axios.post<PhaseAResponse>(
                  `${baseUrl}/orchestrate`,
                  request,
                  { timeout: this.shortTimeout },
                );
                return data;
              });

              this.warmup.finishWarming();

              if (this.isValidPhaseAResponse(retryData)) {
                this.log.debug(
                  `[phaseA] Retry successful: ${retryData.response_type}`,
                );
                return retryData;
              }
            } catch (retryErr) {
              this.log.error(`[phaseA] Retry failed: ${String(retryErr)}`);
            }
          }

          // Wake-up or retry failed
          throw new OrchestratorError(
            'COLD_START',
            this.warmup.getWakeUpMessage(),
          );
        }

        // Handle timeout - this is likely a cold start
        if (err.code === 'ECONNABORTED' || err.code === 'ECONNREFUSED') {
          this.log.warn(
            `[phaseA] 😴 AI service timeout/refused - likely cold start`,
          );
          // Mark that we're trying to wake it up
          this.warmup.startWarming();
          throw new OrchestratorError(
            'COLD_START',
            this.warmup.getWakeUpMessage(),
          );
        }
      }

      this.log.error(`[phaseA] Error: ${String(err)}`);
      throw new OrchestratorError(
        'LLM_ERROR',
        'Failed to communicate with AI service',
      );
    }
  }

  async phaseB(
    toolName: string,
    actionResult: ActionResult,
    context: MinimalUserContext,
    runtimeContext?: RuntimeContext,
    userText?: string,
    conversationHistory?: ConversationMessage[],
  ): Promise<PhaseBResponse> {
    const baseUrl = this.cfg.get<string>('AI_SERVICE_URL');

    if (!baseUrl) {
      this.log.warn('[phaseB] AI_SERVICE_URL not configured, using stub');
      return this.stubPhaseB(toolName, actionResult);
    }

    const request: PhaseBRequest = {
      phase: 'B',
      tool_name: toolName,
      action_result: actionResult,
      user_context: this.buildAiUserContext(context),
      runtime_context: runtimeContext ?? null,
      user_text: userText,
      conversation_history: conversationHistory ?? [],
    };

    // Determine timeout based on cold start likelihood
    const isLikelyCold = this.warmup.isLikelyCold();
    const timeout = isLikelyCold ? this.longTimeout : this.shortTimeout;

    this.log.debug(
      `[phaseB] Calling AI service (cold=${isLikelyCold}, timeout=${timeout}ms) for tool: ${toolName}`,
    );

    try {
      // Use circuit breaker to protect against cascading failures
      const data = await this.circuitBreaker.execute(async () => {
        const { data } = await axios.post<PhaseBResponse>(
          `${baseUrl}/orchestrate`,
          request,
          { timeout },
        );
        return data;
      });

      // Mark service as warm on success
      this.warmup.finishWarming();

      this.log.debug(
        `[phaseB] Generated message length: ${data.final_message?.length ?? 0}`,
      );

      if (!this.isValidPhaseBResponse(data)) {
        this.log.error('[phaseB] Invalid response structure from AI service');
        throw new OrchestratorError(
          'INVALID_RESPONSE',
          'Invalid Phase B response',
        );
      }

      return data;
    } catch (err) {
      if (err instanceof OrchestratorError) throw err;

      // Circuit is open - fall back to stub mode
      if (err instanceof CircuitOpenError) {
        this.log.warn(
          `[phaseB] Circuit breaker open, using stub. Retry in ${err.retryAfterMs}ms`,
        );
        return this.stubPhaseB(toolName, actionResult);
      }

      if (axios.isAxiosError(err)) {
        if (err.response?.status === 404) {
          this.log.warn('[phaseB] /orchestrate endpoint not found, using stub');
          return this.stubPhaseB(toolName, actionResult);
        }

        // Handle 502 - Render returns this when service is sleeping
        if (err.response?.status === 502) {
          this.log.warn(
            '[phaseB] 😴 Got 502 - AI service is sleeping, waking up...',
          );

          // Try to wake up the service
          const wokeUp = await this.wakeUpService();

          if (wokeUp) {
            // Retry the request after waking up
            this.log.log('[phaseB] Retrying request after wake-up...');
            try {
              const retryData = await this.circuitBreaker.execute(async () => {
                const { data } = await axios.post<PhaseBResponse>(
                  `${baseUrl}/orchestrate`,
                  request,
                  { timeout: this.shortTimeout },
                );
                return data;
              });

              this.warmup.finishWarming();

              if (this.isValidPhaseBResponse(retryData)) {
                this.log.debug(`[phaseB] Retry successful`);
                return retryData;
              }
            } catch (retryErr) {
              this.log.error(`[phaseB] Retry failed: ${String(retryErr)}`);
            }
          }

          // Wake-up or retry failed
          throw new OrchestratorError(
            'COLD_START',
            this.warmup.getWakeUpMessage(),
          );
        }

        // Handle timeout - this is likely a cold start
        if (err.code === 'ECONNABORTED' || err.code === 'ECONNREFUSED') {
          this.log.warn(
            `[phaseB] 😴 AI service timeout/refused - likely cold start`,
          );
          this.warmup.startWarming();
          throw new OrchestratorError(
            'COLD_START',
            this.warmup.getWakeUpMessage(),
          );
        }
      }

      this.log.error(`[phaseB] Error: ${String(err)}`);
      throw new OrchestratorError(
        'LLM_ERROR',
        'Failed to communicate with AI service',
      );
    }
  }

  private isValidPhaseAResponse(data: any): data is PhaseAResponse {
    if (!data || data.phase !== 'A') return false;
    if (
      !['tool_call', 'clarification', 'direct_reply'].includes(
        data.response_type,
      )
    )
      return false;

    if (data.response_type === 'tool_call' && !data.tool_call?.name)
      return false;
    if (data.response_type === 'clarification' && !data.clarification)
      return false;
    if (data.response_type === 'direct_reply' && !data.direct_reply)
      return false;

    return true;
  }

  private isValidPhaseBResponse(data: any): data is PhaseBResponse {
    return data && data.phase === 'B' && typeof data.final_message === 'string';
  }

  private buildAiUserContext(context: MinimalUserContext) {
    return {
      user_id: context.userId,
      personality: context.personality
        ? {
            tone: context.personality.tone ?? null,
            mood: context.personality.mood ?? null,
          }
        : null,
      prefs: {
        notification_level: context.prefs?.notificationLevel ?? null,
        unified_balance: context.prefs?.unifiedBalance ?? null,
      },
      active_budget: {
        period: context.activeBudget?.period ?? null,
        amount: context.activeBudget?.amount ?? null,
        spent: context.activeBudget?.spent ?? null,
      },
      goals_summary: context.goalsSummary ?? [],
    };
  }

  private stubPhaseA(
    userText: string,
    pending?: PendingSlotContext | null,
    availableCategories?: string[],
  ): PhaseAResponse {
    this.log.debug('[stubPhaseA] Generating stub response');

    const text = userText.toLowerCase().trim();

    // =================================================================
    // PRIORITY 1: If there's pending slot-fill state, try to complete it
    // =================================================================
    // ── manage_transactions pending (disambiguation) ──
    if (pending && pending.tool === 'manage_transactions') {
      const collectedArgs = { ...pending.collected_args };
      const numMatch = text.match(/^(\d+)$/);
      if (numMatch) {
        collectedArgs['choice'] = parseInt(numMatch[1], 10);
        return {
          phase: 'A',
          response_type: 'tool_call',
          tool_call: { name: 'manage_transactions', args: collectedArgs },
        };
      }
    }

    // ── register_transaction pending ──
    if (pending && pending.tool === 'register_transaction') {
      const collectedArgs = { ...pending.collected_args };
      const missingArgs = [...pending.missing_args];

      this.log.debug(
        `[stubPhaseA] Pending transaction: collected=${JSON.stringify(collectedArgs)}, missing=${missingArgs.join(',')}`,
      );

      // Try to extract what the user said and fill in missing slots
      // If missing category, user might have said a category name
      if (missingArgs.includes('category')) {
        // Try to match against available categories (case-insensitive)
        const matchedCategory = this.findBestCategoryMatch(
          text,
          availableCategories ?? [],
        );

        if (matchedCategory) {
          collectedArgs['category'] = matchedCategory;
          missingArgs.splice(missingArgs.indexOf('category'), 1);
          this.log.debug(
            `[stubPhaseA] Matched category: "${text}" → "${matchedCategory}"`,
          );
        }
      }

      // If missing amount, try to extract
      if (missingArgs.includes('amount')) {
        const amountMatch = text.match(/[\d.,]+/);
        if (amountMatch) {
          const numStr = amountMatch[0].replace(/\./g, '').replace(',', '.');
          const amount =
            parseFloat(numStr) * (text.includes('luca') ? 1000 : 1);
          if (!isNaN(amount) && amount > 0) {
            collectedArgs['amount'] = amount;
            missingArgs.splice(missingArgs.indexOf('amount'), 1);
          }
        }
      }

      // If all required fields collected, complete the tool call
      if (
        collectedArgs['amount'] !== undefined &&
        collectedArgs['category'] !== undefined
      ) {
        return {
          phase: 'A',
          response_type: 'tool_call',
          tool_call: {
            name: 'register_transaction',
            args: collectedArgs,
          },
        };
      }

      // Still missing something - ask for what's still needed
      if (missingArgs.includes('category')) {
        return {
          phase: 'A',
          response_type: 'clarification',
          clarification:
            '¿En qué categoría lo registro? (ej: comida, transporte, salud…)',
        };
      }
      if (missingArgs.includes('amount')) {
        return {
          phase: 'A',
          response_type: 'clarification',
          clarification: '¿Cuánto fue el gasto exactamente?',
        };
      }
    }

    // =================================================================
    // PRIORITY 2: Regular pattern matching for new intents
    // =================================================================

    // Simple pattern matching for stub mode
    if (/hola|buenos|buenas|hey|hi/.test(text)) {
      return {
        phase: 'A',
        response_type: 'direct_reply',
        direct_reply: '¡Hola! ¿En qué te puedo ayudar hoy?',
      };
    }

    // Income detection (before expense pattern)
    if (/me\s+pagar|recib[ií]\s+sueldo|me\s+deposit|cobr[eé]|me\s+abonar|lleg[oó]\s+(?:el\s+)?sueldo|vend[ií]/i.test(text)) {
      const amountMatch = text.match(
        /(\d+(?:[.,]\d+)?)\s*(?:lucas?|pesos?|clp)?/i,
      );
      let amount: number | null = null;
      if (amountMatch) {
        const numStr = amountMatch[1].replace(/\./g, '').replace(',', '.');
        amount = parseFloat(numStr) * (text.includes('luca') ? 1000 : 1);
      }

      if (!amount) {
        return {
          phase: 'A',
          response_type: 'clarification',
          clarification: '¿Cuánto fue exactamente?',
        };
      }

      return {
        phase: 'A',
        response_type: 'tool_call',
        tool_call: {
          name: 'register_transaction',
          args: { amount, category: '_no_match', type: 'income', name: 'Ingreso' },
        },
      };
    }

    if (/gast[éeo]|compr[éeo]|pagu[éeo]/.test(text)) {
      // Extract amount if present
      const amountMatch = text.match(
        /(\d+(?:[.,]\d+)?)\s*(?:lucas?|pesos?|clp)?/i,
      );
      let amount: number | null = null;
      if (amountMatch) {
        const numStr = amountMatch[1].replace(/\./g, '').replace(',', '.');
        amount = parseFloat(numStr) * (text.includes('luca') ? 1000 : 1);
      }

      // Try to match category against available categories
      let category: string | null = null;
      const categoryMatch = text.match(/en\s+(\w+)/i);
      if (categoryMatch) {
        const rawCategory = categoryMatch[1];
        // Try to match against actual categories
        category =
          this.findBestCategoryMatch(rawCategory, availableCategories ?? []) ??
          rawCategory;
      }

      if (!amount) {
        return {
          phase: 'A',
          response_type: 'clarification',
          clarification: '¿Cuánto fue el gasto exactamente?',
        };
      }

      if (!category) {
        return {
          phase: 'A',
          response_type: 'clarification',
          clarification:
            '¿En qué categoría lo registro? (ej: comida, transporte, salud…)',
        };
      }

      return {
        phase: 'A',
        response_type: 'tool_call',
        tool_call: {
          name: 'register_transaction',
          args: { amount, category },
        },
      };
    }

    if (/saldo|balance|cuánto tengo|dinero/.test(text)) {
      return {
        phase: 'A',
        response_type: 'tool_call',
        tool_call: { name: 'ask_balance', args: {} },
      };
    }

    if (/presupuesto|budget/.test(text)) {
      return {
        phase: 'A',
        response_type: 'tool_call',
        tool_call: { name: 'ask_budget_status', args: {} },
      };
    }

    if (/meta|goal|ahorro/.test(text)) {
      return {
        phase: 'A',
        response_type: 'tool_call',
        tool_call: { name: 'ask_goal_status', args: {} },
      };
    }

    // ── manage_categories pending (force delete confirmation / _create_category_offer) ──
    if (pending && pending.tool === 'manage_categories') {
      const collectedArgs = { ...pending.collected_args };

      // Force delete confirmation
      if (collectedArgs['_has_transactions']) {
        if (/s[ií]|dale|ok|bueno|hazlo|fuerza|forzar|elimina/i.test(text)) {
          return {
            phase: 'A',
            response_type: 'tool_call',
            tool_call: {
              name: 'manage_categories',
              args: {
                operation: 'delete',
                name: collectedArgs['name'] as string,
                force_delete: true,
              },
            },
          };
        }
        return {
          phase: 'A',
          response_type: 'direct_reply',
          direct_reply: 'Ok, no eliminé la categoría.',
        };
      }
    }

    // ── _create_category_offer pending (from register_transaction) ──
    if (
      pending &&
      pending.tool === 'register_transaction' &&
      pending.collected_args?.['_create_category_offer']
    ) {
      const collectedArgs = { ...pending.collected_args };
      const offerName = collectedArgs['_create_category_offer'] as string;

      if (/s[ií]|dale|ok|bueno|cr[ée]ala|ya/i.test(text)) {
        // User confirms creating the category
        const pendingTx: Record<string, unknown> = {};
        if (collectedArgs['amount']) pendingTx['amount'] = collectedArgs['amount'];
        if (collectedArgs['description']) pendingTx['description'] = collectedArgs['description'];
        if (collectedArgs['posted_at']) pendingTx['posted_at'] = collectedArgs['posted_at'];

        return {
          phase: 'A',
          response_type: 'tool_call',
          tool_call: {
            name: 'manage_categories',
            args: {
              operation: 'create',
              name: offerName,
              _pending_transaction: pendingTx,
            },
          },
        };
      }

      // User picks an existing category
      const matchedCategory = this.findBestCategoryMatch(
        text,
        availableCategories ?? [],
      );
      if (matchedCategory) {
        return {
          phase: 'A',
          response_type: 'tool_call',
          tool_call: {
            name: 'register_transaction',
            args: {
              amount: collectedArgs['amount'],
              category: matchedCategory,
              ...(collectedArgs['description'] ? { description: collectedArgs['description'] } : {}),
              ...(collectedArgs['posted_at'] ? { posted_at: collectedArgs['posted_at'] } : {}),
            },
          },
        };
      }

      // User rejects
      if (/no|cancel|mejor no|nah/i.test(text)) {
        return {
          phase: 'A',
          response_type: 'tool_call',
          tool_call: {
            name: 'register_transaction',
            args: {
              amount: collectedArgs['amount'],
              category: '_no_match',
              ...(collectedArgs['description'] ? { description: collectedArgs['description'] } : {}),
              ...(collectedArgs['posted_at'] ? { posted_at: collectedArgs['posted_at'] } : {}),
            },
          },
        };
      }
    }

    // ── manage_categories patterns ──
    if (
      /mis\s+categor[ií]as|ver\s+categor[ií]as|qu[ée]\s+categor[ií]as|mostrar\s*categor[ií]as|listar\s*categor[ií]as/.test(
        text,
      )
    ) {
      return {
        phase: 'A',
        response_type: 'tool_call',
        tool_call: {
          name: 'manage_categories',
          args: { operation: 'list' },
        },
      };
    }

    if (/crea(?:r)?\s+(?:la\s+)?categor[ií]a\s+(.+)/i.test(text)) {
      const match = text.match(/crea(?:r)?\s+(?:la\s+)?categor[ií]a\s+(.+)/i);
      return {
        phase: 'A',
        response_type: 'tool_call',
        tool_call: {
          name: 'manage_categories',
          args: { operation: 'create', name: match![1].trim() },
        },
      };
    }

    if (/elimina(?:r)?\s+(?:la\s+)?categor[ií]a\s+(.+)/i.test(text)) {
      const match = text.match(
        /elimina(?:r)?\s+(?:la\s+)?categor[ií]a\s+(.+)/i,
      );
      return {
        phase: 'A',
        response_type: 'tool_call',
        tool_call: {
          name: 'manage_categories',
          args: { operation: 'delete', name: match![1].trim() },
        },
      };
    }

    // ── manage_transactions patterns ──
    if (
      /mis\s*(últimos?\s+)?gastos|ver\s*(mis\s+)?transacciones|historial|qué he gastado|últimas transacciones|mostrar\s*gastos/.test(
        text,
      )
    ) {
      return {
        phase: 'A',
        response_type: 'tool_call',
        tool_call: {
          name: 'manage_transactions',
          args: { operation: 'list' },
        },
      };
    }

    if (/borr|elimin|quita.*gasto|bórralo|elimínalo/.test(text)) {
      const amountMatch = text.match(
        /(\d+(?:[.,]\d+)?)\s*(?:lucas?|pesos?|clp)?/i,
      );
      let hint_amount: number | undefined;
      if (amountMatch) {
        const numStr = amountMatch[1].replace(/\./g, '').replace(',', '.');
        hint_amount =
          parseFloat(numStr) * (text.includes('luca') ? 1000 : 1);
      }
      return {
        phase: 'A',
        response_type: 'tool_call',
        tool_call: {
          name: 'manage_transactions',
          args: {
            operation: 'delete',
            ...(hint_amount ? { hint_amount } : {}),
          },
        },
      };
    }

    if (
      /cambi|modific|correg|edit|actualiz.*(?:gasto|transacci)|no\s+eran|en\s+realidad\s+eran/.test(
        text,
      )
    ) {
      const amountMatch = text.match(
        /(\d+(?:[.,]\d+)?)\s*(?:lucas?|pesos?|clp)?/i,
      );
      let new_amount: number | undefined;
      if (amountMatch) {
        const numStr = amountMatch[1].replace(/\./g, '').replace(',', '.');
        new_amount =
          parseFloat(numStr) * (text.includes('luca') ? 1000 : 1);
      }
      return {
        phase: 'A',
        response_type: 'tool_call',
        tool_call: {
          name: 'manage_transactions',
          args: {
            operation: 'edit',
            ...(new_amount ? { new_amount } : {}),
          },
        },
      };
    }

    // App info questions - detect curiosity about the bot/app
    // Made very permissive to catch most questions about the app
    if (
      /qu[ée]\s+(puedes|sabes|haces)|puedes\s+hacer|sabes\s+hacer|c[oó]mo\s+(funciona|te\s+uso|empiezo)|para\s+qu[ée]\s+(sirves|eres)|ayuda|help|funciones|funcionalidades|qu[ée]\s+es\s+tally|no\s+puedes|limitaci|segur|privacidad|gratis|precio|c[oó]mo\s+empez|quiero\s+saber|qu[ée]\s+haces|qui[ée]n\s+eres|eres\s+un\s+(bot|robot)|capacidades/i.test(
        text,
      )
    ) {
      // Detect suggested topic (just a hint for the AI)
      let suggestedTopic = 'other';
      if (/puedes|haces|funciones|sirves|capacidad/i.test(text)) {
        suggestedTopic = 'capabilities';
      } else if (/c[oó]mo\s+(registro|anoto|uso|hago)/i.test(text)) {
        suggestedTopic = 'how_to';
      } else if (/no\s+puedes|limitaci|por\s+qu[ée]\s+no/i.test(text)) {
        suggestedTopic = 'limitations';
      } else if (/telegram|whatsapp|vincul|conect|canal/i.test(text)) {
        suggestedTopic = 'channels';
      } else if (/empez|inici|start|comenzar|primer/i.test(text)) {
        suggestedTopic = 'getting_started';
      } else if (/qu[ée]\s+es|qui[ée]n\s+eres|about/i.test(text)) {
        suggestedTopic = 'about';
      } else if (/segur|privacidad|datos|encrypt/i.test(text)) {
        suggestedTopic = 'security';
      } else if (/gratis|precio|costo|plan|premium/i.test(text)) {
        suggestedTopic = 'pricing';
      }

      return {
        phase: 'A',
        response_type: 'tool_call',
        tool_call: {
          name: 'ask_app_info',
          args: {
            userQuestion: userText, // Pass the ORIGINAL question
            suggestedTopic,
          },
        },
      };
    }

    // FALLBACK: For ANYTHING else, use ask_app_info with the original question
    // This ensures the AI always has a chance to respond intelligently
    // The AI can decide to answer about the app, redirect to a feature, or handle conversationally
    return {
      phase: 'A',
      response_type: 'tool_call',
      tool_call: {
        name: 'ask_app_info',
        args: {
          userQuestion: userText,
          suggestedTopic: 'conversation', // New topic for general conversation
        },
      },
    };
  }

  private stubPhaseB(toolName: string, result: ActionResult): PhaseBResponse {
    this.log.debug(`[stubPhaseB] Generating stub for tool: ${toolName}`);

    if (!result.ok) {
      return {
        phase: 'B',
        final_message:
          'Hubo un problema procesando tu solicitud. Por favor intenta de nuevo.',
      };
    }

    switch (toolName) {
      case 'register_transaction': {
        const amount = result.data?.amount;
        const category = result.data?.category;
        const txType = result.data?.type ?? 'expense';
        const txName = result.data?.name;
        if (amount) {
          const formatted = `$${Number(amount).toLocaleString('es-CL')}`;
          if (txType === 'income') {
            return {
              phase: 'B',
              final_message: `¡Anotado! Ingreso de ${formatted}${txName ? ` (${txName})` : ''}.`,
            };
          }
          if (category) {
            return {
              phase: 'B',
              final_message: `¡Listo! Registré ${formatted} en ${category}${txName ? ` (${txName})` : ''}.`,
            };
          }
        }
        return { phase: 'B', final_message: '¡Listo! Transacción registrada.' };
      }

      case 'ask_balance': {
        const data = result.data as {
          unifiedBalance: boolean;
          totalBalance: number;
          totalSpent: number;
          totalIncome: number;
          accounts: Array<{ name: string | null; currentBalance: number }>;
          activeBudget: {
            period: string;
            amount: number;
            remaining: number;
          } | null;
          periodLabel: string;
        };

        if (!data) {
          return {
            phase: 'B',
            final_message: 'No pude obtener información de tus gastos.',
          };
        }

        const formatCLP = (n: number) => `$${n.toLocaleString('es-CL')}`;
        let message = '';

        if (data.unifiedBalance) {
          message = `Tu balance actual es ${formatCLP(data.totalBalance)}.`;
          message += ` En ${data.periodLabel}: gastos ${formatCLP(data.totalSpent)}`;
          if (data.totalIncome > 0) {
            message += `, ingresos ${formatCLP(data.totalIncome)}`;
          }
          message += '.';
        } else {
          const accountLines = data.accounts
            .map((a) => `• ${a.name || 'Cuenta'}: ${formatCLP(a.currentBalance)}`)
            .join('\n');

          message = `Tus cuentas:\n${accountLines}\n\nBalance total: ${formatCLP(data.totalBalance)}`;
          message += `\nEn ${data.periodLabel}: gastos ${formatCLP(data.totalSpent)}`;
          if (data.totalIncome > 0) {
            message += `, ingresos ${formatCLP(data.totalIncome)}`;
          }
          message += '.';
        }

        if (data.activeBudget) {
          const { amount, remaining, period } = data.activeBudget;
          const periodNames: Record<string, string> = {
            daily: 'diario',
            weekly: 'semanal',
            monthly: 'mensual',
          };
          const periodName = periodNames[period] || period;

          if (remaining >= 0) {
            message += `\n\nDe tu presupuesto ${periodName} de ${formatCLP(amount)}, te quedan ${formatCLP(remaining)}.`;
          } else {
            message += `\n\n⚠️ Has superado tu presupuesto ${periodName} de ${formatCLP(amount)} por ${formatCLP(Math.abs(remaining))}.`;
          }
        }

        return { phase: 'B', final_message: message };
      }

      case 'ask_budget_status': {
        const budget = result.data?.active;
        if (budget?.amount && budget?.period) {
          return {
            phase: 'B',
            final_message: `Tu presupuesto ${budget.period} es de $${Number(budget.amount).toLocaleString('es-CL')}.`,
          };
        }
        return {
          phase: 'B',
          final_message: 'No tienes un presupuesto activo configurado.',
        };
      }

      case 'ask_goal_status': {
        const goals = result.data?.goals as any[];
        if (goals?.length) {
          const summary = goals
            .map((g: any) => `${g.name}: ${g.percentage}%`)
            .join(', ');
          return { phase: 'B', final_message: `Tus metas: ${summary}` };
        }
        return {
          phase: 'B',
          final_message: 'No tienes metas configuradas aún.',
        };
      }

      case 'greeting':
        return {
          phase: 'B',
          final_message: '¡Hola! ¿En qué te puedo ayudar hoy?',
        };

      case 'manage_transactions': {
        const data = result.data as {
          operation: string;
          transactions?: any[];
          count?: number;
          deleted?: any;
          previous?: any;
          updated?: any;
          changes?: string[];
        };

        if (!data) {
          return {
            phase: 'B',
            final_message: 'Procesado correctamente.',
          };
        }

        const formatCLP = (n: number) => `$${n.toLocaleString('es-CL')}`;

        if (data.operation === 'list') {
          if (!data.transactions?.length) {
            return {
              phase: 'B',
              final_message: 'No tienes gastos registrados.',
            };
          }
          const lines = data.transactions.map(
            (tx: any, i: number) => {
              const desc = tx.description ? ` — ${tx.description}` : '';
              const date = tx.posted_at?.substring(0, 10) ?? '';
              return `${i + 1}. ${formatCLP(tx.amount)} en ${tx.category || '?'} (${date})${desc}`;
            },
          );
          return {
            phase: 'B',
            final_message: `Tus últimos ${data.count} gastos:\n${lines.join('\n')}`,
          };
        }

        if (data.operation === 'delete' && data.deleted) {
          return {
            phase: 'B',
            final_message: `Eliminado: ${formatCLP(data.deleted.amount)} en ${data.deleted.category || '?'}.`,
          };
        }

        if (data.operation === 'edit' && data.previous && data.updated) {
          const changeDetails = (data.changes || [])
            .map((c: string) => {
              if (c === 'monto')
                return `monto de ${formatCLP(data.previous.amount)} a ${formatCLP(data.updated.amount)}`;
              if (c === 'categoría')
                return `categoría de ${data.previous.category} a ${data.updated.category}`;
              if (c === 'descripción')
                return `descripción`;
              if (c === 'fecha')
                return `fecha`;
              return c;
            })
            .join(', ');
          return {
            phase: 'B',
            final_message: `Listo, cambié ${changeDetails}.`,
          };
        }

        return { phase: 'B', final_message: 'Procesado correctamente.' };
      }

      case 'manage_categories': {
        const data = result.data as {
          operation?: string;
          category?: { id: string; name: string };
          categories?: any[];
          count?: number;
          old_name?: string;
          name?: string;
          transaction?: { amount: number; category: string };
          deleted?: boolean;
          transactionCount?: number;
        };

        if (!data) {
          return { phase: 'B', final_message: 'Procesado correctamente.' };
        }

        const formatCLP = (n: number) => `$${n.toLocaleString('es-CL')}`;

        if (data.operation === 'list') {
          if (!data.categories?.length) {
            return {
              phase: 'B',
              final_message: 'No tienes categorías configuradas.',
            };
          }
          const lines = data.categories.map((cat: any) => {
            const icon = cat.icon ? `${cat.icon} ` : '';
            const children =
              cat.children?.length > 0
                ? ` (${cat.children.map((c: any) => c.name).join(', ')})`
                : '';
            return `• ${icon}${cat.name}${children}`;
          });
          return {
            phase: 'B',
            final_message: `Tus categorías (${data.count}):\n${lines.join('\n')}`,
          };
        }

        if (data.operation === 'create') {
          return {
            phase: 'B',
            final_message: `¡Listo! Creé la categoría "${data.category?.name}".`,
          };
        }

        if (data.operation === 'create_and_register' && data.transaction) {
          return {
            phase: 'B',
            final_message: `Creé la categoría "${data.category?.name}" y registré ${formatCLP(data.transaction.amount)} en ella.`,
          };
        }

        if (data.operation === 'rename') {
          return {
            phase: 'B',
            final_message: `Renombré "${data.old_name}" a "${data.category?.name}".`,
          };
        }

        if (data.operation === 'delete') {
          if (data.deleted) {
            return {
              phase: 'B',
              final_message: `Eliminé la categoría "${data.name}".`,
            };
          }
          if (data.transactionCount) {
            return {
              phase: 'B',
              final_message: `La categoría "${data.name}" tiene ${data.transactionCount} transacciones. ¿La elimino de todas formas?`,
            };
          }
        }

        return { phase: 'B', final_message: 'Procesado correctamente.' };
      }

      case 'ask_app_info': {
        // In stub mode, generate a helpful response based on the question
        const data = result.data as {
          userQuestion: string;
          suggestedTopic: string;
          appKnowledge: any;
          aiInstruction: string;
        };

        if (!data?.appKnowledge) {
          return {
            phase: 'B',
            final_message:
              'Soy TallyFinance, tu asistente de finanzas personales. ¿En qué te puedo ayudar?',
          };
        }

        const topic = data.suggestedTopic || 'other';
        const knowledge = data.appKnowledge;

        // Generate response based on suggested topic
        switch (topic) {
          case 'capabilities': {
            const features = knowledge.currentFeatures || [];
            const featureList = features
              .map((f: any) => `• ${f.name}`)
              .join('\n');
            const coming = knowledge.comingSoon || [];
            const comingList = coming
              .slice(0, 2)
              .map((c: any) => c.name)
              .join(', ');

            let msg = `¡Puedo ayudarte con varias cosas!\n\n${featureList}`;
            if (comingList) {
              msg += `\n\n🔜 Próximamente: ${comingList}`;
            }
            msg += '\n\n¿Qué te gustaría hacer?';
            return { phase: 'B', final_message: msg };
          }

          case 'how_to': {
            const feature = knowledge.currentFeatures?.[0]; // Default to first feature
            if (feature?.examples) {
              const examples = feature.examples.slice(0, 2).join('" o "');
              return {
                phase: 'B',
                final_message: `${feature.description}\n\nPor ejemplo: "${examples}"\n\n💡 ${feature.tips?.[0] || 'Habla natural, como con un amigo'}`,
              };
            }
            return {
              phase: 'B',
              final_message:
                'Solo cuéntame lo que necesitas de forma natural. Por ejemplo: "Gasté 10 lucas en comida" o "¿Cómo va mi presupuesto?"',
            };
          }

          case 'limitations': {
            const limits = knowledge.limitations?.currentVersion || [];
            const limitList = limits.slice(0, 3).join('\n• ');
            return {
              phase: 'B',
              final_message: `Actualmente tengo algunas limitaciones:\n\n• ${limitList}\n\n${knowledge.limitations?.whyTheseLimitations || 'Estamos trabajando en mejorar constantemente.'}`,
            };
          }

          case 'channels': {
            const channels = knowledge.channels;
            return {
              phase: 'B',
              final_message: `${channels?.howItWorks || 'Me escribes por chat como a un amigo.'}\n\n📱 Disponible en: ${channels?.supported?.join(' y ') || 'Telegram y WhatsApp'}\n\n${channels?.linking || 'Vincula tu cuenta desde la app web.'}`,
            };
          }

          case 'getting_started': {
            const steps = knowledge.gettingStarted?.steps || [];
            const tips = knowledge.gettingStarted?.tips?.slice(0, 2) || [];
            let msg = '¡Empezar es muy fácil!\n\n';
            msg += steps.join('\n');
            if (tips.length > 0) {
              msg += '\n\n💡 Tips:\n• ' + tips.join('\n• ');
            }
            return { phase: 'B', final_message: msg };
          }

          case 'about': {
            const identity = knowledge.identity;
            return {
              phase: 'B',
              final_message: `${identity?.description || 'Soy TallyFinance, tu asistente de finanzas personales.'}\n\n${identity?.personality || 'Soy amigable y me adapto a tu estilo.'}`,
            };
          }

          case 'security': {
            const security = knowledge.security;
            return {
              phase: 'B',
              final_message: `🔒 Tu seguridad es prioridad:\n\n• ${security?.dataPrivacy || 'Tus datos son privados'}\n• ${security?.bankAccess || 'No accedemos a tus cuentas bancarias'}\n• ${security?.encryption || 'Todo está encriptado'}`,
            };
          }

          case 'pricing': {
            const faq = knowledge.faq?.find((f: any) =>
              f.q.toLowerCase().includes('gratis'),
            );
            return {
              phase: 'B',
              final_message:
                faq?.a ||
                'TallyFinance tiene un plan gratuito con funcionalidades básicas. ¡Empieza gratis!',
            };
          }

          case 'conversation': {
            // Fallback for general conversation - be helpful and redirect
            const features = knowledge.currentFeatures || [];
            const featureList = features
              .map((f: any) => `• ${f.name}`)
              .join('\n');
            const userQ = data.userQuestion || '';

            // Try to give a helpful response based on keywords in the question
            if (/gracias|thanks|thx/i.test(userQ)) {
              return {
                phase: 'B',
                final_message:
                  '¡De nada! 😊 Estoy aquí para ayudarte. ¿Hay algo más que pueda hacer por ti?',
              };
            }

            if (/chao|adios|bye|hasta/i.test(userQ)) {
              return {
                phase: 'B',
                final_message:
                  '¡Hasta pronto! 👋 Cuando quieras registrar un gasto o revisar tus finanzas, aquí estaré.',
              };
            }

            if (/ok|bien|dale|ya|listo|genial|perfecto/i.test(userQ)) {
              return {
                phase: 'B',
                final_message:
                  '¡Perfecto! ¿En qué más te puedo ayudar? Puedes contarme un gasto o preguntarme por tu presupuesto.',
              };
            }

            // Generic helpful fallback
            return {
              phase: 'B',
              final_message: `No estoy seguro de entender, pero no te preocupes. 😊\n\nSoy tu asistente de finanzas y puedo ayudarte a:\n${featureList}\n\n¿Qué te gustaría hacer?`,
            };
          }

          default: {
            // General response with app overview
            const identity = knowledge.identity;
            const features = knowledge.currentFeatures || [];
            const featureList = features
              .map((f: any) => `• ${f.name}`)
              .join('\n');

            return {
              phase: 'B',
              final_message: `¡Hola! Soy ${identity?.name || 'TallyFinance'}, ${identity?.tagline || 'tu asistente de finanzas personales'}.\n\nPuedo ayudarte a:\n${featureList}\n\n¿En qué te ayudo?`,
            };
          }
        }
      }

      default:
        return { phase: 'B', final_message: 'Procesado correctamente.' };
    }
  }

  /**
   * Returns circuit breaker stats for monitoring.
   */
  getCircuitBreakerStats(): { state: string; failures: number } {
    return this.circuitBreaker.getStats();
  }

  /**
   * Finds the best matching category from available categories.
   * Uses multiple strategies: exact match, synonyms, partial match.
   *
   * @param input User input (e.g., "comida", "alimentación", "transporte")
   * @param availableCategories List of actual category names from DB
   * @returns Matched category name or null if no good match
   */
  private findBestCategoryMatch(
    input: string,
    availableCategories: string[],
  ): string | null {
    if (!input || !availableCategories?.length) return null;

    const inputLower = input.toLowerCase().trim();

    // 1. EXACT MATCH (case-insensitive)
    for (const cat of availableCategories) {
      if (cat.toLowerCase() === inputLower) {
        return cat;
      }
    }

    // 2. SYNONYM MATCHING - Maps common words to standard category names
    const SYNONYMS: Record<string, string[]> = {
      // Food/Eating
      alimentación: [
        'comida',
        'comidas',
        'alimento',
        'alimentos',
        'comer',
        'almuerzo',
        'cena',
        'desayuno',
        'restaurante',
        'restaurant',
        'café',
        'cafe',
        'food',
        'eating',
      ],
      comida: [
        'alimentación',
        'alimentacion',
        'alimento',
        'almuerzo',
        'cena',
        'desayuno',
        'restaurante',
        'restaurant',
      ],

      // Transport
      transporte: [
        'uber',
        'taxi',
        'metro',
        'bus',
        'micro',
        'colectivo',
        'bencina',
        'gasolina',
        'estacionamiento',
        'peaje',
        'pasaje',
        'viaje',
        'transport',
        'movilización',
        'movilizacion',
      ],
      movilización: ['transporte', 'uber', 'taxi', 'metro', 'bus'],

      // Home
      hogar: [
        'casa',
        'arriendo',
        'alquiler',
        'rent',
        'luz',
        'agua',
        'gas',
        'electricidad',
        'internet',
        'servicios',
        'home',
        'household',
      ],
      casa: ['hogar', 'arriendo', 'servicios'],

      // Health
      salud: [
        'médico',
        'medico',
        'doctor',
        'farmacia',
        'remedios',
        'medicina',
        'hospital',
        'clínica',
        'clinica',
        'dentista',
        'health',
        'healthcare',
      ],
      médico: ['salud', 'doctor', 'hospital'],

      // Education
      educación: [
        'educacion',
        'colegio',
        'universidad',
        'curso',
        'cursos',
        'libro',
        'libros',
        'estudio',
        'estudios',
        'education',
        'school',
      ],
      educacion: ['educación', 'colegio', 'universidad', 'curso'],

      // Personal
      personal: [
        'ropa',
        'vestuario',
        'belleza',
        'peluquería',
        'peluqueria',
        'gym',
        'gimnasio',
        'deporte',
        'entretenimiento',
        'ocio',
        'hobby',
        'hobbies',
      ],

      // Entertainment
      entretenimiento: [
        'cine',
        'película',
        'pelicula',
        'netflix',
        'spotify',
        'juegos',
        'games',
        'ocio',
        'diversión',
        'diversion',
        'entertainment',
      ],
      ocio: ['entretenimiento', 'diversión', 'hobby'],
    };

    // Find synonym match
    for (const cat of availableCategories) {
      const catLower = cat.toLowerCase();

      // Check if input is a synonym of this category
      const synonymList = SYNONYMS[catLower];
      if (synonymList?.includes(inputLower)) {
        return cat;
      }

      // Check reverse - if input has synonyms that match this category
      const inputSynonyms = SYNONYMS[inputLower];
      if (inputSynonyms?.some((syn) => syn === catLower)) {
        return cat;
      }
    }

    // 3. PARTIAL/SUBSTRING MATCH (as fallback)
    for (const cat of availableCategories) {
      const catLower = cat.toLowerCase();
      // Input is part of category OR category is part of input
      if (catLower.includes(inputLower) || inputLower.includes(catLower)) {
        return cat;
      }
    }

    // 4. LEVENSHTEIN-LIKE: Check for very similar strings (typos)
    for (const cat of availableCategories) {
      if (this.isSimilarString(inputLower, cat.toLowerCase(), 2)) {
        return cat;
      }
    }

    return null;
  }

  /**
   * Simple similarity check - allows up to N character differences.
   * Good for catching typos.
   */
  private isSimilarString(a: string, b: string, maxDiff: number): boolean {
    if (Math.abs(a.length - b.length) > maxDiff) return false;

    let diff = 0;
    const minLen = Math.min(a.length, b.length);
    for (let i = 0; i < minLen; i++) {
      if (a[i] !== b[i]) diff++;
      if (diff > maxDiff) return false;
    }
    diff += Math.abs(a.length - b.length);
    return diff <= maxDiff;
  }
}
