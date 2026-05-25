# Plan — Account Transfers (skeleton, no implementation yet)

> **Estado:** Esbozo. El problema está identificado y la arquitectura
> preparada (columnas + stub detector en transacciones, filtros en
> `user_insights`). Este doc queda como backlog para cuando lo tomemos.

Distinguir transferencias entre cuentas propias del user de gastos/ingresos
reales. Hoy se contabilizan como ambos simultáneamente, contaminando todas
las métricas.

---

## Problema

Cuando un user transfiere $100.000 de su Cuenta Corriente a su Cuenta de
Ahorro, Fintoc devuelve dos movimientos:

- Cuenta Corriente: `amount: -100000` → guardado como `type='expense'`
- Cuenta de Ahorro: `amount: +100000` → guardado como `type='income'`

Consecuencias actuales:

1. `totalSpent` del período infla por $100k falsos
2. `totalIncome` idem
3. `top_categories` puede mostrar "Transferencias" como categoría top
4. `largest_expense` captura transferencias a cuentas propias
5. `recurring_charge_candidates` detecta pagos de tarjeta como suscripciones
6. `avg_monthly_spend` completamente distorsionado
7. Budgets fallan al tocar techo por movimientos que no son gasto real

Único que queda bien: `totalBalance` (neto es cero).

Casos concretos en Chile:

- **Transferencia entre bancos propios del mismo RUT**: BCI → Santander,
  Banco Estado → Scotia, etc. Muy común.
- **Pago de tarjeta de crédito del mismo banco**: BCI CC → BCI Credit
  Card. Se ve como gasto en cc + ingreso en credit (pago de deuda).
- **Transferencia a cuenta de ahorro programada**: automatizaciones de
  ahorro mensual del user.
- **Cashback de tarjeta de crédito**: ingreso real pero fácil confundir.

---

## Detección

Heurística pura, sin ML (al menos en V1):

### Regla 1 — Match exacto por monto + ventana temporal

```sql
SELECT a.id AS debit_tx_id, b.id AS credit_tx_id
FROM transactions a
JOIN transactions b
  ON a.user_id = b.user_id
  AND a.account_id != b.account_id
  AND ABS(a.amount - b.amount) < 1       -- mismo monto exacto
  AND a.type = 'expense' AND b.type = 'income'
  AND b.posted_at BETWEEN a.posted_at AND a.posted_at + INTERVAL '48 hours'
WHERE a.is_internal_transfer = false
  AND b.is_internal_transfer = false
  AND a.posted_at > NOW() - INTERVAL '60 days';
```

Si dos cuentas del mismo user tienen mov. opuestos con mismo monto en ≤ 48h
→ candidato fuerte. Confirmar como transfer, marcar ambas con
`is_internal_transfer=true` y `paired_transaction_id=<otro id>`.

### Regla 2 — Metadata de Fintoc

Los movimientos de Fintoc a veces traen `sender_account` / `recipient_account`
con campos como `holder_id` (RUT). Si coincide con el RUT del user (guardado
en `users.rut` — por implementar) → transfer directo sin buscar match.

Shape observado:
```json
{
  "type": "transfer",
  "sender_account": { "holder_id": "12345678-9", "holder_name": "JOSE AREVALO" },
  "recipient_account": { "holder_id": "12345678-9", "holder_name": "JOSE AREVALO" }
}
```

Misma `holder_id` en sender y recipient → internal transfer.

### Regla 3 — Pagos de tarjeta de crédito

Patrón específico: un debit en cuenta corriente con descripción que incluye
"PAGO TARJETA" / "ABONO PAC TC" + un credit en la cuenta de crédito por el
mismo monto en el mismo día.

Requiere que el user tenga ambos productos linkeados (cc + credit card) y
el resolver de merchants identifique el patrón "PAGO PAC TC" como internal.

### Regla 4 — Declaración manual del user

Endpoint/botón: "esto fue una transferencia entre mis cuentas". Permite al
user corregir cuando el detector falla. Actualiza ambos tx + alimenta al
model para futuros.

---

## Schema (ya preparado en `PLAN_USER_INSIGHTS.md`)

Ya quedan agregadas estas columnas cuando se ejecute USER_INSIGHTS:

```sql
ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS is_internal_transfer boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS paired_transaction_id uuid NULL
    REFERENCES transactions(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_transactions_transfer
  ON transactions(user_id, is_internal_transfer)
  WHERE is_internal_transfer = true;
```

Nuevas para cuando se implemente este plan:

```sql
-- Opcional: log de detecciones para auditar y mejorar heurística
CREATE TABLE transfer_detection_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  debit_tx_id uuid NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
  credit_tx_id uuid NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
  rule_matched text NOT NULL,   -- 'amount_match'|'holder_id_match'|'cc_payment'|'manual'
  confidence numeric(3,2),
  auto_applied boolean NOT NULL DEFAULT true,
  overridden_by_user boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
```

---

## Integración con flujos existentes

### `FintocSyncService.persistMovements()`

Actualizar para llamar al detector inline:

