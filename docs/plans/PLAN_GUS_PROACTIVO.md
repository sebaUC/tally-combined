# Plan — Gus Proactivo (post-refresh Fintoc + resumen nocturno)

Convertir los refreshes de Fintoc (cada 3h) y ventanas diarias en mensajes
proactivos de Gus que aporten **señal**, no ruido. El objetivo no es
notificar cada movimiento, sino hablar solo cuando vale la pena.

**Principio rector:** con un delay de 3h entre el gasto y el refresh, Gus
ya no puede ser "alerta en tiempo real". Tiene que pasar de *notificación*
a *insight*.

---

## Matriz de comportamiento

Todo se gobierna por `user_prefs.notification_level`
(`none | light | medium | intense`), que ya viene del onboarding.

| Nivel | Resumen nocturno | Alertas de anomalía | Asistente categorización | Detector suscripciones |
|---|---|---|---|---|
| `none` | ❌ | ❌ | ❌ | ❌ |
| `light` | ✅ | ❌ | ❌ | ❌ |
| `medium` | ✅ | ✅ | ❌ | ✅ |
| `intense` | ✅ | ✅ | ✅ | ✅ |

**Ventana de silencio global:** si el user escribió al bot en los últimos
2 min, Gus no interrumpe (defer 5 min para mensajes no urgentes, skip si
es baja severidad).

**Nivel `none`** es un bypass total — no se evalúa nada, no se insertan
filas, no se consume Gemini. Respeta la intención del user al 100%.

---

## Fase 0 — Infraestructura base (habilitador)

Sin esto, ninguna de las 4 features funciona. Es la *spine*.

### Archivos nuevos

```
backend/src/bot/proactive/
├── proactive.module.ts
├── proactive-gus.service.ts       # Orquestador: gate → build → send
├── proactive-sender.service.ts    # Wraps channel adapters + lookup channel_accounts
├── message-builder.service.ts     # Templates con tono/mood + opcional color Gemini
└── contracts.ts                   # ProactiveTrigger type
```

### Cambios en código existente

- `FintocSyncService.syncLink()` — al final, fire-and-forget:
  `proactiveGus.onFintocRefresh(linkId, insertedTxIds)`.
- `BotModule` — importar `ProactiveModule`.

### Flujo de `ProactiveSenderService.sendToUser(userId, BotReply[])`

1. Query `channel_accounts` por `user_id` (prefer `telegram`, fallback `whatsapp`).
2. Chequear **don't disturb**: `bot_message_log` last user→bot message < 2min ago → defer.
3. Chequear **lock de concurrencia**: `lock:{userId}` tomado → defer 5min (Redis
   key `proactive:deferred:{userId}`) o skip si severidad baja.
4. Chequear **rate limit global**: max 5 mensajes proactivos / user / hora
   (key `proactive:rate:{userId}` ZSET).
5. Llamar `telegramAdapter.sendReply(externalId, reply)`.
6. Log a `bot_message_log` con `source='proactive'` + `proactive_trigger=<type>`.

### Schema change (mínimo)

```sql
ALTER TABLE bot_message_log
  ADD COLUMN proactive_trigger text NULL;
-- valores: 'nightly_summary' | 'anomaly' | 'category_assist' | 'subscription'
-- NULL para mensajes user-initiated (retrocompatible)

CREATE INDEX idx_bot_message_log_proactive
  ON bot_message_log(user_id, proactive_trigger, created_at DESC)
  WHERE proactive_trigger IS NOT NULL;
```

### Lock de cron (multi-instance safe)

`SETNX proactive:nightly:{YYYY-MM-DD}` con TTL 3600s. Solo el primer instance
del cluster ejecuta el cron.

### Test (bash integration)

```bash
# backend/scripts/test-proactive-infra.sh
# 1. Setear user en notification_level='light'
# 2. Invocar POST /bot/test-proactive-send (endpoint admin, auth requerido)
# 3. Verificar bot_message_log con source='proactive'
# 4. Verificar que llegue al adapter (usar mock Telegram si está en test mode)
```

