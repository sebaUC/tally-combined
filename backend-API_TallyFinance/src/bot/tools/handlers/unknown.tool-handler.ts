import { ToolHandler } from '../tool-handler.interface';
import { ToolSchema } from '../tool-schemas';
import { DomainMessage } from '../../contracts';
import { ActionResult } from '../../actions/action-result';

/**
 * UnknownToolHandler - Fallback handler for unrecognized intents.
 *
 * This handler is used when:
 * - AI returns an unknown tool name
 * - No handler is registered for the requested tool
 *
 * It doesn't require context and returns a helpful message.
 */
export class UnknownToolHandler implements ToolHandler {
  readonly name = 'unknown';

  readonly schema: ToolSchema = {
    name: 'unknown',
    description: 'Fallback para intenciones no reconocidas',
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
    return Promise.resolve({
      ok: true,
      action: 'none',
      userMessage:
        'No estoy seguro de lo que quisiste decir. ¿Puedes contármelo de otra forma?',
    });
  }
}