```typescript
// pseudocode
for (const m of movements) {
  const row = movementToInsertRow(account, m);
  const transferCheck = await transferDetector.detect(supabase, userId, row);
  if (transferCheck.isTransfer) {
    row.is_internal_transfer = true;
    row.paired_transaction_id = transferCheck.pairedId;
    // actualizar también la tx ya existente en DB para marcarla
    await supabase
      .from('transactions')
      .update({ is_internal_transfer: true, paired_transaction_id: row.external_id })
      .eq('id', transferCheck.pairedId);
  }
  rows.push(row);
}
```

### `register-expense.fn.ts` / `register-income.fn.ts`

Idem — correr detector antes de registrar una tx manual. Si el user dice
"transferí 100k a mi ahorro", Gemini ya debería usar `register_transfer`
(nueva function) en vez de `register_expense`. O el detector lo atrapa
post-hoc.

### Nueva function para Gemini: `register_transfer`

```typescript
{
  name: 'register_transfer',
  description: 'Registra una transferencia entre dos cuentas del user. ' +
    'No afecta budgets ni gastos/ingresos totales.',
  parameters: {
    amount: number,
    from_account: string,  // nombre de cuenta
    to_account: string,
    posted_at?: string,
  },
}
```

Crea 2 txs con `is_internal_transfer=true` y `paired_transaction_id`
mutuo. Updates de balance en ambas cuentas.

---

## UX considerations

### Recuperación cuando el detector falla (false positive)

User ve una tx marcada como transfer pero era un gasto real. En la UI de
la tx detallada: botón "Esto no fue una transferencia" → reversa flag y
logea a `transfer_detection_log` con `overridden_by_user=true` para
mejorar heurística.

### Recuperación cuando el detector omite (false negative)

User ve dos txs (gasto + ingreso) que sí fueron una transfer. Botón en
cada una: "Emparejar con otra tx" → abre picker de transacciones
compatibles, al seleccionar marca ambas.

### En el chat con Gus

> "Vi que te hiciste una transferencia de $100.000 entre tus cuentas el
> 15 de mayo. ¿Está bien marcarla como movimiento interno (no cuenta
> como gasto)?"

Si user confirma → persistir. Si dice "fue gasto real" → desmarcar.

### En el dashboard

Filtro "Incluir transferencias" (off por default). Cuando está off, los
totales son "reales". Cuando está on, aparecen como tags grises que
indican movimiento neutro.

---

## Fases de implementación

1. **F1 — Detector Regla 1 (amount match)** — 1 día
2. **F2 — Detector Regla 2 (holder_id)** — 0.5 día (requiere poblar
   `users.rut`)
3. **F3 — Detector Regla 3 (CC payment)** — 1 día (requiere MERCHANT_RESOLVER)
4. **F4 — UI corrección manual** — 1 día (tx detail view + emparejar)
5. **F5 — Function Gemini `register_transfer`** — 0.5 día
6. **F6 — Integración insights** — automática (ya filtrada)
7. **F7 — Backfill sobre transacciones históricas existentes** — 0.5 día
   (job one-shot)
8. **F8 — Testing** — 1 día

**Total: ~5-6 días.**

---

## Dependencias

- Requiere `users.rut` column (no existe hoy) para Regla 2. Puede
  implementarse sin ella con degradación silenciosa.
- Beneficia de `PLAN_MERCHANT_RESOLVER.md` para Regla 3 (identificar
  patrones "PAGO PAC TC" canónicamente).
- Desbloquea insights 100% correctos en `PLAN_USER_INSIGHTS.md`.

---

## Riesgos

| Riesgo | Mitigación |
|---|---|
| False positive marca un gasto real como transfer | UI de override + log para aprender |
| User con muchas cuentas + pagos genera matches falsos | Ventana 48h limita. Requiere distinct account_ids |
| Transferencias a terceros con mismo monto (coincidencia) | Regla 2 (holder_id) es desempate. Si Regla 1 matchea sin Regla 2 → confidence media, mostrar al user para confirmar |
| Backfill sobre histórico grande es lento | Batch 1000 txs a la vez, correr en ventana baja |
| Detección inline en syncLink hace el webhook lento | Cap a regla 1 (query single row con índice), <50ms. Reglas complejas async |

---

## Decisiones abiertas

1. **¿Auto-aplicar detecciones o siempre preguntar al user?**
   - Auto (con override): mejor UX, riesgo de errores silenciosos
   - Siempre preguntar: más fricción, más control
   - **Sugerencia:** auto con confidence ≥ 0.9, preguntar con confidence 0.5-0.9, ignorar < 0.5

2. **¿Incluir transferencias en `transactions` o moverlas a tabla aparte?**
   - Mantener en `transactions` con flag: más simple, consistente
   - Tabla `internal_transfers` separada: más limpio, rompe retrocompat
   - **Sugerencia:** mantener en `transactions` con flag.

3. **¿Mostrar transferencias en la UI por default?**
   - Ocultas: menos ruido
   - Visibles (con tag "interno"): más transparencia
   - **Sugerencia:** visibles con tag gris, opción de filtrar.

---

## Log de cambios

- `2026-04-21` — Esbozo inicial. Pending implementation.