### Endpoint auxiliar de debug

```
POST /bot/test-proactive-trigger
  body: { userId: uuid, trigger: 'nightly' | 'anomaly' | 'category' | 'subscription' }
  auth: AdminGuard + MfaRequiredGuard
```

Dispara el flow sin esperar el cron ni el webhook. Solo para testing y soporte.

---

## Fase 1 — Resumen nocturno (idea 1, `light+`)

**Valor único entregable.** Si no seguimos con las otras fases, esta sola
justifica el trabajo. Un toque al día, insight de cierre.

### Scheduler

`@nestjs/schedule` con:

```typescript
@Cron('0 21 * * *', { timeZone: 'America/Santiago' })
```

Futuro: iterar por `user_prefs.timezone` cuando tengamos users en otras TZs.

### Query batch

```sql
-- Un solo query para todos los users activos con actividad hoy
SELECT
  u.id, u.nickname, u.full_name,
  up.notification_level,
  up.timezone,
  ps.tone, ps.mood,
  COALESCE(SUM(t.amount) FILTER (WHERE t.type='expense'), 0) AS spent_today,
  COUNT(t.id) FILTER (WHERE t.type='expense') AS tx_count,
  (SELECT c.name
   FROM categories c
   JOIN transactions t2 ON t2.category_id=c.id
   WHERE t2.user_id=u.id
     AND t2.posted_at::date = CURRENT_DATE
   GROUP BY c.name
   ORDER BY SUM(t2.amount) DESC
   LIMIT 1) AS top_category,
  -- budget status mensual (si existe)
  (SELECT jsonb_build_object(
      'amount', se.amount,
      'spent', COALESCE(SUM(t3.amount), 0),
      'pct', COALESCE(SUM(t3.amount), 0) / NULLIF(se.amount, 0) * 100
    )
   FROM spending_expectations se
   LEFT JOIN transactions t3 ON t3.user_id=u.id
     AND t3.type='expense'
     AND date_trunc('month', t3.posted_at) = date_trunc('month', CURRENT_DATE)
   WHERE se.user_id=u.id AND se.period='monthly' AND se.active=true
   GROUP BY se.amount
   LIMIT 1) AS monthly_budget
FROM users u
JOIN user_prefs up ON up.id = u.id
LEFT JOIN personality_snapshot ps ON ps.user_id = u.id
LEFT JOIN transactions t
  ON t.user_id = u.id
  AND t.posted_at::date = CURRENT_DATE
WHERE up.notification_level IN ('light', 'medium', 'intense')
  AND u.onboarding_completed = true
GROUP BY u.id, up.notification_level, up.timezone, ps.tone, ps.mood
HAVING COUNT(t.id) > 0;
```

### Template (deterministic, tone-aware)

**Neutral / friendly:**
> "📊 Cierre del día, {nombre}. Gastaste ${spent_today} en {tx_count}
> transacciones — la mayor parte en {top_category}. Vas {pct}% del
> presupuesto del mes con {days_left} días por delante. {tone_comment}"

**Strict:**
> "Resumen: ${spent_today}, {tx_count} mov, top {top_category}.
> Budget mensual: {pct}% en {day}/{days_in_month}. {status}."

**Motivational:**
> "Un día más registrado, {nombre}. ${spent_today} invertidos, {top_category}
> lidera. Budget: {pct}% — {comment}. Mañana sigue."

### Color opcional con Gemini

1 línea final de ≤ 15 palabras en el tono del user. Llamada directa a
Gemini con system prompt mínimo ("genera 1 comentario de cierre en tono X").
Si falla → saltar la línea color, no bloquea el mensaje.

Costo estimado: 600 users × 1 llamada/día × 50 tokens = 30k tokens/día.
Despreciable.

### Test

