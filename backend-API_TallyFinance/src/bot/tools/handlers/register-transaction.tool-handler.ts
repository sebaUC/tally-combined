import { SupabaseClient } from '@supabase/supabase-js';
import { ToolHandler } from '../tool-handler.interface';
import { ToolSchema } from '../tool-schemas';
import { DomainMessage } from '../../contracts';
import { ActionResult } from '../../actions/action-result';

/**
 * RegisterTransactionToolHandler - Registers expenses/income.
 *
 * Requires context: true (needs categories, payment methods)
 *
 * Slot-filling:
 * - Asks for amount if missing
 * - Asks for category if missing or not matched
 * - Suggests similar categories if no exact match
 */
export class RegisterTransactionToolHandler implements ToolHandler {
  readonly name = 'register_transaction';

  readonly schema: ToolSchema = {
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
  };

  readonly requiresContext = true;

  constructor(private readonly supabase: SupabaseClient) {}

  async execute(
    userId: string,
    _msg: DomainMessage,
    args: Record<string, unknown>,
  ): Promise<ActionResult> {
    const { amount, category, date, posted_at, description, payment_method_id } = args as {
      amount?: number;
      category?: string;
      date?: string;
      posted_at?: string;
      description?: string;
      payment_method_id?: string;
    };

    // 1. Validate required args (slot-filling with pending state)
    if (amount === undefined || amount === null) {
      return {
        ok: true,
        action: 'register_transaction',
        userMessage: '¿Cuánto fue el gasto exactamente?',
        pending: {
          collectedArgs: {
            ...(category ? { category } : {}),
            ...(description ? { description } : {}),
            ...(posted_at ? { posted_at } : {}),
          },
          missingArgs: ['amount'],
        },
      };
    }

    if (!category) {
      return {
        ok: true,
        action: 'register_transaction',
        userMessage:
          '¿En qué categoría lo registro? (ej: comida, transporte, salud…)',
        pending: {
          collectedArgs: {
            amount,
            ...(description ? { description } : {}),
            ...(posted_at ? { posted_at } : {}),
          },
          missingArgs: ['category'],
        },
      };
    }

    // 2. Normalize date to ISO format for posted_at
    const postedAt = posted_at ?? date ?? new Date().toISOString();

    // 3. Find category_id from DB
    const { data: categories, error: catError } = await this.supabase
      .from('categories')
      .select('id, name')
      .eq('user_id', userId);

    if (catError) {
      console.error(
        '[RegisterTransactionToolHandler] Category query error:',
        catError,
      );
      return {
        ok: false,
        action: 'register_transaction',
        errorCode: 'DB_QUERY_FAILED',
        userMessage:
          'Hubo un problema consultando tus categorías. Intenta de nuevo.',
      };
    }

    if (!categories?.length) {
      return {
        ok: true,
        action: 'register_transaction',
        userMessage:
          'Aún no tienes categorías configuradas. Primero crea algunas desde la app web.',
      };
    }

    // Use intelligent category matching with synonyms
    const matched = this.findBestCategoryMatch(
      String(category),
      categories as Array<{ id: string; name: string }>,
    );

    if (!matched) {
      // No semantic match found - ask user
      const suggestions = categories
        .map((c: { name: string }) => `• ${c.name}`)
        .join('\n');

      return {
        ok: true,
        action: 'register_transaction',
        userMessage: `No encontré la categoría "${category}". Elige una de tus categorías:\n${suggestions}`,
        // IMPORTANT: Save collected amount so we don't lose it on retry
        pending: {
          collectedArgs: {
            amount,
            ...(description ? { description } : {}),
            ...(posted_at ? { posted_at } : {}),
          },
          missingArgs: ['category'],
        },
      };
    }

    // 4. Get payment_method_id - use provided or get user's default
    let finalPaymentMethodId = payment_method_id;
    if (!finalPaymentMethodId) {
      const { data: defaultPaymentMethod, error: pmError } = await this.supabase
        .from('payment_method')
        .select('id')
        .eq('user_id', userId)
        .limit(1)
        .maybeSingle();

      if (pmError) {
        console.error(
          '[RegisterTransactionToolHandler] Payment method query error:',
          pmError,
        );
        return {
          ok: false,
          action: 'register_transaction',
          errorCode: 'DB_QUERY_FAILED',
          userMessage:
            'Hubo un problema consultando tus métodos de pago. Intenta de nuevo.',
        };
      }

      if (!defaultPaymentMethod) {
        return {
          ok: true,
          action: 'register_transaction',
          userMessage:
            'Aún no tienes métodos de pago configurados. Primero configura uno desde la app web.',
        };
      }

      finalPaymentMethodId = defaultPaymentMethod.id;
    }

    // 5. Insert transaction
    const parsedAmount = Number(amount);
    const { data: inserted, error } = await this.supabase
      .from('transactions')
      .insert({
        user_id: userId,
        amount: parsedAmount,
        category_id: matched.id,
        posted_at: postedAt,
        description: description ?? null,
        payment_method_id: finalPaymentMethodId,
        source: 'chat_intent',
        status: 'posted',
      })
      .select('id')
      .single();

    if (error) {
      console.error('[RegisterTransactionToolHandler] Insert error:', error);
      return {
        ok: false,
        action: 'register_transaction',
        errorCode: 'DB_INSERT_FAILED',
      };
    }

    return {
      ok: true,
      action: 'register_transaction',
      data: {
        transaction_id: inserted?.id,
        amount: parsedAmount,
        category: matched.name,
        posted_at: postedAt,
        payment_method_id: finalPaymentMethodId,
      },
    };
  }

