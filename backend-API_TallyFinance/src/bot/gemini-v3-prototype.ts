/**
 * V3 Prototype: Gemini Function Calling — Dry Run Mode
 *
 * Functions describe what they WOULD do instead of executing.
 * Tests the full pipeline: system prompt + conversation + function calling + personality.
 */
import { GoogleGenerativeAI, type Content, type Part, type Tool } from '@google/generative-ai';

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
const MODEL = 'gemini-2.5-flash';

// ── Function Declarations ──

const tools: Tool[] = [
  {
    functionDeclarations: [
      {
        name: 'register_expense',
        description: 'Registra un gasto del usuario',
        parameters: {
          type: 'object' as any,
          properties: {
            amount: { type: 'number' as any, description: 'Monto en CLP' },
            category: { type: 'string' as any, description: 'Nombre de la categoría' },
            name: { type: 'string' as any, description: 'Nombre descriptivo corto (2-4 palabras, Title Case)' },
            posted_at: { type: 'string' as any, description: 'Fecha ISO-8601, default hoy' },
            description: { type: 'string' as any, description: 'Descripción opcional' },
          },
          required: ['amount', 'category', 'name'],
        },
      },
      {
        name: 'register_income',
        description: 'Registra un ingreso del usuario (sueldo, venta, freelance, transferencia)',
        parameters: {
          type: 'object' as any,
          properties: {
            amount: { type: 'number' as any, description: 'Monto en CLP' },
            source: { type: 'string' as any, description: 'Fuente del ingreso (ej: Sueldo Marzo, Venta Bicicleta)' },
            posted_at: { type: 'string' as any, description: 'Fecha ISO-8601, default hoy' },
          },
          required: ['amount', 'source'],
        },
      },
      {
        name: 'query_transactions',
        description: 'Busca, filtra y agrega transacciones del usuario',
        parameters: {
          type: 'object' as any,
          properties: {
            operation: { type: 'string' as any, description: 'list, sum, o count' },
            category: { type: 'string' as any, description: 'Filtrar por categoría' },
            type: { type: 'string' as any, description: 'expense, income, o all' },
            period: { type: 'string' as any, description: 'today, week, month, year, o custom' },
            start_date: { type: 'string' as any, description: 'Inicio del rango ISO-8601' },
            end_date: { type: 'string' as any, description: 'Fin del rango ISO-8601' },
            limit: { type: 'number' as any, description: 'Máximo de resultados (default 10)' },
          },
          required: ['operation'],
        },
      },
      {
        name: 'edit_transaction',
        description: 'Edita cualquier campo de una transacción existente',
        parameters: {
          type: 'object' as any,
          properties: {
            transaction_id: { type: 'string' as any, description: 'UUID de la transacción' },
            hint_amount: { type: 'number' as any, description: 'Monto aprox para identificar' },
            hint_category: { type: 'string' as any, description: 'Categoría para identificar' },
            new_amount: { type: 'number' as any, description: 'Nuevo monto' },
            new_category: { type: 'string' as any, description: 'Nueva categoría' },
            new_name: { type: 'string' as any, description: 'Nuevo nombre' },
            new_description: { type: 'string' as any, description: 'Nueva descripción' },
            new_posted_at: { type: 'string' as any, description: 'Nueva fecha' },
          },
          required: [],
        },
      },
      {
        name: 'delete_transaction',
        description: 'Elimina una transacción',
        parameters: {
          type: 'object' as any,
          properties: {
            transaction_id: { type: 'string' as any, description: 'UUID de la transacción' },
            hint_amount: { type: 'number' as any, description: 'Monto aprox para identificar' },
            hint_category: { type: 'string' as any, description: 'Categoría para identificar' },
          },
          required: [],
        },
      },
      {
        name: 'manage_category',
        description: 'CRUD completo de categorías: listar, crear, renombrar, eliminar, cambiar emoji o presupuesto',
        parameters: {
          type: 'object' as any,
          properties: {
            operation: { type: 'string' as any, description: 'list, create, rename, delete, update_icon, o update_budget' },
            name: { type: 'string' as any, description: 'Nombre de la categoría' },
            new_name: { type: 'string' as any, description: 'Nuevo nombre (rename)' },
            icon: { type: 'string' as any, description: 'Emoji de la categoría' },
            budget: { type: 'number' as any, description: 'Presupuesto mensual' },
            force_delete: { type: 'boolean' as any, description: 'Forzar eliminación con transacciones' },
          },
          required: ['operation'],
        },
      },
      {
        name: 'get_balance',
        description: 'Obtiene balance, gastos, ingresos y presupuesto del usuario',
        parameters: {
          type: 'object' as any,
          properties: {
            period: { type: 'string' as any, description: 'today, week, month, year, o custom' },
            start_date: { type: 'string' as any, description: 'Inicio del rango' },
            end_date: { type: 'string' as any, description: 'Fin del rango' },
            category: { type: 'string' as any, description: 'Filtrar por categoría' },
            include_budget: { type: 'boolean' as any, description: 'Incluir info de presupuesto' },
            include_breakdown: { type: 'boolean' as any, description: 'Desglose por categoría' },
          },
          required: [],
        },
      },
      {
        name: 'get_app_info',
        description: 'Responde preguntas sobre TallyFinance, funcionalidades, limitaciones, cómo usar el bot',
        parameters: {
          type: 'object' as any,
          properties: {
            question: { type: 'string' as any, description: 'La pregunta del usuario' },
          },
          required: ['question'],
        },
      },
    ],
  },
];