```bash
# backend/scripts/test-nightly-summary.sh
# 1. Seed user con notification_level='light' + 3 tx hoy
# 2. POST /bot/test-proactive-trigger { userId, trigger:'nightly' }
# 3. Verificar mensaje en bot_message_log
# 4. Inspeccionar contenido (spent_today, top_category correcto)
```

---

## Fase 2 — Alertas de anomalía (idea 2, `medium+`)

**Disparo:** `FintocSyncService.syncLink()` → pasa `insertedTxIds` a
`AnomalyDetectorService.evaluate(userId, txs)`.

### Archivo nuevo

```
backend/src/bot/proactive/detectors/
└── anomaly-detector.service.ts
```

### 4 reglas independientes

| Regla | Lógica | Umbral |
|---|---|---|
| `outlier_amount` | `tx.amount > max(2 × avg_cat_30d, 2 × stddev)` | dinámico por categoría |
| `budget_breach` | Cruzó 50% / 80% / 100% del budget de categoría en este refresh | `{0.5, 0.8, 1.0}` |
| `duplicate_charge` | 2 tx con mismo `(amount, merchant_name)` en ≤ 60min, ambos `source='bank_api'` | 60min |
| `new_recurring` | Merchant nuevo + monto típico de suscripción (mensual, < $30k) | heurística |

### Selección y priorización

- Max **1 mensaje por refresh** (combina o elige el más severo):
  `duplicate > budget_breach(100) > budget_breach(80) > outlier > budget_breach(50) > new_recurring`
- **Dedup:** no repetir anomalía del mismo tx dos veces.
  Key: `anomaly:sent:{userId}:{txId}:{rule}` TTL 7d.

### Ejemplos de mensaje (tono `friendly`)

- `outlier_amount`:
  > "Ojo con ese cargo de $85.000 en Restaurantes — te sale casi 3× tu
  > promedio del mes. ¿Fue algo especial o lo marcamos distinto?"

- `budget_breach` (80%):
  > "Cruzaste el 80% del budget de Transporte este mes. Quedan $12k y 9 días.
  > ¿Ajustamos o dejamos así?"

- `duplicate_charge`:
  > "Vi 2 cargos iguales en Starbucks ($4.990 cada uno) con 14 min de
  > diferencia. Si fue un solo café, revisá tu estado de cuenta."

### Test

```bash
# backend/scripts/test-anomaly-detection.sh
# Por cada regla:
# 1. Seed user con historial base
# 2. Insertar tx que dispare esa regla
# 3. Llamar evaluate() directamente (o vía webhook mock)
# 4. Verificar el mensaje + key de dedup
```

---

## Fase 3 — Asistente de categorización (idea 3, solo `intense`)

**Disparo:** post-sync, filtrar los `insertedTxIds` donde
`category_id IS NULL AND auto_categorized = false`.

### Archivo nuevo

```
backend/src/bot/proactive/
└── category-assist.service.ts
```

### Lógica

- 0 tx sin categorizar → silent.
- 1-3 → mensaje con lista + top-2 sugerencias por merchant.
- 4+ → mensaje con los 3 más caros + "y N más en tu dashboard".

### Sugerencias por merchant

1. Match histórico: tx del user con mismo `merchant_name` en el pasado →
   tomar categoría más frecuente (top 2).
2. Fallback keyword: usar el `synonym map` existente en
   `register-expense.fn.ts`.
3. Fallback genérico: "Otro".

### Formato con botones inline

```
"Llegaron 3 movimientos que no supe categorizar:

1. $12.500 — PAGO PAC ENEL
   Sugiero: [Servicios] [Otro]
2. $3.990 — UBER EATS
   Sugiero: [Comida] [Delivery]
3. $25.000 — TRANSF JUAN PEREZ
   Sugiero: [ingresá manualmente]

Tocá cuál corresponde o escribime 'todos Comida'."
```

### Callback handler

```typescript
// callback-handler.service.ts — nuevo pattern
'catassist:{txId}:{categoryId}'
```

