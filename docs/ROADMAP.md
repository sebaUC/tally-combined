# Roadmap TallyFinance

_Actualizado: 2026-03-17_

---

## Bugs / Fixes

### Frontend

| # | Tarea | Componente | Complejidad |
|---|-------|------------|-------------|
| B1 | Ingresos semanales se tratan como mensuales en el cálculo del dashboard — revisar lógica de período en income calculation | `DashboardHome.jsx` | Media |
| B2 | Dashboard: mostrar siempre todas las categorías del usuario, no solo las que tienen gastos | `CategoryScroll.jsx` | Baja |

### Backend

| # | Tarea | Componente | Complejidad |
|---|-------|------------|-------------|
| B3 | Registro de ingresos vía bot no funciona bien | `register-transaction.tool-handler.ts` | Media |

### Bot / IA

| # | Tarea | Componente | Complejidad |
|---|-------|------------|-------------|
| B4 | Bot no procesa múltiples acciones en un mismo mensaje (ej: 2 gastos juntos, o "crea categoría y agrega gasto") — solo ejecuta el primer handler | `bot.service.ts`, `orchestrator.py` | Alta |
| B5 | IA registró gasto duplicado: el usuario pidió crear categoría y registrar gasto. El bot creó la categoría y registró el gasto correctamente, pero colacionó con "¿qué monto agrego?". El usuario respondió el monto de nuevo y se registró duplicado. El bot debe saber que ya ejecutó el registro y no volver a preguntar — mejorar ventana de contexto para que Phase A sepa qué acciones ya se completaron en la sesión | `orchestrator.py`, `conversation.service.ts` | Media-Alta |
| B6 | Al asignar nombre inteligente a categorías, agregar automáticamente un emoji acorde al nombre (ej: Alimentación → 🍽️, Transporte → 🚗) | `phase_a_system.txt`, `register-transaction.tool-handler.ts` | Baja |

---

## Prioridad inmediata

### Full-stack

| # | Tarea | Componente | Complejidad |
|---|-------|------------|-------------|
| I1 | Vista categorías CRUD completo (categorías, subcategorías, presupuestos) | `CategoriesView.jsx`, `categories.service.ts` | Media |
| I2 | Concepto de ahorro — identidad dentro del sistema, ligado a metas | `GoalsView.jsx`, `goals` table, `ask_goal_status` handler | Alta |

### Frontend

| # | Tarea | Componente | Complejidad |
|---|-------|------------|-------------|
| I3 | Vista ingresos onboarding — simplificar texto | `Onboarding.jsx`, `SpendingStep.jsx` | Baja |
| I4 | Flag de ingreso para componente de ahorro esperado | `SpendingSummary.jsx`, `DashboardHome.jsx` | Baja |

### Backend / IA

| # | Tarea | Componente | Complejidad |
|---|-------|------------|-------------|
| I5 | Mood system — personalidad reactiva según comportamiento financiero | `orchestrator.py`, `metrics.service.ts`, `personality_snapshot` table | Alta |
| I6 | Redis tier 2 y tier 3 — contexto de usuario ampliado | `user-context.service.ts`, `redis/keys.ts` | Alta |

---

## Prioridad alta — Bot / IA

| # | Tarea | Componente | Complejidad |
|---|-------|------------|-------------|
| A1 | ask_balance mejorado — toda la data financiera + link dashboard + sesión de al menos 24h sin cerrarse | `ask-balance.tool-handler.ts`, `phase_b_system.txt` | Alta |
| A2 | Nudges y comentarios: reducir frecuencia, no en cada respuesta. Dar espacio a respuestas genéricas ("ya agregué este gasto") y a veces un comentario, no siempre. Nudges configurables y no constantes | `phase_b_system.txt`, `cooldown.service.ts` | Media-Alta |
| A3 | Agregar texto "algo más?" luego de cada interacción con el bot | `phase_b_system.txt` | Baja |
| A4 | Entidad Memorias del usuario + handler: cada instrucción que el usuario le dé al bot queda guardada (ej: "cada vez que te diga lime lo guardas en transporte") | Nuevo handler + tabla `user_memories`, `phase_a_system.txt` | Alta |
| A5 | Multi-intent: capacidad de procesar múltiples solicitudes en un mensaje y encolarlas (ej: "gasté 5 lucas en pan y 10 en uber") — actualmente solo se ejecuta un handler por mensaje | `bot.service.ts`, `orchestrator.py` | Alta |
| A6 | Prohibir modismos, argentinismos y expresiones coloquiales como "hermano". Gus debe hablar siempre en español neutro | `gus_identity.txt`, `phase_b_system.txt` | Baja |
| A7 | Reducir repetición de respuestas: para tonos tóxico/estricto, respuestas siempre diferentes y creativas. Para tono neutral se permite repetir y ser menos creativo | `phase_b_system.txt`, `variability_rules.txt` | Media |

---

## Prioridad alta — Frontend

### Configuración (`SettingsView.jsx`)

