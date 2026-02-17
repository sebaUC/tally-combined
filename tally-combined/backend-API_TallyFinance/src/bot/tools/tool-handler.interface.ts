import { DomainMessage } from '../contracts';
import { ActionResult } from '../actions/action-result';
import { ToolSchema } from './tool-schemas';

/**
 * Enhanced ToolHandler interface following OCP (Open-Closed Principle).
 *
 * Each handler is self-describing with:
 * - name: Unique identifier for the tool
 * - schema: JSON Schema for AI tool calling
 * - requiresContext: Whether to load user context before execution
 *
 * This allows:
 * - New handlers to be added without modifying the registry
 * - Conditional context loading to reduce DB queries
 * - Self-registration pattern
 */
export interface ToolHandler {
  /**
   * Unique identifier for this tool.
   * Must match the name used in AI tool calling.
   */
  readonly name: string;

  /**
   * JSON Schema describing the tool for AI.
   * Used by the orchestrator to understand available tools.
   */
  readonly schema: ToolSchema;

  /**
   * Whether this handler needs user context to execute.
   *
   * true = Load context from DB before execute() (e.g., ask_balance, register_transaction)
   * false = Skip context loading (e.g., greeting, unknown)
   *
   * This optimization reduces unnecessary DB queries for simple intents.
   */
  readonly requiresContext: boolean;

  /**
   * Executes the tool logic.
   *
   * @param userId - The authenticated user's ID
   * @param msg - The original domain message
   * @param args - Arguments extracted by AI from user message
   * @returns ActionResult with data for Phase B or userMessage for slot-filling
   */
  execute(
    userId: string,
    msg: DomainMessage,
    args: Record<string, unknown>,
  ): Promise<ActionResult>;
}

/**
 * Metadata for registering a tool handler.
 * Used for self-registration pattern.
 */
export interface ToolHandlerMetadata {
  name: string;
  schema: ToolSchema;
  requiresContext: boolean;
}

/**
 * Base class for tool handlers that provides common metadata.
 * Handlers can extend this or implement ToolHandler directly.
 */
export abstract class BaseToolHandler implements ToolHandler {
  abstract readonly name: string;
  abstract readonly schema: ToolSchema;
  abstract readonly requiresContext: boolean;

  abstract execute(
    userId: string,
    msg: DomainMessage,
    args: Record<string, unknown>,
  ): Promise<ActionResult>;
}