Cuando el user toca un botón:
1. `UPDATE transactions SET category_id = ? WHERE id = ?`
2. Editar mensaje original confirmando.
3. Invalidar cache de contexto del user.

### Integración con Gemini (flow existente)

Si el user responde en texto (ej. "todos Comida" o "el 2 es Delivery"),
el mensaje entra por el flow normal de Gus — Gemini usa `edit_transaction`
con los IDs que vienen en el contexto conversacional. **No requiere código
AI-side nuevo**, pero el mensaje proactivo debe quedar en la conversation
history (`conv:v3:{userId}`) para que Gemini tenga contexto.

### Test

```bash
# backend/scripts/test-category-assist.sh
# 1. Insertar 3 tx sin categoría
# 2. Disparar trigger
# 3. Verificar mensaje con botones
# 4. Simular click callback → verificar UPDATE
# 5. Simular respuesta texto → verificar que Gemini reciba contexto
```

---

## Fase 4 — Detector de suscripciones (idea 4, `medium+`)

**Disparo:** por cada tx insertada vía bank_api, query sincrono.

### Query de detección

```sql
-- ¿Hay tx previa con mismo merchant + monto similar hace 25-35 días?
SELECT id, posted_at, amount
FROM transactions
WHERE user_id = :userId
  AND merchant_name = :merchant
  AND ABS(amount - :amount) / :amount < 0.05  -- 5% tolerance
  AND posted_at BETWEEN NOW() - INTERVAL '35 days' AND NOW() - INTERVAL '25 days'
  AND type = 'expense'
ORDER BY posted_at DESC
LIMIT 1;
```

### Tabla nueva (separada, no mezclar con `transactions`)

```sql
CREATE TABLE recurring_charge_candidates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  merchant_name text NOT NULL,
  amount numeric NOT NULL,
  currency text NOT NULL,
  occurrences int DEFAULT 2,
  first_seen timestamptz NOT NULL,
  last_seen timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'detected',
  -- detected | confirmed | dismissed
  confirmed_as_fixed_expense boolean DEFAULT false,
  confirmed_at timestamptz NULL,
  dismissed_at timestamptz NULL,
  UNIQUE(user_id, merchant_name, amount)
);

ALTER TABLE recurring_charge_candidates ENABLE ROW LEVEL SECURITY;

CREATE POLICY user_owns_candidates ON recurring_charge_candidates
  FOR ALL USING (user_id = auth.uid());
```

### Mensaje

```
"Detecté un patrón: 2 cargos de $8.990 en Netflix en meses consecutivos.
¿Lo agregás como gasto fijo?

[Sí, es suscripción] [No, ignorar]"
```

### Callbacks

- `subcatch:confirm:{candidateId}` → crea entry en `spending_expectations`
  como `period='monthly', active=true`, marca candidate `confirmed`.
- `subcatch:dismiss:{candidateId}` → marca `dismissed`, no vuelve a
  preguntar por este (merchant, amount).

### Dedup

Si `UNIQUE(user_id, merchant_name, amount)` ya existe en estado
`dismissed` → no crear ni mensajear de nuevo.

### Test

```bash
# backend/scripts/test-subscription-detector.sh
# 1. Seed tx hace 30 días con Netflix $8990
# 2. Insertar tx nueva con mismo Netflix $8990
# 3. Verificar candidate creado + mensaje enviado
# 4. Simular confirm → verificar spending_expectation creado
```

---

## Fase 5 — Frontend: UI de configuración

### Ubicación

`frontend_TallyFinance/src/pages/dashboard/SettingsView.jsx`

Agregar sección **"Notificaciones de Gus"** entre Ajustes y MFA.

### UI

Radio buttons (4 niveles) + tabla de explicación:

```
○ Silencio
   Gus nunca te escribe salvo que vos le hables primero.

○ Ligero (default)
   Un resumen al día a las 21:00.

● Medio
   Resumen nocturno + alertas si detecto algo raro en tus gastos.

○ Intenso
   Todo lo anterior + te ayudo a categorizar movimientos nuevos.
```

