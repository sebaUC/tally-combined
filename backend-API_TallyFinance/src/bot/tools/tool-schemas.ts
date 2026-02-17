export interface ToolSchema {
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, { type: string; description: string }>;
    required: string[];
  };
}

export const TOOL_SCHEMAS: ToolSchema[] = [
  {
    name: 'register_transaction',
    description: 'Registra un gasto o ingreso del usuario en su cuenta',
    parameters: {
      type: 'object',
      properties: {
        amount: {
          type: 'number',
          description: 'Monto de la transacción en CLP (pesos chilenos)',
        },
        category: {
          type: 'string',
          description:
            'Nombre de la categoría (ej: comida, transporte, entretenimiento)',
        },
        posted_at: {
          type: 'string',
          description:
            'Fecha en formato ISO-8601 (YYYY-MM-DD o ISO completo). Si no se especifica, se usa la fecha actual',
        },
        description: {
          type: 'string',
          description: 'Descripción opcional del gasto',
        },
      },
      required: ['amount', 'category'],
    },
  },
  {
    name: 'manage_transactions',
    description:
      'Gestiona transacciones existentes del usuario: listar las últimas, editar campos (monto, categoría, descripción, fecha), o eliminar una transacción. Usa hints para identificar la transacción objetivo si no tienes el ID.',
    parameters: {
      type: 'object',
      properties: {
        operation: {
          type: 'string',
          description: 'Operación a realizar: "list", "edit", o "delete"',
        },
        transaction_id: {
          type: 'string',
          description:
            'UUID de la transacción (si se conoce del historial de conversación)',
        },
        hint_amount: {
          type: 'number',
          description: 'Monto aproximado para identificar la transacción',
        },
        hint_category: {
          type: 'string',
          description: 'Categoría para identificar la transacción',
        },
        hint_description: {
          type: 'string',
          description:
            'Descripción parcial para identificar la transacción',
        },
        limit: {
          type: 'number',
          description:
            'Cantidad de transacciones a listar (default 5, max 20)',
        },
        new_amount: {
          type: 'number',
          description: 'Nuevo monto para editar',
        },
        new_category: {
          type: 'string',
          description: 'Nueva categoría para editar',
        },
        new_description: {
          type: 'string',
          description: 'Nueva descripción para editar',
        },
        new_posted_at: {
          type: 'string',
          description: 'Nueva fecha para editar (ISO-8601)',
        },
        choice: {
          type: 'number',
          description:
            'Número 1-based para elegir entre transacciones ambiguas',
        },
      },
      required: ['operation'],
    },
  },
  {
    name: 'ask_balance',
    description: 'Consulta el saldo actual de las cuentas del usuario',
    parameters: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'ask_budget_status',
    description: 'Consulta el estado del presupuesto activo del usuario',
    parameters: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'ask_goal_status',
    description: 'Consulta el progreso de las metas de ahorro del usuario',
    parameters: {
      type: 'object',
      properties: {
        goalId: {
          type: 'string',
          description:
            'UUID de una meta específica (opcional, si no se especifica muestra todas)',
        },
      },
      required: [],
    },
  },
  {
    name: 'greeting',
    description:
      'Responde a un saludo simple del usuario (hola, buenos días, etc)',
    parameters: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'ask_app_info',
    description: `Responde CUALQUIER pregunta sobre TallyFinance, el bot, sus funcionalidades, cómo usarlo, limitaciones, o información general. Usar cuando pregunten sobre la app, pidan ayuda, o tengan curiosidad sobre qué puede hacer el bot.`,
    parameters: {
      type: 'object',
      properties: {
        userQuestion: {
          type: 'string',
          description: 'La pregunta original del usuario tal como la formuló',
        },
        suggestedTopic: {
          type: 'string',
          description:
            'Tema sugerido: capabilities, how_to, limitations, channels, getting_started, about, security, pricing, other',
        },
      },
      required: ['userQuestion'],
    },
  },
];

export function getToolSchemaByName(name: string): ToolSchema | undefined {
  return TOOL_SCHEMAS.find((s) => s.name === name);
}
