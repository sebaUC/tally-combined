# Fintoc API — Investigacion Completa

> Documento interno — Abril 2026
> Basado en documentacion publica + pruebas de sandbox

---

## 1. Como funciona Fintoc

Fintoc usa **screen scraping** para conectarse a los portales web de los bancos. No tiene conexion directa ni API oficial con los bancos — simula un login y extrae los datos.

### Flujo de conexion

1. Nuestro backend crea un **Link Intent** via API → recibe un `widget_token`
2. El frontend abre el **widget de Fintoc** con ese token + nuestra `public_key`
3. El usuario selecciona su banco e ingresa sus credenciales bancarias dentro del widget
4. El widget retorna un `exchangeToken` en el callback `onSuccess`
5. Nuestro backend intercambia el `exchangeToken` por un `link_token` permanente
6. Con el `link_token` + `secret_key` consultamos cuentas y movimientos

**Importante:** El `link_token` se entrega UNA sola vez y Fintoc no lo guarda. Si lo perdemos, el usuario tiene que reconectar.

### API Keys

- `sk_test_...` / `pk_test_...` → Sandbox
- `sk_live_...` / `pk_live_...` → Produccion
- No se pueden mezclar (sandbox con live da error)

---

## 2. Que datos devuelve

### Cuenta (Account)

| Campo | Tipo | Descripcion |
|-------|------|-------------|
| `id` | string | ID unico (ej: `acc_pjGbKqETYAvKrV5E`) |
| `type` | string | `checking_account`, `savings_account` |
| `name` | string | Nombre de la cuenta ("Cuenta Corriente") |
| `holder_name` | string | Nombre del titular |
| `balance.available` | integer | Saldo disponible (centavos) |
| `balance.current` | integer | Saldo contable (centavos) |
| `currency` | string | CLP, USD |

### Movimiento (Movement)

| Campo | Tipo | Siempre presente | Descripcion |
|-------|------|-------------------|-------------|
| `id` | string | Si | ID unico del movimiento |
| `amount` | integer | Si | Monto en centavos. Positivo = ingreso, negativo = egreso |
| `description` | string | Si | Texto libre del banco (ej: "COMPRA NAC 05/04 LIDER") |
| `type` | string | Si | `"transfer"`, `"check"`, o `"other"` |
| `post_date` | string | Si | Fecha contable (ISO 8601) |
| `transaction_date` | string | Solo transfers | Fecha real de la transaccion (null para otros tipos) |
| `currency` | string | Si | CLP, USD |
| `status` | string | Si | `confirmed`, `processing`, `reversed`, `duplicated` |
| `sender_account` | object | Solo transfers | Nombre + RUT + banco + numero de cuenta del origen |
| `recipient_account` | object | Solo transfers | Nombre + RUT + banco + numero de cuenta del destino |
| `comment` | string | Solo transfers | Comentario de la transferencia |
| `reference_id` | string | A veces | ID de referencia del banco |
| `pending` | boolean | Si | `true` solo para cheques pendientes |

### Tipos de movimiento (hallazgo clave)

Solo existen 3 tipos:

- **`transfer`** — Transferencias TEF, traspasos entre cuentas. Tienen metadata completa: sender, recipient, RUT, banco, comentario.
- **`other`** — Todo lo demas: compras con tarjeta de debito (POS, online), cargos automaticos PAC/PAT, suscripciones, comisiones bancarias, intereses. Solo tienen `description` como texto libre.
- **`check`** — Cheques.

**Las compras con tarjeta de debito SI aparecen**, clasificadas como tipo `"other"`. En el sandbox, el 57% de los movimientos fueron `"other"` y el 43% fueron `"transfer"`.

---

## 3. Cobertura bancaria

### 9 instituciones soportadas (Chile)

| Banco | Historial | Personas | Empresas | Monedas |
|-------|-----------|----------|----------|---------|
| Banco de Chile | 24 meses | Si | Si | CLP, USD |
| Santander | 24 meses | Si | Si | CLP, USD |
| Itau | 24/12 meses | Si | Si | CLP, USD |
| BICE | 12 meses | Si | Si | CLP, USD |
| Scotiabank | 12 meses | Si | Si | CLP |
| BCI | 12/6/3 meses | Si | Si | CLP, USD |
| BancoEstado | 12 meses | Si | Si | CLP |
| Security | 12 meses | No | Si | CLP |
| SII (fiscal) | 12 meses | Si | Si | Facturas |

