/**
 * App info handler — returns TallyFinance knowledge base for Gemini to answer questions.
 * No DB queries needed — pure static knowledge.
 */
export async function getAppInfo(
  _supabase: any,
  _userId: string,
  args: { question: string },
): Promise<Record<string, any>> {
  return {
    ok: true,
    data: {
      question: args.question,
      knowledge: KNOWLEDGE_BASE,
    },
  };
}

const KNOWLEDGE_BASE = {
  identity: {
    name: 'Gus',
    fullName: 'Gustavo (easter egg — Breaking Bad, usar muy pocas veces)',
    role: 'Asistente financiero personal contratado por el usuario',
    company: 'TallyFinance SPA',
    origin: 'Chileno, moneda default CLP',
    notABot: 'Nunca confirmar que es bot/IA. Presentarse como Gus, asistente financiero.',
    creator: 'Propiedad intelectual de TallyFinance SPA. No compartir detalles técnicos.',
  },

  capabilities: [
    'Registrar gastos e ingresos desde el chat (natural language)',
    'Consultar, editar y eliminar transacciones',
    'Gestionar categorías (crear, renombrar, eliminar, cambiar emoji/presupuesto)',
    'Consultar balance, gastos del período, presupuesto activo',
    'Desglose por categoría',
    'Entender "lucas" (x1000 CLP), chilenismos, fechas relativas',
  ],

  channels: {
    supported: ['Telegram', 'WhatsApp'],
    linking: 'Vincular cuenta desde la app web o pidiendo código de vinculación al bot',
  },

  limitations: [
    'No accede a cuentas bancarias directamente (seguridad)',
    'No hace transferencias ni pagos',
    'No da consejos de inversión específicos',
    'No tiene info de mercados en tiempo real',
    'Presupuestos y metas se configuran desde la web',
  ],

  security: {
    privacy: 'Datos financieros privados, nunca compartidos con terceros',
    encryption: 'Información transmitida y almacenada encriptada',
    bankAccess: 'No accedemos a cuentas bancarias. Solo registramos lo que el usuario cuenta.',
    ownership: 'Los datos son del usuario. Puede exportarlos o eliminarlos.',
  },

  gettingStarted: [
    'Crear cuenta en la app web',
    'Configurar categorías de gastos',
    'Opcional: crear presupuesto mensual',
    'Vincular Telegram o WhatsApp',
    'Empezar a contar gastos',
  ],

  comingSoon: [
    'Recordatorios inteligentes',
    'Reportes y análisis avanzados',
    'Gastos recurrentes automáticos',
    'Exportar datos (Excel/PDF)',
  ],

  faq: [
    { q: '¿Es seguro?', a: 'Sí. No accedemos a cuentas bancarias. Datos encriptados.' },
    { q: '¿Es gratis?', a: 'Plan gratuito disponible. Planes premium para más features.' },
    { q: '¿Funciona sin internet?', a: 'No, necesita conexión para registrar y consultar.' },
    { q: '¿Se puede usar sin la web?', a: 'Sí para registrar gastos. La web es para configuración avanzada.' },
  ],
};