### Botón "Probar"

Dispara `POST /bot/test-proactive-trigger` contra el propio user
(endpoint público con JWT, solo permite dispararse a sí mismo — no
requiere admin como el de debug).

### Backend endpoint usuario

```typescript
@Post('self-test-proactive')
@UseGuards(JwtGuard)
async selfTestProactive(
  @User() user: AuthUser,
  @Body() dto: { trigger: 'nightly' | 'anomaly' | 'category' | 'subscription' },
) {
  // Rate limit: 1 self-test / 5min / user
  // Dispara con data mock del user
}
```

---

## Orden de ejecución recomendado

| Semana | Fase | Entregable |
|---|---|---|
| 1 | **Fase 0** | Infra: sender, lock, silence window, logging. Validado manualmente. |
| 1 | **Fase 1** | Nightly summary en prod. Feature completa end-to-end. |
| 2 | **Fase 2** | Anomaly detector con 4 reglas. Disparado por webhook real. |
| 2 | **Fase 4** | Subscription detector (reusa infra de Fase 2). |
| 3 | **Fase 3** | Category assist (más complejo por botones + estado). |
| 3 | **Fase 5** | Frontend settings. |

**Fase 1 sola ya entrega valor.** Si el CEO/testers prueban y les gusta,
seguimos. Si no, pivot sin haber invertido en las 3 restantes.

---

## Riesgos y mitigaciones

| Riesgo | Mitigación |
|---|---|
| Spam por bug → 100 mensajes al user | Rate limit global: max 5 proactivos / user / hora |
| Cron corre N veces en multi-instance | Redis `SETNX proactive:nightly:{YYYY-MM-DD}` TTL 1h |
| Gus rompe personaje en templates | `buildWithPersonality()` ajusta según tone/mood. QA manual con 5 tonos × 3 tipos. |
| User molesto → churn | Nivel `none` bypasa todo. Link "apagar esto" en cada mensaje. Setting visible. |
| Timezone wrong → 4am msg | `user_prefs.timezone` en cron, fallback `America/Santiago` |
| Costo Gemini si 600 users × 30 días | Templates deterministic por default. Gemini solo línea color opcional (≈15 tokens). Despreciable. |
| Nightly summary rompe si Fintoc down | Summary usa solo DB local. Independiente de Fintoc. |
| Anomaly detector genera falsos positivos | Dedup por (txId, rule) 7d. Umbrales dinámicos por categoría. Iterar con métricas. |
| Category assist interrumpe conversación | Silence window 2min + lock check. Si user está activo → defer. |
| Suscripción detectada cuando no lo es | Botón "No, ignorar" persiste dismissal. Tolerance 5% del monto. |

---

## Métricas a instrumentar

Todas en `bot_message_log` + queries derivadas:

| Métrica | Objetivo |
|---|---|
| `proactive_sent_count` por tipo × nivel | Baseline de volumen |
| `proactive_reply_rate` = % msgs con respuesta user en ≤ 10min | Señal de engagement; < 10% → revisar |
| `notification_level_downgrade_events` | Gente bajando nivel; si sube tras lanzar → feature molesta |
| `category_assist_completion_rate` | % de assists donde el user clasificó ≥ 1 |
| `subscription_confirm_rate` | % de detecciones confirmadas como fijos |
| `nightly_open_to_action_rate` | % de nightly summaries seguidos de una acción del user en < 1h |

**Criterio de éxito:** al menos 2 de estas métricas positivas a 30 días:
- `reply_rate ≥ 15%` en proactive messages
- `downgrade_events` no aumenta respecto al baseline
- `category_assist_completion_rate ≥ 40%`

---

## Arquitectura resultante