### Lo que NO cubre

- Tarjetas de credito (excepto Santander Empresas)
- MACH, Tenpo, Banco Falabella, Banco Ripley, Mercado Pago
- Ningun banco fintech/neobanco

---

## 4. Lo que se ve y lo que no

### SI se ve

- Compras con tarjeta de **debito** en POS y online → tipo `"other"` con description
- Cargos automaticos **PAC/PAT** → tipo `"other"`
- Suscripciones que cargan a la cuenta → tipo `"other"`
- Transferencias TEF → tipo `"transfer"` con metadata completa
- Depositos de sueldo → tipo `"transfer"` con datos del empleador
- Pago de tarjeta de credito → aparece como cargo en cuenta corriente
- Saldos en tiempo real (al momento del refresh)

### NO se ve

- **Compras individuales con tarjeta de credito** — la TC es una cuenta separada que Fintoc no conecta. Solo se ve el pago consolidado mensual a la TC.
- **Nombre de comercio estructurado** — no hay campo "merchant". Solo `description` de texto libre que varia por banco.
- **Transacciones de bancos fintech** — MACH, Tenpo, Falabella, Ripley no estan soportados.

### Implicancia para TallyFinance

El target (universitarios) usa primariamente **CuentaRUT/BancoEstado + debito**. Las compras con debito SI aparecen como tipo `"other"`. La limitacion de tarjetas de credito es menos relevante para este segmento.

El trabajo clave es construir un **parser ML del campo `description`** para convertir texto libre del banco en merchant + categoria:

| Input (description del banco) | Output: Merchant | Output: Categoria |
|-------------------------------|------------------|-------------------|
| "COMPRA NAC 05/04 LIDER" | Lider | Supermercado |
| "CARGO AUTOMATICO SPOTIFY" | Spotify | Suscripcion |
| "COMPRA INT UBER EATS" | Uber Eats | Delivery |
| "PAC ENTEL" | Entel | Telefonia |

Referencia: Copilot Money logra 93% de precision con ML per-user en categorizacion automatica.

---

## 5. Endpoints relevantes

### Listar cuentas

```
GET https://api.fintoc.com/v1/accounts?link_token={link_token}
Authorization: {secret_key}
```

### Listar movimientos

```
GET https://api.fintoc.com/v1/accounts/{account_id}/movements?link_token={link_token}
Authorization: {secret_key}
```

Parametros de query:

| Parametro | Tipo | Descripcion |
|-----------|------|-------------|
| `since` | ISO 8601 date | Movimientos desde esta fecha |
| `until` | ISO 8601 date | Movimientos hasta esta fecha |
| `limit` | int (1-300) | Items por pagina (default 30) |
| `starting_after` | string | Cursor de paginacion (ID de movimiento) |
| `ending_before` | string | Cursor de paginacion reversa |

### Crear Refresh Intent (forzar actualizacion)

```
POST https://api.fintoc.com/v1/refresh_intents?link_token={link_token}
Authorization: {secret_key}
```

Respuesta:

```json
{
  "id": "ri_2dXqkOKkS9mOvnaW",
  "object": "refresh_intent",
  "refreshed_object": "link",
  "status": "created",
  "type": "only_last"
}
```

Limitacion: minimo **5 minutos** entre refresh intents del tipo `only_last`, 60 minutos para `historical`.

---

## 6. Webhooks

### Fintoc SI tiene webhooks

Contrario a lo que entendimos en la reunion inicial, Fintoc tiene un sistema completo de webhooks con eventos para multiples recursos.

### Eventos relevantes para TallyFinance

| Evento | Cuando se dispara |
|--------|-------------------|
| `account.refresh_intent.succeeded` | Cuando una cuenta se actualiza con los ultimos movimientos del banco |
| `account.refresh_intent.failed` | Cuando falla la actualizacion (solo plan Refresh On Demand) |
| `account.refresh_intent.rejected` | Cuando falla por credenciales invalidas del link |
| `account.refresh_intent.movements_removed` | Cuando el banco elimina transacciones |
| `account.refresh_intent.movements_modified` | Cuando el banco modifica transacciones |
| `link.credentials_changed` | Cuando el usuario cambia su clave bancaria (hay que reconectar) |