// ── Mock Function Executor (dry run) ──

function executeMockFunction(name: string, args: Record<string, any>): Record<string, any> {
  const fmt = (n: number) => `$${Math.round(n).toLocaleString('es-CL')}`;

  switch (name) {
    case 'register_expense':
      return {
        ok: true,
        action: '_REGISTRARÍA GASTO_',
        data: {
          id: 'tx-mock-' + Date.now().toString(36),
          amount: args.amount,
          category: args.category,
          name: args.name,
          posted_at: args.posted_at || new Date().toISOString().split('T')[0],
          description: `*Registraría gasto de ${fmt(args.amount)} en categoría "${args.category}" con nombre "${args.name}"*`,
        },
      };

    case 'register_income':
      return {
        ok: true,
        action: '_REGISTRARÍA INGRESO_',
        data: {
          id: 'inc-mock-' + Date.now().toString(36),
          amount: args.amount,
          source: args.source,
          posted_at: args.posted_at || new Date().toISOString().split('T')[0],
          description: `*Registraría ingreso de ${fmt(args.amount)} desde "${args.source}"*`,
        },
      };

    case 'query_transactions':
      return {
        ok: true,
        action: '_CONSULTARÍA TRANSACCIONES_',
        data: {
          operation: args.operation,
          description: `*Buscaría transacciones: operation=${args.operation}, category=${args.category || 'todas'}, period=${args.period || 'month'}, type=${args.type || 'all'}*`,
          // Mock data para que Gemini tenga algo que mostrar
          results: [
            { amount: 5000, category: 'Alimentación', name: 'Almuerzo', posted_at: '2026-03-22' },
            { amount: 3000, category: 'Transporte', name: 'Uber', posted_at: '2026-03-22' },
            { amount: 15000, category: 'Alimentación', name: 'Supermercado', posted_at: '2026-03-21' },
          ],
          total: args.operation === 'sum' ? 23000 : 3,
        },
      };

    case 'edit_transaction':
      return {
        ok: true,
        action: '_EDITARÍA TRANSACCIÓN_',
        data: {
          description: `*Editaría transacción ${args.transaction_id || '(más reciente)'}: ${JSON.stringify(
            Object.fromEntries(
              Object.entries(args).filter(([k]) => k.startsWith('new_')).map(([k, v]) => [k.replace('new_', ''), v]),
            ),
          )}*`,
        },
      };

    case 'delete_transaction':
      return {
        ok: true,
        action: '_ELIMINARÍA TRANSACCIÓN_',
        data: {
          description: `*Eliminaría transacción ${args.transaction_id || `con monto ~${args.hint_amount || '?'} en ${args.hint_category || '?'}`}*`,
        },
      };

    case 'manage_category':
      return {
        ok: true,
        action: `_${args.operation?.toUpperCase()} CATEGORÍA_`,
        data: {
          operation: args.operation,
          name: args.name,
          icon: args.icon,
          description: `*${args.operation} categoría "${args.name || 'todas'}"${args.icon ? ` con emoji ${args.icon}` : ''}${args.new_name ? ` → "${args.new_name}"` : ''}*`,
          // Mock categories for list
          ...(args.operation === 'list' ? {
            categories: [
              { name: 'Alimentación', icon: '🍽️' },
              { name: 'Transporte', icon: '🚗' },
              { name: 'Personal', icon: '👕' },
              { name: 'Salud', icon: '💊' },
              { name: 'Educación', icon: '📚' },
              { name: 'Hogar', icon: '🏠' },
            ],
          } : {}),
        },
      };

    case 'get_balance':
      return {
        ok: true,
        action: '_CONSULTARÍA BALANCE_',
        data: {
          totalBalance: 350000,
          totalSpent: 45000,
          totalIncome: 500000,
          period: args.period || 'month',
          description: `*Consultaría balance: period=${args.period || 'month'}, category=${args.category || 'todas'}*`,
          activeBudget: { period: 'monthly', amount: 100000, remaining: 55000 },
        },
      };

    case 'get_app_info':
      return {
        ok: true,
        action: '_INFO APP_',
        data: {
          question: args.question,
          answer: 'TallyFinance es tu asistente financiero personal. Puedes registrar gastos e ingresos, gestionar categorías, consultar tu balance y presupuesto, todo desde el chat.',
        },
      };

    default:
      return { ok: false, error: `Función desconocida: ${name}` };
  }
}