| # | Tarea | Componente | Complejidad |
|---|-------|------------|-------------|
| F1 | Todos los botones guardar/cancelar para todas las opciones (solo aparecen cuando hay cambios, al guardar actualiza) | `SettingsView.jsx` | Media |
| F2 | Cambios de perfil y ajustes (tono, notificaciones) refrescan y quedan en configuración. Setear balance y borrar transacciones redirigen al dashboard principal | `SettingsView.jsx` | Baja |
| F3 | Funcionalidad para editar ingresos mensuales desde configuración o dashboard | `SettingsView.jsx`, nuevo endpoint backend | Media |
| F4 | Ajuste de balance: agregar popup de confirmación (igual al de borrar transacciones) que avise "Tus métricas de comportamiento se mantendrán, pero borraremos todas tus transacciones" antes de ejecutar | `SettingsView.jsx` | Baja |

### Dashboard principal (`DashboardHome.jsx`)

| # | Tarea | Componente | Complejidad |
|---|-------|------------|-------------|
| F5 | Vista de balance: agregar ingresos o gastos manualmente desde el dashboard | `LinkedPanel.jsx` o nuevo componente | Media |
| F6 | Loading animation para cada componente del dashboard | `DashboardHome.jsx`, componentes hijos | Baja |

### Gráficos (`ExpenseBarChart.jsx`)

| # | Tarea | Componente | Complejidad |
|---|-------|------------|-------------|
| F7 | Gráfico mensual: si no hay presupuesto mensual, curva siempre azul sin warning rojo. Lo mismo para semanal sin presupuesto diario — barras siempre azules | `ExpenseBarChart.jsx` → `LineChartArea`, `BarPage` | Media |
| F8 | Gráfico mensual: agregar visualización de presupuestos semanales dentro de la vista mensual (líneas o marcas semanales) | `ExpenseBarChart.jsx` → `LineChartArea` | Media |

### Presupuestos (`SpendingSummary.jsx`)

| # | Tarea | Componente | Complejidad |
|---|-------|------------|-------------|
| F9 | Presupuestos proporcionales a la fecha actual: si la semana está a la mitad, el presupuesto semanal mostrado debe ser proporcional (ej: miércoles = 3/7 del semanal). Lo mismo para diario y mensual. El descuento del ahorro esperado debe respetar esto — no descontar la semana completa si solo van 3 días | `SpendingSummary.jsx`, `chartUtils.js` | Media-Alta |
| F10 | Botones de presupuesto (diario/semanal/mensual): tamaño fijo igual siempre, aunque solo haya 1 o 2 activos. Si faltan presupuestos, mostrar botón transparente con "+" para agregar nueva expectativa de gasto | `SpendingSummary.jsx` | Baja |

### General

| # | Tarea | Componente | Complejidad |
|---|-------|------------|-------------|
| F11 | Refresh inteligente: al actualizar página recargar solo componentes, no la página completa | `DashboardLayout.jsx`, hooks de cache | Media |

### Backend (soporte frontend)

| # | Tarea | Componente | Complejidad |
|---|-------|------------|-------------|
| F12 | Transacción de ajuste al setear balance debe llamarse "Actualización Balance" | `user.service.ts` → `adjustBalance()` | Baja |

---

## Backlog

| # | Tarea | Componente | Complejidad |
|---|-------|------------|-------------|
| BL1 | Sistema de rachas | `StreakCard.jsx`, `metrics.service.ts` | Baja-Media |
| BL7 | **Alerta de balance negativo con opciones múltiples:** cuando el balance de una cuenta cae a negativo tras registrar un gasto, Gus dispara una pregunta proactiva: _"Oye, tu balance quedó negativo — ¿qué pasó?"_ con botones en Telegram/WhatsApp. Opciones sugeridas: "No he ingresado ingresos", "Es una deuda / crédito", "Sobregiro de cuenta", "Usé otra tarjeta", "Otro motivo". Según respuesta: registrar ingreso pendiente, marcar cuenta como en modo deuda, ignorar alerta por N días, o abrir slot-fill libre. Requiere: detección post-insert en `register-transaction.tool-handler.ts`, lógica de botones en `action-block.ts`, y posiblemente flag `negative_balance_acknowledged` en `user_prefs` para no repetir la alerta constantemente | `register-transaction.tool-handler.ts`, `action-block.ts`, `bot.service.ts`, `user_prefs` table | Alta |
| BL2 | Gastos recurrentes y suscripciones | Nueva tabla + handler + vista frontend | Alta |
| BL3 | Vista de balance completa | `BalanceView.jsx` | Media |
| BL4 | Salud financiera | `HealthView.jsx`, nuevo servicio backend | Alta |
| BL5 | Embeddings v2 — pre-router híbrido con gemini-embedding-001, complementar con gemini-embedding-2 para multimodal (fotos de boletas, audio). No reemplaza LLM, lo complementa | Nuevo servicio, `orchestrator.py` | Muy Alta |
| BL6 | Evaluar persistencia de imágenes y audio en la ventana de contexto del chat — que el bot recuerde fotos de boletas y audios enviados previamente en la sesión | `conversation.service.ts`, `orchestrator.py` | Alta |