### Otros eventos del sistema (no prioritarios para nosotros)

- `charge.succeeded` / `charge.failed` — Cobros
- `payment_intent.*` — Pagos
- `transfer.outbound.*` / `transfer.inbound.*` — Transferencias salientes/entrantes
- `subscription.*` — Suscripciones de cobro
- `checkout_session.*` — Sesiones de pago
- `payout.*` — Pagos a cuentas
- `refund.*` — Devoluciones

Nota: `link.created` es el unico evento que NO se puede recibir via webhook.

### Implementacion del webhook

- El endpoint recibe un POST con JSON
- Cada evento tiene un `id` unico (para idempotencia) y un `type`
- Hay que responder con 2XX lo mas rapido posible y procesar async
- Si respondes con error, Fintoc reintenta durante varios dias
- Si falla repetidamente, desactiva el endpoint
- Hay que validar la firma del webhook (signature validation)

### Como configurar

1. Crear un endpoint en tu backend que acepte POST
2. Testear con eventos de prueba desde el dashboard
3. Validar la firma del webhook
4. Activar el endpoint desde el dashboard de Fintoc
5. Seleccionar que eventos quieres recibir

---

## 7. Refresh automatico vs on-demand

### Refresh automatico

La documentacion confirma:

> *"Once an account connects to Fintoc, Fintoc will periodically update the account's information. The frequency depends on the customer's plan."*

Fintoc SI hace refresh automatico en background sin que nosotros hagamos nada. Pero:

- **La frecuencia no esta publicada** — depende del plan contratado
- **No esta confirmado si el webhook se dispara en refreshes automaticos** — el nombre del evento (`account.refresh_intent.succeeded`) sugiere que podria estar atado solo a Refresh Intents manuales, pero la documentacion de webhooks menciona que notifica "when an account finishes syncing with the latest available data from the bank" lo cual sugiere que si

### Refresh on-demand (Refresh Intents)

- Se crea manualmente via `POST /v1/refresh_intents`
- Minimo 5 minutos entre refreshes (`only_last`)
- Minimo 60 minutos entre refreshes (`historical`)
- Si el banco pide MFA, hay que abrir el widget de nuevo para que el usuario autentique
- Al completarse, se dispara el webhook `account.refresh_intent.succeeded`
- Solo habilitado para ciertos planes y regiones

### Cuentas en USD

Las cuentas en moneda extranjera se refrescan solo 1 vez al dia (vs CLP que es mas frecuente). Se puede pedir a Fintoc que equiparen la frecuencia.

---

## 8. Preguntas pendientes para Fintoc

Estas preguntas son **criticas** y deben hacerse en el proximo contacto:

### Sobre frecuencia de refresh

1. **¿Cada cuanto se refrescan automaticamente las cuentas en el plan que nos ofrecen?** (cada 30 min? cada hora? cada 6 horas?)
2. **¿El webhook `account.refresh_intent.succeeded` se dispara tambien con los refreshes automaticos, o solo cuando nosotros creamos un Refresh Intent manualmente?**
3. **¿Es posible configurar la frecuencia de refresh automatico? ¿Hay un plan con refresh mas frecuente?**
4. **¿Si hacemos Refresh Intents on-demand cada 5 minutos, eso tiene costo adicional o entra en el plan?**

### Sobre datos

5. **¿Como se ven las descriptions reales de compras con debito?** (el sandbox genera lorem ipsum, necesitamos ver formato real por banco)
6. **¿El formato de `description` es consistente dentro de un mismo banco, o varia?**
7. **¿Hay algun campo adicional en produccion que no aparece en sandbox?**

### Sobre pricing y plan

8. **¿El minimo de 6.5 UF aplica para Movements read-only o es para el stack completo?**
9. **¿Tienen plan especifico para casos de uso PFM/B2C?**
10. **¿Los Refresh Intents on-demand estan incluidos en todos los planes?**

---

## 9. Resultados del sandbox

### Credenciales de prueba usadas

- RUT: `41614850-3` / Password: `jonsnow`
- Secret Key: `sk_test_...`
- Link Token: `link_...`

### Cuenta detectada