```
┌─────────────────────────────────────────────────────────────┐
│                    FINTOC WEBHOOK                           │
│         POST /webhooks/fintoc (HMAC validado)               │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼
┌──────────────────────────────────────────────────────────────┐
│               FintocSyncService.syncLink()                    │
│     - persistMovements() → transactions (upsert)              │
│     - touchAccountSynced()                                    │
│     - touchLinkWebhook()                                      │
│     - [NUEVO] proactiveGus.onFintocRefresh(linkId, txIds)     │
└──────────────────────┬───────────────────────────────────────┘
                       │ fire-and-forget
                       ▼
┌──────────────────────────────────────────────────────────────┐
│                  ProactiveGusService                          │
│   1. Load user + notification_level                           │
│   2. Level gating                                             │
│   3. Dispatch a detectores aplicables                         │
│      ├── AnomalyDetector  (medium+)                           │
│      ├── SubscriptionDetector (medium+)                       │
│      └── CategoryAssist (intense only)                        │
│   4. Merge resultados → 0 o 1 mensaje combinado               │
└──────────────────────┬───────────────────────────────────────┘
                       │
                       ▼
┌──────────────────────────────────────────────────────────────┐
│              ProactiveSenderService.sendToUser()              │
│   1. channel_accounts lookup                                  │
│   2. Silence window check (< 2min)                            │
│   3. Lock check (lock:{userId})                               │
│   4. Rate limit (5/hora/user)                                 │
│   5. MessageBuilder → BotReply con tono                       │
│   6. adapter.sendReply()                                      │
│   7. Log bot_message_log (proactive_trigger=...)              │
└──────────────────────────────────────────────────────────────┘

     ═══════════════════════════════════════════════════════

┌──────────────────────────────────────────────────────────────┐
│            CRON @nestjs/schedule (21:00 CLT)                  │
│              NightlySummaryScheduler                          │
│   1. Redis SETNX proactive:nightly:{date} (multi-instance)   │
│   2. Query batch de users con actividad                       │
│   3. Para cada user → build template + color Gemini opcional  │
│   4. ProactiveSenderService.sendToUser()                      │
└──────────────────────────────────────────────────────────────┘
```

---

## Decisiones abiertas para revisar antes de arrancar

1. **Línea color con Gemini sí/no en MVP**: más personalidad vs más simple
   y predecible. Recomendación: *no* en MVP, sumar en iteración 2.
2. **Ventana de silencio 2 min**: ¿muy corto? ¿muy largo? Empezar con 2,
   medir, ajustar.
3. **Rate limit 5/hora**: defensivo. Probablemente nunca se llegue.
   Dejarlo.
4. **Horario nocturno 21:00**: ¿es el mejor horario para el target? Test
   con CEO + 2 users antes de lanzar.
5. **Default del onboarding**: ¿`light` o `medium`? Hoy es `medium` según
   el DTO. Considerar bajarlo a `light` para default más conservador.

---

## Criterio de done para cada fase

- **Fase 0**: Mensaje proactivo de prueba llega al Telegram del admin,
  queda en `bot_message_log`, respeta silence window, se loggea
  `proactive_trigger`.
- **Fase 1**: 7 noches consecutivas de summaries a 3+ users reales sin
  errores; métrica `reply_rate` capturada.
- **Fase 2**: Cada una de las 4 reglas dispara mensaje esperado en
  integration test. Dedup funciona.
- **Fase 3**: Botones funcionan, respuesta texto entra por Gemini con
  contexto, categorización persiste.
- **Fase 4**: Suscripción detectada se convierte en `spending_expectation`
  al confirmar. Dismissal persiste.
- **Fase 5**: Settings UI deployado. Self-test funciona. CEO onboarded
  al feature.

---

## Relación con otros planes

- `PLAN_INCOME_REMINDERS.md` — flow similar (proactivo); compartir infra
  de Fase 0 si ya existe o está en progreso.
- `PLAN_ACTION_PIPELINE.md` — confirmar compatibilidad si introduce
  action-blocks reutilizables.
- `PLAN_MERCHANT_RESOLVER.md` — usar `merchant_name` normalizado para
  suscripciones y categorización.

---

## Log de cambios

- `2026-04-21` — Documento inicial (Sebastián + Claude).
