# Plan: Recordatorio de Ingresos (Income Reminders)

## Resumen

Sistema de cron interno (@nestjs/schedule) que corre diario a las 8pm Chile (00:00 UTC).
Revisa `income_expectations` de cada usuario, y si hoy es día de pago, envía un mensaje preguntando si recibió el dinero.

---

## Tabla: `income_reminders`

```sql
CREATE TABLE income_reminders (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID NOT NULL REFERENCES users(id),
  income_id         UUID NOT NULL REFERENCES income_expectations(id),
  status            TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'snoozed', 'confirmed', 'skipped')),
  remind_at         DATE NOT NULL,
  confirmed_amount  NUMERIC,
  cycle_date        DATE NOT NULL,
  created_at        TIMESTAMPTZ DEFAULT now(),
  updated_at        TIMESTAMPTZ DEFAULT now()
);

-- Cron lookup: qué recordar hoy
CREATE INDEX idx_income_reminders_remind ON income_reminders (remind_at, status)
  WHERE status IN ('pending', 'snoozed');

-- Un solo reminder por ingreso por ciclo
CREATE UNIQUE INDEX idx_income_reminders_unique_cycle
  ON income_reminders (income_id, cycle_date);
```

---

## Flujo del Cron (diario 8pm Chile)

```
1. Query income_expectations WHERE active = true
2. Para cada ingreso, calcular si hoy es pay_day:
   - monthly: pay_day = "5" → día 5 del mes
   - weekly: pay_day = "lunes" → si hoy es lunes
   - daily: siempre
3. Si es pay_day Y no existe reminder para este ciclo → crear con status=pending
4. Query income_reminders WHERE remind_at = hoy AND status IN ('pending', 'snoozed')
5. Para cada reminder:
   - Buscar canal vinculado del usuario (channel_accounts)
   - Enviar mensaje via adapter: "¿Recibiste tu [name] de $[amount]?"
```

### Matching de pay_day

| pay_day | period | Match |
|---------|--------|-------|
| `"5"` | monthly | Día 5 del mes |
| `"15"` | monthly | Día 15 del mes |
| `"1,15"` | monthly | Día 1 y 15 (quincenal) |
| `"lunes"` | weekly | Cada lunes |
| `null` | any | No genera reminder automático |
| — | daily | Siempre (ignora pay_day) |

---

## Tool Handler: `confirm_income`

### Schema para Phase A

```typescript
{
  name: 'confirm_income',
  description: 'Confirmar o posponer un recordatorio de ingreso',
  parameters: {
    type: 'object',
    properties: {
      response: {
        type: 'string',
        description: 'Respuesta: yes, no, snooze, skip',
      },
      snooze_until: {
        type: 'string',
        description: 'Fecha o expresión de cuándo volver a preguntar (ISO date, "mañana", "en 2 días", "en una semana", "el 14")',
      },
      amount: {
        type: 'number',
        description: 'Monto real si difiere del esperado',
      },
    },
  },
}
```

### Respuestas del usuario al "¿Recibiste tu sueldo?"

| Respuesta | response | Acción |
|-----------|----------|--------|
| "Sí" / "me llegó" / "confirmado" | `yes` | Registra tx `type: 'income'`, actualiza `accounts.current_balance`, marca reminder `confirmed` |
| "Sí pero me llegaron 1.400.000" | `yes` + `amount` | Igual pero con monto custom |
| "No" / "no me ha llegado" | `no` | Gus pregunta: "¿Cuándo te vuelvo a preguntar?" |
| "Mañana" | `snooze` + `snooze_until: tomorrow` | Actualiza `remind_at` = mañana, status = `snoozed` |
| "En 2 días" | `snooze` + `snooze_until: +2d` | `remind_at` = hoy + 2 |
| "En una semana" | `snooze` + `snooze_until: +7d` | `remind_at` = hoy + 7 |
| "El 14" | `snooze` + `snooze_until: 2026-03-14` | `remind_at` = fecha específica |
| "A las 4" / "me llegará a las 16" | `snooze` + `snooze_until: today_16` | `remind_at` = hoy (se vuelve a preguntar hoy a las 16:00, o en el siguiente ciclo del cron si ya pasó) |
| "No me llegó este mes" / "cancelar" | `skip` | Marca reminder `skipped`, no vuelve a preguntar este ciclo |

### Respuesta a hora específica ("no, me llega a las 16")

Para soportar "me llega a las 4pm":
- Guardar `remind_at_time` (TEXT, nullable) en `income_reminders` — hora específica
- El cron principal corre a las 8pm, pero si hay reminders con `remind_at = hoy` y `remind_at_time` que ya pasó → enviar
- Si `remind_at_time` no ha pasado → un segundo cron o check más tarde
- **Alternativa simple**: si el usuario dice "a las 4", Gus responde "Te preguntaré mañana entonces 😊" y hace snooze +1 día (ya que el cron corre a las 8pm y las 4pm ya pasó)

### Flujo de conversación

