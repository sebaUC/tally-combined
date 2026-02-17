import { Injectable, Logger } from '@nestjs/common';
import { ToolCall } from './orchestrator.contracts';

export interface ValidationResult {
  valid: boolean;
  error?: string;
  sanitized?: ToolCall;
}

interface ToolSchema {
  required: string[];
  validators: Record<string, (value: any) => boolean>;
  sanitizers?: Record<string, (value: any) => any>;
}

@Injectable()
export class GuardrailsService {
  private readonly log = new Logger(GuardrailsService.name);

  private readonly schemas: Record<string, ToolSchema> = {
    register_transaction: {
      required: ['amount', 'category'],
      validators: {
        amount: (v) => typeof v === 'number' && v > 0 && v < 100_000_000,
        category: (v) =>
          typeof v === 'string' && v.length > 0 && v.length < 100,
        description: (v) =>
          v === undefined || (typeof v === 'string' && v.length < 500),
      },
      sanitizers: {
        amount: (v) => Math.round(Number(v) * 100) / 100,
        category: (v) => String(v).trim().toLowerCase(),
        description: (v) => (v ? String(v).trim() : undefined),
      },
    },
    manage_transactions: {
      required: [], // operation inferred by handler when AI omits it
      validators: {
        operation: (v) =>
          typeof v === 'string' && ['list', 'edit', 'delete'].includes(v),
        // transaction_id: lenient — AI often hallucinates non-UUID IDs;
        // sanitizer strips invalid values so handler falls through to hints/most-recent
        transaction_id: (v) => v === undefined || typeof v === 'string',
        hint_amount: (v) =>
          v === undefined || (typeof v === 'number' && v > 0 && v < 100_000_000),
        hint_category: (v) =>
          v === undefined ||
          (typeof v === 'string' && v.length > 0 && v.length < 100),
        hint_description: (v) =>
          v === undefined || (typeof v === 'string' && v.length < 500),
        // limit: lenient — sanitizer clamps to 1-20; handler also clamps
        limit: (v) => v === undefined || typeof v === 'number',
        new_amount: (v) =>
          v === undefined || (typeof v === 'number' && v > 0 && v < 100_000_000),
        new_category: (v) =>
          v === undefined ||
          (typeof v === 'string' && v.length > 0 && v.length < 100),
        new_description: (v) =>
          v === undefined || (typeof v === 'string' && v.length < 500),
        choice: (v) =>
          v === undefined || (typeof v === 'number' && v >= 1 && v <= 20),
      },
      sanitizers: {
        operation: (v) => String(v).trim().toLowerCase(),
        // Strip non-UUID transaction_ids — handler resolveTransaction falls
        // through to hint-based or most-recent resolution when undefined
        transaction_id: (v) => {
          if (v && typeof v === 'string' && /^[a-f0-9-]{36}$/i.test(v))
            return v;
          return undefined;
        },
        hint_category: (v) => (v ? String(v).trim().toLowerCase() : undefined),
        hint_description: (v) => (v ? String(v).trim() : undefined),
        // Clamp limit to valid range instead of rejecting
        limit: (v) => {
          if (v === undefined) return undefined;
          const n = Math.round(Number(v));
          return Math.min(Math.max(n, 1), 20);
        },
        new_amount: (v) =>
          v !== undefined ? Math.round(Number(v) * 100) / 100 : undefined,
        new_category: (v) => (v ? String(v).trim().toLowerCase() : undefined),
        new_description: (v) => (v ? String(v).trim() : undefined),
        choice: (v) => (v !== undefined ? Math.round(Number(v)) : undefined),
      },
    },
    ask_balance: {
      required: [],
      validators: {},
    },
    ask_budget_status: {
      required: [],
      validators: {},
    },
    ask_goal_status: {
      required: [],
      validators: {
        goalId: (v) =>
          v === undefined ||
          (typeof v === 'string' && /^[a-f0-9-]{36}$/i.test(v)),
      },
    },
    greeting: {
      required: [],
      validators: {},
    },
    ask_app_info: {
      required: [],
      validators: {
        userQuestion: (v) =>
          v === undefined ||
          (typeof v === 'string' && v.length > 0 && v.length < 1000),
        suggestedTopic: (v) =>
          v === undefined || (typeof v === 'string' && v.length < 50),
      },
      sanitizers: {
        userQuestion: (v) => (v ? String(v).trim() : undefined),
        suggestedTopic: (v) => (v ? String(v).trim().toLowerCase() : 'other'),
      },
    },
  };

  validate(toolCall: ToolCall): ValidationResult {
    const schema = this.schemas[toolCall.name];

    if (!schema) {
      this.log.warn(`[validate] Unknown tool: ${toolCall.name}`);
      return {
        valid: false,
        error: `Unknown tool: ${toolCall.name}`,
      };
    }

    // Check required fields
    for (const field of schema.required) {
      if (toolCall.args[field] === undefined || toolCall.args[field] === null) {
        this.log.warn(
          `[validate] Missing required field '${field}' for tool '${toolCall.name}'`,
        );
        return {
          valid: false,
          error: `Missing required field: ${field}`,
        };
      }
    }

    // Run validators
    for (const [field, validator] of Object.entries(schema.validators)) {
      const value = toolCall.args[field];
      if (value !== undefined && !validator(value)) {
        this.log.warn(
          `[validate] Invalid value for '${field}' in tool '${toolCall.name}'`,
        );
        return {
          valid: false,
          error: `Invalid value for field: ${field}`,
        };
      }
    }

    // Apply sanitizers
    const sanitizedArgs = { ...toolCall.args };
    if (schema.sanitizers) {
      for (const [field, sanitizer] of Object.entries(schema.sanitizers)) {
        if (sanitizedArgs[field] !== undefined) {
          sanitizedArgs[field] = sanitizer(sanitizedArgs[field]);
        }
      }
    }

    return {
      valid: true,
      sanitized: {
        name: toolCall.name,
        args: sanitizedArgs,
      },
    };
  }

  validateAll(toolCalls: ToolCall[]): ValidationResult[] {
    return toolCalls.map((tc) => this.validate(tc));
  }

  hasValidTool(toolCalls: ToolCall[]): boolean {
    return toolCalls.some((tc) => this.validate(tc).valid);
  }
}
