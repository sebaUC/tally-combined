/**
 * Gemini Client — Single-pass function calling with conversation context.
 *
 * This is the core of bot v3: one Gemini call per user turn.
 * The model receives the full conversation + function declarations,
 * decides what to do, and generates the response with personality.
 */
import {
  GoogleGenerativeAI,
  type Content,
  type Part,
  type Tool,
  type FunctionCall,
} from '@google/generative-ai';
import { Logger } from '@nestjs/common';

export interface GeminiResult {
  reply: string;
  functionsCalled: { name: string; args: Record<string, any>; result: any }[];
  tokensUsed: { input: number; output: number; total: number };
}

export type FunctionExecutor = (
  name: string,
  args: Record<string, any>,
) => Promise<Record<string, any>>;

const MAX_FUNCTION_LOOPS = 10;

export class GeminiClient {
  private readonly log = new Logger(GeminiClient.name);
  private readonly genAI: GoogleGenerativeAI;
  private readonly modelName: string;

  constructor(apiKey: string, model = 'gemini-2.5-flash') {
    this.genAI = new GoogleGenerativeAI(apiKey);
    this.modelName = model;
  }

  async chat(
    systemPrompt: string,
    history: Content[],
    userParts: Part[],
    tools: Tool[],
    executeFn: FunctionExecutor,
  ): Promise<GeminiResult> {
    const model = this.genAI.getGenerativeModel({
      model: this.modelName,
      systemInstruction: systemPrompt,
      tools,
      toolConfig: { functionCallingConfig: { mode: 'AUTO' as any } },
    });

    const chat = model.startChat({ history });
    const functionsCalled: GeminiResult['functionsCalled'] = [];
    let totalInput = 0;
    let totalOutput = 0;

    // Send user message
    let response = await chat.sendMessage(userParts);
    totalInput += response.response.usageMetadata?.promptTokenCount ?? 0;
    totalOutput += response.response.usageMetadata?.candidatesTokenCount ?? 0;

    // Function calling loop
    let loops = 0;
    while (
      response.response.functionCalls()?.length &&
      loops < MAX_FUNCTION_LOOPS
    ) {
      loops++;
      const fnCalls = response.response.functionCalls()!;

      // Reorder: manage_category(create) before register_expense with same category
      const ordered = this.reorderCalls(fnCalls);

      // Execute each function
      const fnResponses: Part[] = [];
      for (const fc of ordered) {
        this.log.debug(
          `[fn] ${fc.name}(${JSON.stringify(fc.args).substring(0, 100)})`,
        );

        let fnResult: Record<string, any>;
        try {
          fnResult = await executeFn(fc.name, fc.args as Record<string, any>);
        } catch (err) {
          fnResult = { ok: false, error: String(err) };
        }

        functionsCalled.push({
          name: fc.name,
          args: fc.args as Record<string, any>,
          result: fnResult,
        });
        fnResponses.push({
          functionResponse: { name: fc.name, response: fnResult },
        } as any);
      }

      // Continue with function results
      response = await chat.sendMessage(fnResponses);
      totalInput += response.response.usageMetadata?.promptTokenCount ?? 0;
      totalOutput += response.response.usageMetadata?.candidatesTokenCount ?? 0;
    }

    const reply = response.response.text() || '';

    return {
      reply,
      functionsCalled,
      tokensUsed: {
        input: totalInput,
        output: totalOutput,
        total: totalInput + totalOutput,
      },
    };
  }

  /**
   * Reorder parallel function calls so dependencies execute first.
   * manage_category(create) → before register_expense with same category
   * delete_transaction → before register_expense (avoid balance conflicts)
   */
  private reorderCalls(calls: FunctionCall[]): FunctionCall[] {
    if (calls.length <= 1) return calls;

    const creates: FunctionCall[] = [];
    const deletes: FunctionCall[] = [];
    const rest: FunctionCall[] = [];

    for (const fc of calls) {
      if (
        fc.name === 'manage_category' &&
        (fc.args as any)?.operation === 'create'
      ) {
        creates.push(fc);
      } else if (fc.name === 'delete_transaction') {
        deletes.push(fc);
      } else {
        rest.push(fc);
      }
    }

    // Order: deletes first, then creates, then everything else
    return [...deletes, ...creates, ...rest];
  }
}
