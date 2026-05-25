# Personality Battery

Batería de pruebas cualitativas para validar la voz y la reactividad del
bot. Itera los 4 tonos sobre un único user de prueba, ejecuta un conjunto
de mensajes representativos contra `/bot/test-v3`, y produce un log
legible que un humano revisa para juzgar:

- Si cada tono se siente distinto a los demás.
- Si la reactividad escala con la magnitud del gasto vs. los percentiles
  del user.
- Si las 9 tools se disparan en los contextos correctos.
- Si los flujos conversacionales (saludos, identidad, redirects) mantienen
  el personaje.

## Pre-requisitos

1. **Backend corriendo en local** (`npm run start:dev` en `backend/`).
2. **`jq` instalado** (`brew install jq`).
3. **User de prueba existente** en Supabase con `onboarding_completed=true`
   y, idealmente, `user_insights.data_maturity='mature'`. Los percentiles
   relativos solo cobran sentido cuando el user tiene historia.
4. **Variables de entorno exportadas**:

```bash
export TEST_USER_ID=<uuid>
export SUPABASE_URL=$(grep SUPABASE_URL backend/.env | cut -d= -f2)
export SUPABASE_SERVICE_ROLE_KEY=$(grep SUPABASE_SERVICE_ROLE_KEY backend/.env | cut -d= -f2)
```

Opcional:

```bash
export BASE_URL=http://localhost:3000   # default si no se exporta
```

## Cómo correr

```bash
# Todos los tonos (neutral, friendly, strict, toxic)
./scripts/personality/run-battery.sh

# Un solo tono
./scripts/personality/run-battery.sh toxic

# Un subset
./scripts/personality/run-battery.sh strict toxic
```

El script:

1. Para cada tono:
   - Hace `PATCH user_prefs.bot_tone` vía PostgREST de Supabase.
   - Hace `reset` de la conversación + invalida el cache del contexto.
2. Para cada caso de `cases.json`:
   - Llama `POST /bot/test-v3` con `verbose: true`.
   - Imprime el bloque insights, las funciones, el reply y los tokens.
3. Escribe el log a stdout **y** a `scripts/personality/out/battery-<ts>.txt`.

## Formato del output (por turn)

```
────────────────────────────────────────────────────────────
  [N/M] case_id  (tone)
  Categoría:  register_expense / magnitud_notable
  Descripción: ...
  Esperado:   register_expense

  > USER:
    compré ropa por 35 mil

  ── INSIGHTS BLOCK ──
    Maturity: mature
    Archetype: ant
    Escala diaria del user: típico $8.500, alto $15.200, atípico $22.000
    Escala por tx: típico $3.500, alto $12.000, atípico $18.500
    ...

  ── INSIGHTS RAW (resumen) ──
    maturity=mature · txs=147 · archetype=ant
    tx_amount: p50=$3500  p90=$12000  p95=$18500

  ── FUNCTIONS CALLED (1) ──
    ▸ register_expense({"amount":35000,"name":"Ropa","category":"Ropa"})
        result.ok=true · data.keys=[id,amount,category,icon,name,...]

  ── REPLY ──
    Anotado. 35 lucas en Ropa — bastante sobre tu p90 (≈ $12.000 por tx).

  ── TOKENS ──
    input=8423  output=47  total=8470
```

## Casos (`cases.json`)

30 casos agrupados por categoría:

| Categoría | Casos | Cubre |
|---|---|---|
| `register_expense` | 7 | trivial / hormiga / estándar / notable / atípico / extremo / edge (sin monto) |
| `register_income` | 3 | sueldo, recurrente, atípico |
| `delete_transaction` | 2 | resolución contextual + por hint |
| `edit_transaction` | 1 | edición de monto |
| `manage_category` | 4 | list / create / rename / delete |
| `query_transactions` | 3 | list / sum / count |
| `get_balance` | 2 | simple + breakdown |
| `set_balance` | 1 | override directo |
| `get_app_info` | 2 | identity + capabilities |
| `conversacional` | 1 | saludo |
| `multi_accion` | 2 | dos gastos / delete + register |
| `edge_case` | 2 | out-of-domain / follow-up vago |

Con 4 tonos: **120 turns** por corrida completa.

## Costo aproximado

Gemini Flash 2.5: ~$0.0002/turn → **~$0.024 por corrida completa**.

## Cómo leer los resultados

El script NO valida automáticamente. El propósito es darle al humano un
log estructurado para juzgar:

1. **Diferenciación de tonos**: leer el mismo `case_id` en los 4 tonos
   uno tras otro. Si `neutral` y `friendly` suenan similar, falta voz.
   Si `strict` y `toxic` suenan similar, falta diferenciación.
2. **Reactividad por magnitud**: comparar `expense_trivial_below_p50` vs
   `expense_atypical` en el mismo tono. El segundo debería ser visiblemente
   más largo y con más contexto.
3. **Anti-alucinación**: chequear que no aparezcan números o proyecciones
   que no estén en el bloque insights.
4. **Anti-duplicación**: el `reply` no debe repetir los datos que ya están
   en las cards (montos, listas, balance).
5. **Uso de tools**: comparar `expects` con la columna `FUNCTIONS CALLED`.
   Las diferencias son referenciales — el LLM puede tomar caminos válidos
   distintos.

## Agregar casos nuevos

Editar `cases.json`. Cada caso debe tener:

- `id` (kebab_case, único)
- `category` (agrupador visual: `register_expense`, `multi_accion`, etc.)
- `subcategory` (más específico, ej. `magnitud_atipica`)
- `description` (qué se está probando)
- `message` (el texto que envía el user)
- `expects` (array de tool names; `["__no_function__"]` si no se espera tool)

No hace falta tocar el script.

## Limpieza del log

```bash
rm -rf scripts/personality/out/
```

Los logs no se commitean (agregar a `.gitignore` si fuera necesario).
