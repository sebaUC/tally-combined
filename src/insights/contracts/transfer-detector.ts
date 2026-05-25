import { SupabaseClient } from '@supabase/supabase-js';
import { TransactionRow } from './transaction-row';

/**
 * Stub del detector de transferencias internas.
 *
 * Mientras no exista el provider bancario nuevo y el PLAN_ACCOUNT_TRANSFERS,
 * todas las txs manuales se consideran no-transferencias.
 *
 * Cuando se implemente, esta función comparará la nueva tx contra las txs
 * recientes del user para detectar pares (mismo monto, ventana de minutos,
 * cuentas distintas del mismo user) y marcar ambas con `is_internal_transfer`.
 *
 * El engine de insights ya filtra `is_internal_transfer = false` en todas
 * sus queries, por lo que activar este detector no requiere cambios en el
 * engine — solo poblar la columna correctamente.
 */
export async function isInternalTransfer(
  _supabase: SupabaseClient,
  _userId: string,
  _tx: TransactionRow,
): Promise<{ isTransfer: boolean; pairedId: string | null }> {
  return { isTransfer: false, pairedId: null };
}