// ── Build System Prompt ──

function buildSystemPrompt(userContext: { displayName: string; tone: string; mood: string; categories: string[] }): string {
  return `Eres Gus, asistente financiero personal de TallyFinance.

IDENTIDAD:
- Tu nombre es Gus. Eres chileno. Trabajas para TallyFinance SPA.
- Nunca dices que eres un bot, IA o programa. Eres "Gus, asistente financiero".
- Entiendes "lucas" = x1000 CLP (pesos chilenos). "10 lucas" = $10.000.

TONO: ${userContext.tone}
Tu tono define CÓMO hablas en CADA mensaje. Es la regla más importante.
- neutral: Directo, eficiente, sin adornos.
- friendly: Cercano, cálido, puede usar 1 emoji.
- serious: Profesional, conciso.
- motivational: Energía positiva, impulsa al usuario.
- strict: Mínimo absoluto, sin rodeos.
- toxic: Sarcástico, confrontacional, humor negro sobre el gasto. Pica al usuario con cariño.
Sigue siempre ángulos y direcciones del tono, nunca frases fijas. Varía creativamente cada vez.

MOOD: ${userContext.mood}
Ajusta la intensidad del tono según el mood actual.

COMPORTAMIENTO:
- Registra gastos e ingresos cuando el usuario lo pide.
- Genera nombres descriptivos para transacciones (2-4 palabras, Title Case).
- Elige emojis creativos y precisos para categorías nuevas.
- Responde consultas financieras con datos reales de las funciones.
- Mantiene conversación natural — recuerda todo lo que se habló.
- Nunca inventa montos — si no hay número explícito, pregunta.
- Nunca repite la misma estructura dos veces seguidas.
- Los ingresos son entidades separadas (sin categoría).
- Cuando una categoría no existe, pregunta si crearla.

LIMITACIONES:
- Solo finanzas personales. Temas fuera de dominio → redirige amablemente al estilo del tono.
- No puede acceder a bancos ni hacer transferencias.
- Moneda: CLP. "lucas" = x1000.

CATEGORÍAS DEL USUARIO: ${userContext.categories.join(', ')}

USUARIO: ${userContext.displayName}

MODO DRY RUN: Las funciones NO ejecutan realmente — retornan descripciones en cursiva de lo que harían. Incluye estas descripciones en tu respuesta para que el usuario vea qué pasaría.`;
}

