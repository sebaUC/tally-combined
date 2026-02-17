import { ToolHandler } from '../tool-handler.interface';
import { ToolSchema } from '../tool-schemas';
import { DomainMessage } from '../../contracts';
import { ActionResult } from '../../actions/action-result';

/**
 * GreetingToolHandler - Handles simple greeting intents.
 *
 * This handler doesn't require user context since greetings
 * are personalized by Phase B using minimal context only.
 */
export class GreetingToolHandler implements ToolHandler {
  readonly name = 'greeting';

  readonly schema: ToolSchema = {
    name: 'greeting',
    description:
      'Responde a un saludo simple del usuario (hola, buenos días, etc)',
    parameters: {
      type: 'object',
      properties: {},
      required: [],
    },
  };

  readonly requiresContext = false;

  execute(
    _userId: string,
    _msg: DomainMessage,
    _args: Record<string, unknown>,
  ): Promise<ActionResult> {
    // Return action: 'none' so Phase B generates a personalized greeting
    return Promise.resolve({
      ok: true,
      action: 'none',
    });
  }
}
