import { Inject, Injectable, Logger } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { ToolHandler } from './tool-handler.interface';
import { ToolSchema } from './tool-schemas';

// Import all handlers
import { RegisterTransactionToolHandler } from './handlers/register-transaction.tool-handler';
import { AskBalanceToolHandler } from './handlers/ask-balance.tool-handler';
import { AskBudgetStatusToolHandler } from './handlers/ask-budget-status.tool-handler';
import { AskGoalStatusToolHandler } from './handlers/ask-goal-status.tool-handler';
import { GreetingToolHandler } from './handlers/greeting.tool-handler';
import { UnknownToolHandler } from './handlers/unknown.tool-handler';
import { AskAppInfoToolHandler } from './handlers/ask-app-info.tool-handler';

/**
 * ToolRegistry - OCP-compliant registry for tool handlers.
 *
 * Features:
 * - Self-registration: Handlers provide their own metadata
 * - Dynamic schemas: Tool schemas built from registered handlers
 * - Conditional context: Check if handler needs context before loading
 * - Extensible: New handlers can be added without modifying this class
 *
 * To add a new handler:
 * 1. Create handler implementing ToolHandler interface
 * 2. Import and register in constructor (or use register() at runtime)
 */
@Injectable()
export class ToolRegistry {
  private readonly log = new Logger(ToolRegistry.name);
  private readonly handlers = new Map<string, ToolHandler>();
  private readonly fallbackHandler: ToolHandler;

  constructor(@Inject('SUPABASE') private readonly supabase: SupabaseClient) {
    // Create fallback handler
    this.fallbackHandler = new UnknownToolHandler();

    // Register all built-in handlers
    this.registerAll([
      new RegisterTransactionToolHandler(supabase),
      new AskBalanceToolHandler(supabase),
      new AskBudgetStatusToolHandler(supabase),
      new AskGoalStatusToolHandler(supabase),
      new GreetingToolHandler(),
      new AskAppInfoToolHandler(),
    ]);

    this.log.log(
      `ToolRegistry initialized with ${this.handlers.size} handlers: ${this.getToolNames().join(', ')}`,
    );
  }

  /**
   * Registers a single handler.
   * Follows OCP - new handlers can be added without modifying existing code.
   *
   * @param handler - The handler to register
   * @throws Error if handler with same name already exists
   */
  register(handler: ToolHandler): void {
    if (this.handlers.has(handler.name)) {
      this.log.warn(
        `Handler for "${handler.name}" already registered, skipping`,
      );
      return;
    }

    this.handlers.set(handler.name, handler);
    this.log.debug(`Registered handler: ${handler.name}`);
  }

  /**
   * Registers multiple handlers at once.
   *
   * @param handlers - Array of handlers to register
   */
  registerAll(handlers: ToolHandler[]): void {
    for (const handler of handlers) {
      this.register(handler);
    }
  }

  /**
   * Gets a handler by name.
   * Returns fallback handler for unknown tools.
   *
   * @param name - Tool name
   * @returns The handler or fallback
   */
  getHandler(name: string): ToolHandler {
    const handler = this.handlers.get(name);
    if (handler) {
      return handler;
    }

    this.log.warn(`Unknown tool requested: ${name}, using fallback`);
    return this.fallbackHandler;
  }

  /**
   * Checks if a handler exists for the given name.
   *
   * @param name - Tool name
   * @returns true if handler exists
   */
  hasHandler(name: string): boolean {
    return this.handlers.has(name);
  }

  /**
   * Checks if a handler requires user context.
   * Used by BotService to conditionally load context.
   *
   * @param name - Tool name
   * @returns true if handler needs context, false otherwise
   */
  requiresContext(name: string): boolean {
    const handler = this.handlers.get(name);
    return handler?.requiresContext ?? false;
  }

  /**
   * Gets all tool schemas from registered handlers.
   * Schemas are built dynamically from handler metadata.
   *
   * @returns Array of tool schemas for AI
   */
  getToolSchemas(): ToolSchema[] {
    const schemas: ToolSchema[] = [];

    for (const handler of this.handlers.values()) {
      schemas.push(handler.schema);
    }

    return schemas;
  }

  /**
   * Gets all registered tool names.
   *
   * @returns Array of tool names
   */
  getToolNames(): string[] {
    return Array.from(this.handlers.keys());
  }

  /**
   * Gets handler metadata for debugging/introspection.
   *
   * @param name - Tool name
   * @returns Handler metadata or null
   */
  getHandlerInfo(name: string): {
    name: string;
    requiresContext: boolean;
    schemaDescription: string;
  } | null {
    const handler = this.handlers.get(name);
    if (!handler) return null;

    return {
      name: handler.name,
      requiresContext: handler.requiresContext,
      schemaDescription: handler.schema.description,
    };
  }

  /**
   * Lists all handlers with their metadata.
   * Useful for debugging and introspection.
   *
   * @returns Array of handler metadata
   */
  listHandlers(): Array<{
    name: string;
    requiresContext: boolean;
    description: string;
  }> {
    return Array.from(this.handlers.values()).map((h) => ({
      name: h.name,
      requiresContext: h.requiresContext,
      description: h.schema.description,
    }));
  }
}
