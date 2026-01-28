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