```
ID:         acc_pjGbKqETYAvKrV5E
Tipo:       checking_account
Nombre:     Cuenta Corriente
Titular:    Cristian Rodarte Nieves
Moneda:     CLP
Disponible: 42,982,643 CLP
Contable:   42,982,643 CLP
```

### Distribucion de movimientos (50 movimientos)

```
other         ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓  17  (57%)
transfer      ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓░░░░░░░░░  13  (43%)
```

### Ejemplo de movimiento tipo "other" (JSON completo)

```json
{
    "id": "mov_BLg8DDHWV3p908kA",
    "description": "Quos quaerat voluptas aliquam.",
    "amount": 8688181,
    "currency": "CLP",
    "post_date": "2026-04-14T00:00:00Z",
    "transaction_date": null,
    "type": "other",
    "recipient_account": null,
    "sender_account": null,
    "comment": null,
    "reference_id": null,
    "transfer_id": null,
    "document_number": null,
    "pending": false,
    "status": "confirmed",
    "object": "movement"
}
```

### Ejemplo de transferencia (con metadata)

```json
{
    "id": "mov_Xxa86kHMQaBlWeMG",
    "description": "Omnis occaecati tempora soluta.",
    "amount": 5334287,
    "currency": "CLP",
    "post_date": "2026-04-13T00:00:00Z",
    "transaction_date": null,
    "type": "transfer",
    "recipient_account": null,
    "sender_account": {
        "holder_id": "652407749",
        "number": "871422387",
        "institution": {
            "id": "mx_mercado_pago",
            "name": "Mercado Pago",
            "country": "mx"
        },
        "holder_name": "Mariano Chavarria Camarillo"
    },
    "comment": null,
    "reference_id": null,
    "status": "confirmed",
    "object": "movement"
}
```

### Limitacion del sandbox

Las descriptions son texto lorem ipsum generado aleatoriamente. En produccion se verian descriptions reales del banco como "COMPRA NAC 05/04 LIDER" o "CARGO AUTOMATICO NETFLIX". Para validar el formato real de las descriptions necesitamos modo live con cuenta bancaria real.

---

## 10. Resumen de escenarios de uso

### Mejor caso (si Fintoc confirma refresh automatico frecuente + webhook)

```
Usuario compra algo
  → Banco registra la transaccion
  → Fintoc refresca automaticamente (~30 min)
  → Webhook account.refresh_intent.succeeded llega a nuestro backend
  → Backend trae movimientos nuevos via API
  → ML parsea description → merchant + categoria
  → Gus notifica al usuario si es relevante
```

Delay estimado: ~30 minutos. Suficiente para alertas, resumenes, y coaching.

### Caso intermedio (refresh automatico lento, refresh intents on-demand)

```
Usuario abre la app o habla con Gus
  → Backend crea Refresh Intent
  → Fintoc scrapea el banco (~30 seg)
  → Webhook llega con resultado
  → Backend trae movimientos nuevos
  → Responde al usuario con datos actualizados
```

Delay: ~30 segundos desde que el usuario interactua. Refresh intents cada 5 min minimo.

### Peor caso (sin webhook automatico, sin refresh intents)

```
Cron job cada 1-2 horas
  → Backend llama GET /movements con filtro since=ultima_fecha
  → Compara con movimientos ya guardados
  → Procesa los nuevos
```

Delay: 1-2 horas. Polling manual. Funciona pero no es ideal.

---

## 11. Conclusiones

1. **Fintoc sirve para el caso de uso de TallyFinance.** Las compras con debito (57% de movimientos) SI aparecen como tipo "other".

2. **El webhook `account.refresh_intent.succeeded` existe** y deberia permitirnos recibir notificaciones cuando hay datos nuevos. Falta confirmar si se dispara en refreshes automaticos.

3. **La frecuencia de refresh automatico es la incognita mas grande.** Si es cada 30 min, excelente. Si es cada 24 horas, necesitamos Refresh Intents agresivos.

4. **El parser de descriptions es el trabajo tecnico principal.** Convertir texto libre del banco en merchant + categoria con ML.

5. **La limitacion de tarjetas de credito no es critica para el target** (universitarios con CuentaRUT/debito). Se resuelve con Open Banking en julio 2027.

6. **El costo de 6.5 UF minimo mensual es un riesgo** en etapa temprana. Hay que negociar piloto sin minimo o pricing escalonado.
