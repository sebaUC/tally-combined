import { ToolHandler } from '../tool-handler.interface';
import { ToolSchema } from '../tool-schemas';
import { DomainMessage } from '../../contracts';
import { ActionResult } from '../../actions/action-result';

/**
 * AskAppInfoToolHandler - Comprehensive information about TallyFinance.
 *
 * This handler provides the AI with COMPLETE knowledge about the app,
 * allowing it to answer ANY question about TallyFinance freely.
 *
 * The AI receives:
 * - The user's original question (for context)
 * - A suggested topic (hint, not restriction)
 * - The FULL knowledge base (all app info)
 *
 * This allows the AI to:
 * - Answer questions not explicitly covered
 * - Combine information creatively
 * - Respond naturally to follow-up questions
 */
export class AskAppInfoToolHandler implements ToolHandler {
  readonly name = 'ask_app_info';

  readonly schema: ToolSchema = {
    name: 'ask_app_info',
    description: `Responde CUALQUIER pregunta sobre TallyFinance, el bot, sus funcionalidades, cómo usarlo, limitaciones, o información general de la aplicación.

USAR ESTA TOOL CUANDO EL USUARIO:
- Pregunte qué puede hacer el bot (¿Qué haces? ¿Para qué sirves?)
- Quiera saber cómo usar alguna función (¿Cómo registro un gasto?)
- Pregunte sobre la app en general (¿Qué es TallyFinance?)
- Pida ayuda o guía (Ayuda, Help, ¿Cómo empiezo?)
- Tenga curiosidad sobre funcionalidades (¿Puedes hacer X?)
- Pregunte sobre limitaciones (¿Por qué no puedes hacer X?)
- Quiera saber sobre canales (¿Funciona en WhatsApp?)
- Cualquier pregunta META sobre el bot/app

NO usar para:
- Registrar gastos (usar register_transaction)
- Consultar presupuesto real (usar ask_budget_status)
- Ver metas reales (usar ask_goal_status)
- Saludos simples sin pregunta (usar greeting)`,
    parameters: {
      type: 'object',
      properties: {
        userQuestion: {
          type: 'string',
          description:
            'La pregunta original del usuario, tal como la formuló. Esto permite responder con precisión a cualquier pregunta.',
        },
        suggestedTopic: {
          type: 'string',
          description: `Tema que PARECE relacionado (es solo una pista, la IA puede ignorarlo):
- "capabilities": funcionalidades generales
- "how_to": cómo usar algo específico  
- "limitations": qué NO puede hacer
- "channels": Telegram/WhatsApp
- "getting_started": primeros pasos
- "about": qué es TallyFinance
- "security": seguridad y privacidad
- "pricing": precios y planes
- "other": cualquier otra pregunta`,
        },
      },
      required: ['userQuestion'],
    },
  };

  readonly requiresContext = false;