```
Gus (8pm): "¿Te llegó tu sueldo de $1.500.000? 💰"

→ Usuario: "Sí"
  Gus: "¡Anotado! Ingreso de $1.500.000 registrado."

→ Usuario: "No todavía"
  Gus: "¿Cuándo te vuelvo a preguntar?"

  → Usuario: "Mañana"
    Gus: "Dale, te pregunto mañana."

  → Usuario: "El viernes"
    Gus: "Listo, te pregunto el viernes."

→ Usuario: "No, me llega a las 16"
  Gus: "Te preguntaré mañana entonces 😊"
  (snooze +1 día, ya que el cron de 8pm ya pasó las 16)

→ Usuario: "No me llegó este mes"
  Gus: "Entendido, no te molesto más con este ingreso este mes."
```

---

## Implementación en NestJS (@nestjs/schedule)

### Dependencia

```bash
npm install @nestjs/schedule
```

### CronModule

```typescript
// src/cron/cron.module.ts
@Module({
  imports: [ScheduleModule.forRoot()],
  providers: [IncomeReminderCronService],
})
export class CronModule {}
```

### IncomeReminderCronService

```typescript
// src/cron/income-reminder.cron.ts
@Injectable()
export class IncomeReminderCronService {
  // 8pm Chile = 00:00 UTC+1 día (UTC-4 winter) o 23:00 UTC (UTC-3 summer)
  // Usar 23:00 UTC como aproximación, o configurar timezone
  @Cron('0 23 * * *', { timeZone: 'America/Santiago' })
  // Alternativa exacta: @Cron('0 20 * * *', { timeZone: 'America/Santiago' })
  async handleIncomeReminders() {
    // 1. Generar reminders para pay_days de hoy
    // 2. Enviar mensajes para reminders pendientes de hoy
  }
}
```

### Pasos del cron

```typescript
async handleIncomeReminders() {
  const today = new Date().toISOString().slice(0, 10);
  const dayOfMonth = new Date().getDate().toString();
  const dayOfWeek = ['domingo','lunes','martes','miércoles','jueves','viernes','sábado'][new Date().getDay()];

  // 1. Buscar income_expectations activas cuyo pay_day matchea hoy
  const { data: incomes } = await this.supabase
    .from('income_expectations')
    .select('*, users!inner(id)')
    .eq('active', true);

  for (const income of incomes) {
    if (!this.isPayDay(income.period, income.pay_day, dayOfMonth, dayOfWeek)) continue;

    // 2. Crear reminder si no existe para este ciclo
    await this.supabase
      .from('income_reminders')
      .upsert({
        income_id: income.id,
        user_id: income.user_id,
        status: 'pending',
        remind_at: today,
        cycle_date: today,
      }, { onConflict: 'income_id,cycle_date', ignoreDuplicates: true });
  }

  // 3. Buscar reminders para enviar hoy
  const { data: reminders } = await this.supabase
    .from('income_reminders')
    .select('*, income_expectations(*)')
    .eq('remind_at', today)
    .in('status', ['pending', 'snoozed']);

  // 4. Para cada reminder, enviar mensaje via canal vinculado
  for (const reminder of reminders) {
    const channel = await this.getLinkedChannel(reminder.user_id);
    if (!channel) continue;

    const amount = formatCLP(reminder.income_expectations.amount);
    const name = reminder.income_expectations.name || 'ingreso';
    const message = `¿Te llegó tu ${name} de ${amount}? 💰`;

    await this.sendMessage(channel, message);
  }
}
```

---

## Archivos a crear/modificar

| # | Archivo | Cambio |
|---|---------|--------|
| 1 | SQL (Supabase) | Crear tabla `income_reminders` |
| 2 | `src/cron/cron.module.ts` | Nuevo módulo con ScheduleModule |
| 3 | `src/cron/income-reminder.cron.ts` | Servicio cron con @Cron decorator |
| 4 | `src/bot/tools/handlers/confirm-income.tool-handler.ts` | Nuevo handler |
| 5 | `src/bot/tools/tool-registry.ts` | Registrar confirm_income |
| 6 | `src/bot/tools/tool-schemas.ts` | Schema para AI |
| 7 | `src/bot/services/guardrails.service.ts` | Validación de args |
| 8 | `src/bot/services/orchestrator.client.ts` | Stub para confirm_income |
| 9 | `ai-service/tool_schemas.py` | Schema confirm_income |
| 10 | `ai-service/prompts/phase_a_system.txt` | Detección de confirmación de ingreso |
| 11 | `ai-service/prompts/phase_b_system.txt` | Reglas de respuesta |
| 12 | `ai-service/orchestrator.py` | _summarize_action para confirm_income |
| 13 | `app.module.ts` | Importar CronModule |
| 14 | `package.json` | Agregar @nestjs/schedule |

---

## Consideraciones

- **Timezone**: usar `America/Santiago` en @Cron para manejar DST automáticamente
- **Hora específica**: si el usuario dice "me llega a las 4pm" y ya son las 8pm → snooze a mañana
- **Canal**: necesita al menos un canal vinculado. Si no tiene → skip silencioso
- **Múltiples ingresos**: un usuario puede tener N reminders el mismo día (sueldo + freelance)
- **Idempotencia**: el unique index `(income_id, cycle_date)` previene duplicados
- **No crea costos**: @nestjs/schedule corre dentro del backend existente en Render free tier