  /**
   * Finds the best matching category using:
   * 1. Exact match (case-insensitive)
   * 2. Synonym matching (comida → Alimentación)
   * 3. Partial/substring match
   * 4. Typo tolerance
   */
  private findBestCategoryMatch(
    input: string,
    categories: Array<{ id: string; name: string }>,
  ): { id: string; name: string } | null {
    if (!input || !categories?.length) return null;

    const inputLower = input.toLowerCase().trim();

    // 1. EXACT MATCH (case-insensitive)
    const exactMatch = categories.find(
      (c) => c.name?.toLowerCase() === inputLower,
    );
    if (exactMatch) return exactMatch;

    // 2. SYNONYM MATCHING - Maps common words to standard category names
    const SYNONYMS: Record<string, string[]> = {
      // Food/Eating
      alimentación: [
        'comida', 'comidas', 'alimento', 'alimentos', 'comer', 'almuerzo',
        'cena', 'desayuno', 'restaurante', 'restaurant', 'café', 'cafe',
        'food', 'eating', 'almorzar', 'cenar', 'filete', 'pizza', 'sushi',
        'hamburguesa', 'empanada', 'once', 'merienda', 'snack',
      ],
      comida: [
        'alimentación', 'alimentacion', 'alimento', 'almuerzo', 'cena',
        'desayuno', 'restaurante', 'restaurant',
      ],

      // Transport
      transporte: [
        'uber', 'taxi', 'metro', 'bus', 'micro', 'colectivo', 'bencina',
        'gasolina', 'estacionamiento', 'peaje', 'pasaje', 'viaje',
        'transport', 'movilización', 'movilizacion', 'cabify', 'didi',
        'beat', 'indriver', 'auto', 'carro', 'bici', 'scooter',
      ],
      movilización: ['transporte', 'uber', 'taxi', 'metro', 'bus'],

      // Home
      hogar: [
        'casa', 'arriendo', 'alquiler', 'rent', 'luz', 'agua', 'gas',
        'electricidad', 'internet', 'servicios', 'home', 'household',
        'departamento', 'depto', 'dividendo', 'hipoteca', 'condominio',
      ],
      casa: ['hogar', 'arriendo', 'servicios'],

      // Health
      salud: [
        'médico', 'medico', 'doctor', 'farmacia', 'remedios', 'medicina',
        'hospital', 'clínica', 'clinica', 'dentista', 'health', 'healthcare',
        'isapre', 'fonasa', 'consulta', 'examen', 'exámenes', 'receta',
      ],
      médico: ['salud', 'doctor', 'hospital'],

      // Education
      educación: [
        'educacion', 'colegio', 'universidad', 'curso', 'cursos', 'libro',
        'libros', 'estudio', 'estudios', 'education', 'school', 'u',
        'matrícula', 'matricula', 'arancel', 'mensualidad', 'diplomado',
      ],
      educacion: ['educación', 'colegio', 'universidad', 'curso'],

      // Personal
      personal: [
        'ropa', 'vestuario', 'belleza', 'peluquería', 'peluqueria', 'gym',
        'gimnasio', 'deporte', 'entretenimiento', 'ocio', 'hobby', 'hobbies',
        'pelu', 'corte', 'manicure', 'spa', 'masaje', 'regalos', 'regalo',
      ],

      // Entertainment
      entretenimiento: [
        'cine', 'película', 'pelicula', 'netflix', 'spotify', 'juegos',
        'games', 'ocio', 'diversión', 'diversion', 'entertainment',
        'concierto', 'teatro', 'show', 'fiesta', 'bar', 'discoteque',
      ],
      ocio: ['entretenimiento', 'diversión', 'hobby'],
    };

    // Find synonym match
    for (const cat of categories) {
      const catLower = cat.name?.toLowerCase() ?? '';

      // Check if input is a synonym of this category
      const synonymList = SYNONYMS[catLower];
      if (synonymList?.includes(inputLower)) {
        return cat;
      }

      // Check reverse - if input has synonyms that match this category
      const inputSynonyms = SYNONYMS[inputLower];
      if (inputSynonyms?.some((syn) => syn === catLower)) {
        return cat;
      }
    }

    // 3. PARTIAL/SUBSTRING MATCH (as fallback)
    const partialMatch = categories.find((cat) => {
      const catLower = cat.name?.toLowerCase() ?? '';
      return catLower.includes(inputLower) || inputLower.includes(catLower);
    });
    if (partialMatch) return partialMatch;

    // 4. TYPO TOLERANCE - Check for very similar strings
    const typoMatch = categories.find((cat) =>
      this.isSimilarString(inputLower, cat.name?.toLowerCase() ?? '', 2),
    );
    if (typoMatch) return typoMatch;

    return null;
  }

  /**
   * Simple similarity check - allows up to N character differences.
   */
  private isSimilarString(a: string, b: string, maxDiff: number): boolean {
    if (Math.abs(a.length - b.length) > maxDiff) return false;

    let diff = 0;
    const minLen = Math.min(a.length, b.length);
    for (let i = 0; i < minLen; i++) {
      if (a[i] !== b[i]) diff++;
      if (diff > maxDiff) return false;
    }
    diff += Math.abs(a.length - b.length);
    return diff <= maxDiff;
  }
}
