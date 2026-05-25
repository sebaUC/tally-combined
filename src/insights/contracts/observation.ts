/**
 * Beats del engine. Cada beat busca un tipo distinto de "historia" en los datos.
 */
export type ObservationBeat =
  | 'magnitude'   // Tx fuera de escala personal
  | 'rhythm'     // Patrones temporales (X días seguidos, viernes caros)
  | 'drift'      // Categorías que cambian de peso
  | 'commitment' // Promesas testeadas (pass/fail)
  | 'progress'   // Comparación temporal (vs mes pasado, vs avg)
  | 'health'     // Estados accionables (sin ingreso, gasto desbordado)
  | 'milestone'; // Hitos del user (primer mes bajo budget)

/**
 * Texto pre-renderizado de la observation en los 4 tonos.
 * Generado por templates + slot-filling (no Gemini).
 */
export interface ObservationText {
  neutral: string;
  friendly: string;
  strict: string;
  toxic: string;
}

/**
 * Hechos que respaldan la observation. Anti-alucinación: el LLM no inventa
 * cifras, lee de `evidence`.
 */
export interface ObservationEvidence {
  metric_refs?: Array<{ field: string; value: string | number }>;
  tx_ids?: string[];
  commitment_id?: string;
  category_id?: string;
  period?: { start: string; end: string };
}

export interface Observation {
  id: string;
  beat: ObservationBeat;
  kind: string;          // 'tx_above_p95', 'consecutive_friday_overspend', etc.
  importance: number;    // 0-100, decae si no se usa
  evidence: ObservationEvidence;
  text: ObservationText;
  detected_at: string;
  expires_at: string | null;
  last_surfaced_at: string | null;
  surfaced_count: number;
}