// ── Main Chat Function ──

// In-memory conversation store (per session)
const conversations = new Map<string, Content[]>();

export async function chatV3(
  userId: string,
  message: string,
  userContext: { displayName: string; tone: string; mood: string; categories: string[] },
  mediaParts?: Part[],
): Promise<{ reply: string; functionsCalled: string[]; tokensUsed: { input: number; output: number } }> {
  if (!GEMINI_API_KEY) {
    return { reply: 'Error: GEMINI_API_KEY no configurada', functionsCalled: [], tokensUsed: { input: 0, output: 0 } };
  }

  const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
  const model = genAI.getGenerativeModel({
    model: MODEL,
    systemInstruction: buildSystemPrompt(userContext),
    tools,
  });

  // Get or create conversation
  if (!conversations.has(userId)) {
    conversations.set(userId, []);
  }
  const history = conversations.get(userId)!;

  // Build user message parts
  const userParts: Part[] = [];
  if (mediaParts?.length) {
    userParts.push(...mediaParts);
  }
  userParts.push({ text: message });

  // Add user message to history
  history.push({ role: 'user', parts: userParts });

  const functionsCalled: string[] = [];
  let totalInputTokens = 0;
  let totalOutputTokens = 0;

  // Start chat with history
  const chat = model.startChat({
    history: history.slice(0, -1), // all except the last (current) message
  });

  // Send current message
  let result = await chat.sendMessage(userParts);
  let response = result.response;

  totalInputTokens += response.usageMetadata?.promptTokenCount ?? 0;
  totalOutputTokens += response.usageMetadata?.candidatesTokenCount ?? 0;

  // Function calling loop
  let maxIterations = 5; // safety limit
  while (response.functionCalls()?.length && maxIterations > 0) {
    maxIterations--;
    const fnCalls = response.functionCalls()!;

    // Execute each function call (mock)
    const fnResponses: Part[] = [];
    for (const fc of fnCalls) {
      functionsCalled.push(`${fc.name}(${JSON.stringify(fc.args)})`);
      const fnResult = executeMockFunction(fc.name, fc.args as Record<string, any>);

      fnResponses.push({
        functionResponse: {
          name: fc.name,
          response: fnResult,
        },
      } as any);
    }

    // Add function call + response to history
    history.push({
      role: 'model',
      parts: fnCalls.map((fc) => ({ functionCall: { name: fc.name, args: fc.args } } as any)),
    });
    history.push({
      role: 'function' as any,
      parts: fnResponses,
    });

    // Continue the conversation with function results
    result = await chat.sendMessage(fnResponses);
    response = result.response;

    totalInputTokens += response.usageMetadata?.promptTokenCount ?? 0;
    totalOutputTokens += response.usageMetadata?.candidatesTokenCount ?? 0;
  }

  // Extract final text
  const reply = response.text() || '(sin respuesta)';

  // Add model response to history
  history.push({ role: 'model', parts: [{ text: reply }] });

  // Trim history to 50 entries
  while (history.length > 50) {
    history.shift();
  }

  return {
    reply,
    functionsCalled,
    tokensUsed: { input: totalInputTokens, output: totalOutputTokens },
  };
}

// ── Reset conversation ──
export function resetV3Conversation(userId: string): void {
  conversations.delete(userId);
}