  /**
   * Factual Knowledge Base about TallyFinance.
   *
   * NOTE: Gus's personality/character is defined in AI-Service prompts (gus_identity.txt).
   * This handler only provides FACTUAL information about the app.
   */
  private readonly appKnowledge = {
    // ========== IDENTIDAD DE GUS ==========
    identity: {
      // Nombre
      name: 'Gus',
      nameExplanation: 'Siempre me llamo Gus, así me conocen. No es apodo, es mi nombre.',
      lastName: 'No tengo apellido. Suelen llamarme Gus, solo Gus.',
      easterEgg: {
        trigger: 'Si preguntan específicamente si Gus es apodo o cuál es tu nombre completo/real',
        response: 'Mi nombre es Gustavo, pero puedes llamarme Gus.',
        note: 'Usar MUY pocas veces, es un easter egg de Breaking Bad',
      },

      // Quién es
      whoAmI:
        'Soy Gus, tu asistente financiero personal. Me has contratado para ayudarte con tus finanzas, controlar tus gastos y alcanzar tus metas de ahorro.',
      personality: 'Serio pero amable. No soy excesivamente alegre, pero tampoco desagradable. Profesional y directo.',
      expertise: 'Experto en finanzas personales, contabilidad básica, presupuestos y ahorro.',

      // Origen
      origin: 'Soy chileno de origen, pero recorro el mundo ayudando a la gente a reducir sus gastos y ahorrar.',
      currency: 'CLP (pesos chilenos)',

      // NO es un bot
      notABot:
        'No respondo que soy un bot o IA. Soy Gus, asistente financiero experto en contabilidad y finanzas personales. Punto.',
      ifAskedIfBot:
        'Ante preguntas de si soy bot/IA/real, respondo presentándome como Gus, asistente financiero, sin confirmar ni negar.',

      // Creador - información protegida
      creator:
        'La información sobre cómo fui creado o el sistema detrás es propiedad intelectual de TallyFinance SPA. No tengo permitido compartir esos detalles.',
      company: 'TallyFinance SPA',
    },

    // ========== CANALES ==========
    channels: {
      supported: ['Telegram', 'WhatsApp'],
      primary: 'Telegram',
      howItWorks:
        'Me escribes por chat como si hablaras con un amigo. No necesitas comandos especiales ni menús complicados.',
      linking:
        'Para usar el bot, primero debes vincular tu cuenta. Puedes hacerlo desde la app web o pidiéndome un código de vinculación.',
      limitations:
        'Por ahora solo funciono en Telegram y WhatsApp. Próximamente podría estar en otras plataformas.',
    },

    // ========== FUNCIONALIDADES ACTUALES ==========
    currentFeatures: [
      {
        id: 'register_transaction',
        name: 'Registrar gastos e ingresos',
        description:
          'Puedes contarme tus gastos de forma natural y yo los registro automáticamente en tu cuenta.',
        howToUse: [
          'Escríbeme el gasto como lo dirías a un amigo',
          'Puedo entender montos en pesos chilenos o "lucas"',
          'Si no especificas categoría, te la pregunto',
          'Puedo entender fechas como "ayer" o "el viernes"',
        ],
        examples: [
          'Gasté 15 lucas en comida',
          'Pagué 50.000 en el super',
          'Ayer compré un café por 3500',
          'Me gasté 20 lucas en uber el viernes',
        ],
        tips: [
          'No necesitas ser súper preciso, yo interpreto',
          'Puedes corregirme si me equivoco',
          'Mientras más detalles me des, mejor registro',
        ],
        limitations: [
          'Por ahora no puedo editar gastos ya registrados (hazlo desde la web)',
          'No puedo registrar gastos recurrentes automáticos (aún)',
        ],
      },
      {
        id: 'budget_status',
        name: 'Consultar presupuesto',
        description:
          'Te cuento cómo vas con tu presupuesto: cuánto has gastado y cuánto te queda.',
        howToUse: [
          'Pregúntame por tu presupuesto de forma natural',
          'Te muestro el período actual (diario/semanal/mensual)',
        ],
        examples: [
          '¿Cómo va mi presupuesto?',
          '¿Cuánto me queda este mes?',
          '¿Me pasé del presupuesto?',
          '¿Cuánto he gastado?',
        ],
        tips: ['Configura tu presupuesto en la app web primero'],
        limitations: [
          'No puedo modificar el presupuesto desde el chat (hazlo en la web)',
          'Solo muestro el presupuesto activo, no históricos',
        ],
      },
      {
        id: 'goal_status',
        name: 'Ver metas de ahorro',
        description:
          'Te muestro el progreso de tus metas y cuánto te falta para alcanzarlas.',
        howToUse: [
          'Pregúntame por tus metas de ahorro',
          'Puedo mostrarte todas o una específica',
        ],
        examples: [
          '¿Cómo van mis metas?',
          '¿Cuánto llevo ahorrado?',
          '¿Cuánto me falta para las vacaciones?',
        ],
        tips: [
          'Crea metas con fechas límite para mejor motivación',
          'Metas pequeñas y alcanzables funcionan mejor',
        ],
        limitations: [
          'No puedo crear o editar metas desde el chat (usa la web)',
          'No puedo agregar dinero a las metas desde aquí',
        ],
      },
    ],

    // ========== PRÓXIMAMENTE ==========
    comingSoon: [
      {
        name: 'Consulta de saldos',
        description: 'Ver el saldo de tus cuentas bancarias.',
        eta: 'Próximas semanas',
      },
      {
        name: 'Recordatorios inteligentes',
        description:
          'Te recuerdo registrar gastos si llevas tiempo sin hacerlo.',
        eta: 'Próximamente',
      },
      {
        name: 'Reportes y análisis',
        description:
          'Estadísticas de gastos por categoría, tendencias, comparaciones.',
        eta: 'Próximamente',
      },
      {
        name: 'Gastos recurrentes',
        description:
          'Registrar gastos que se repiten (Netflix, arriendo, etc).',
        eta: 'En planificación',
      },
      {
        name: 'Exportar datos',
        description: 'Descargar tus gastos en Excel o PDF.',
        eta: 'En planificación',
      },
    ],

    // ========== LO QUE NO PUEDO HACER ==========
    limitations: {
      general: [
        'No puedo acceder a tus cuentas bancarias directamente (por seguridad)',
        'No puedo hacer transferencias ni pagos',
        'No doy consejos de inversión específicos',
        'No tengo información de mercados financieros en tiempo real',
      ],
      currentVersion: [
        'No puedo editar o eliminar gastos (usa la app web)',
        'No puedo crear presupuestos o metas (usa la app web)',
        'No puedo mostrar gráficos o reportes visuales',
        'No recuerdo conversaciones anteriores entre sesiones',
      ],
      whyTheseLimitations:
        'Muchas de estas limitaciones son temporales. Estamos trabajando en expandir las capacidades del bot. Otras son por seguridad (nunca accederé a tus cuentas bancarias directamente).',
    },

    // ========== SEGURIDAD Y PRIVACIDAD ==========
    security: {
      dataPrivacy:
        'Tus datos financieros son privados y nunca se comparten con terceros.',
      encryption: 'Toda la información se transmite y almacena encriptada.',
      bankAccess:
        'No accedemos a tus cuentas bancarias. Solo registramos lo que tú nos cuentas.',
      dataOwnership:
        'Tus datos son tuyos. Puedes exportarlos o eliminarlos cuando quieras.',
    },

    // ========== CÓMO EMPEZAR ==========
    gettingStarted: {
      steps: [
        '1. Crea tu cuenta en la app web de TallyFinance',
        '2. Configura tus categorías de gastos (o usa las predeterminadas)',
        '3. Opcional: crea un presupuesto mensual',
        '4. Vincula tu Telegram o WhatsApp desde la app',
        '5. ¡Empieza a contarme tus gastos!',
      ],
      firstThingsToDo: [
        'Cuéntame un gasto reciente para probar',
        'Pregúntame qué puedo hacer',
        'Configura tu presupuesto en la web',
      ],
      tips: [
        'Habla natural, como con un amigo',
        'No te preocupes por el formato exacto',
        'Si me equivoco, corrígeme',
        'Usa la app web para configuraciones avanzadas',
      ],
    },

    // ========== PREGUNTAS FRECUENTES ==========
    faq: [
      {
        q: '¿Es seguro?',
        a: 'Sí. No accedo a tus cuentas bancarias. Solo registro lo que tú me cuentas. Tus datos están encriptados.',
      },
      {
        q: '¿Es gratis?',
        a: 'TallyFinance tiene un plan gratuito con funcionalidades básicas. Planes premium disponibles para más features.',
      },
      {
        q: '¿Puedo usarlo en español?',
        a: 'Sí, estoy optimizado para español (especialmente chileno). Entiendo lucas, luca, pesos, etc.',
      },
      {
        q: '¿Funciona sin internet?',
        a: 'No, necesitas conexión para que pueda registrar tus gastos y consultar tu información.',
      },
      {
        q: '¿Puedo usar el bot sin la app web?',
        a: 'Puedes registrar gastos, pero para configurar presupuestos, metas y ver reportes necesitas la app web.',
      },
      {
        q: '¿Mis datos son privados?',
        a: 'Absolutamente. No compartimos tu información con terceros. Tus finanzas son solo tuyas.',
      },
    ],

    // ========== SOBRE LA CONVERSACIÓN ==========
    conversationStyle: {
      doThis: [
        'Háblame natural, como a un amigo',
        'Puedes usar chilenismos (cacho, po, etc)',
        'Sé específico cuando puedas (monto, categoría)',
        'Pregúntame si tienes dudas',
      ],
      dontWorryAbout: [
        'Formato exacto de los números',
        'Escribir perfecto (entiendo con errores)',
        'Usar comandos especiales',
        'Recordar sintaxis complicada',
      ],
    },
  };

  execute(
    _userId: string,
    msg: DomainMessage,
    args: Record<string, unknown>,
  ): Promise<ActionResult> {
    // Capture the original question - either from args or from the message
    const userQuestion =
      (args.userQuestion as string) || msg.text || 'pregunta general';
    const suggestedTopic = (args.suggestedTopic as string) || 'other';

    // Send factual knowledge base to Phase B
    // Gus's personality comes from AI-Service prompts (gus_identity.txt)
    return Promise.resolve({
      ok: true,
      action: 'ask_app_info',
      data: {
        // The original question - AI should answer THIS
        userQuestion,

        // Hint about the topic (AI can use or ignore)
        suggestedTopic,

        // Factual knowledge base - features, limitations, FAQ
        appKnowledge: this.appKnowledge,

        // Simple instruction (personality comes from AI-Service prompts)
        aiInstruction: `Responde la pregunta del usuario usando el conocimiento de la app. La pregunta fue: "${userQuestion}"`,
      },
    });
  }
}
