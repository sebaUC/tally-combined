# Fase 5.1 — MFA TOTP setup (backend listo, frontend pendiente)

Estado: **iteración A (backend) completa**. Los endpoints existen y
compilan. Todavía no se puede enrollar desde la web porque la UI
(iteración B) no está escrita.

## Lo que tenés que hacer para que funcione (5 min)

### 1. Activar MFA TOTP en Supabase

Supabase no tiene MFA TOTP habilitado por default en proyectos nuevos.

1. <https://supabase.com/dashboard> → proyecto TallyFinance.
2. **Authentication → Providers → Multi-factor authentication**
3. Toggle **Time-based One-Time Password (TOTP)** → **On**.
4. **Save**.

Sin esto, `POST /auth/mfa/enroll` devuelve `MFA is disabled`.

### 2. Cargar `SUPABASE_ANON_KEY` en Render

El backend necesita una clave adicional para operar como el usuario
(no como `service_role`) cuando el usuario enrolla o verifica MFA.

1. <https://supabase.com/dashboard> → proyecto → **Project Settings → API**.
2. Copiar **anon public** (la larga, empieza con `eyJ...`, NO la service_role).
3. Render → tu servicio backend → **Environment** → **Add Environment Variable**:
   - Key: `SUPABASE_ANON_KEY`
   - Value: la anon key

Sin esta variable, el backend **no arranca** — el factory lanza error
explícito al boot. Es fail-fast a propósito.

### 3. (Local dev) agregar al `.env` del backend

```env
SUPABASE_ANON_KEY=eyJhbGciOi...   # anon public, NO la service_role
```

## Endpoints expuestos (`/auth/mfa/*`)

Todos requieren `JwtGuard` (Bearer token o cookie `access_token`).

| Método | Path | Body | Qué hace |
|---|---|---|---|
| POST | `/auth/mfa/enroll` | `{ friendlyName? }` | Crea factor TOTP, devuelve `{ factorId, qrCode, secret, uri }`. El factor queda pendiente hasta `verify-enroll`. |
| POST | `/auth/mfa/verify-enroll` | `{ factorId, code }` | Verifica primer código, activa el factor. Rota cookies a una sesión con `aal: aal2`. |
| POST | `/auth/mfa/challenge` | `{ factorId }` | Inicia step-up. Devuelve `{ challengeId, expiresAt }`. |
| POST | `/auth/mfa/verify` | `{ factorId, challengeId, code }` | Completa step-up. Rota cookies a `aal2`. |
| POST | `/auth/mfa/unenroll` | `{ factorId }` | Remueve un factor. **Requiere que la sesión actual sea `aal2`** (evita que un atacante con solo password deshabilite MFA). |
| GET | `/auth/mfa/factors` | — | Lista factores del usuario. |
| GET | `/auth/mfa/aal` | — | `{ currentLevel, nextLevel, currentAuthenticationMethods }`. |

## Flujo de enrollment (que la UI tendrá que implementar)

```
1. user (ya logueado, aal1) clicks "Activar MFA" en settings
2. POST /auth/mfa/enroll          → { factorId, qrCode, secret }
3. UI renderiza QR (data URI) o secret para que el user agregue a su app
4. user ingresa primer código
5. POST /auth/mfa/verify-enroll   → rota cookies, sesión ahora es aal2
6. UI confirma "MFA activada" y muestra factor en lista
```

## Flujo de step-up (cuando aplicamos MfaRequiredGuard)

```
1. user intenta acción sensible (p.ej. admin) — backend responde 403
   con { error: "AAL2_REQUIRED", message: ... }
2. UI detecta el error, abre modal MFA
3. POST /auth/mfa/challenge { factorId }    → { challengeId }
4. user ingresa código
5. POST /auth/mfa/verify { factorId, challengeId, code } → cookies rotadas
6. UI reintenta la acción original
```

## Cómo aplicar `MfaRequiredGuard` a un endpoint

Cuando querás exigir MFA en una ruta, agregá el guard después de JwtGuard:

```typescript
import { MfaRequiredGuard } from '../auth/middleware/mfa.guard';
import { JwtGuard } from '../auth/middleware/jwt.guard';

@Controller('admin')
@UseGuards(JwtGuard, MfaRequiredGuard) // orden importa
export class AdminController { ... }
```

O a un método específico:

```typescript
@Post('critical-action')
@UseGuards(MfaRequiredGuard)
async criticalAction() { ... }
```

**No lo aplicamos todavía a `/admin/*` ni a Fintoc** — primero tenés que:
1. Activar MFA en Supabase (paso 1 de arriba).
2. Enrollarte vos y el CEO (requiere UI — iteración B).
3. Recién entonces agregar el guard, sino se bloquean las rutas.

## Estructura de archivos (nuevos)

```
backend/src/
├── supabase/
│   └── supabase-user-client.service.ts    # factory de client con JWT del user
├── auth/
│   ├── mfa.controller.ts                  # 7 endpoints /auth/mfa/*
│   ├── decorators/
│   │   └── auth-token.decorator.ts        # @AuthToken() param
│   ├── middleware/
│   │   └── mfa.guard.ts                   # MfaRequiredGuard (aal2)
│   └── services/
│       └── mfa.service.ts                 # wraps supabase.auth.mfa.*
```

## Pendientes (iteración B, backlog)

- **Frontend**: página de enrollment, modal de challenge, manejo del error
  `AAL2_REQUIRED` en `apiClient.js`.
- **Onboarding**: paso opcional "Activar MFA" tras completar el resto.
- **Settings**: opción "Seguridad → MFA" con enable/disable y lista de
  factores (para remover uno específico).
- **Recovery codes**: Supabase no los genera automáticamente para TOTP.
  Hay que decidir si los implementamos (p.ej. generar 8 códigos de un
  solo uso y guardarlos hasheados) o si el flow de recovery es via
  admin bypass (ver `auth.service.admin.updateUserById`).

## Pendientes (iteración C, enforcement)

- Aplicar `MfaRequiredGuard` a `/admin/*` (cuando ambos admins tengan MFA).
- Aplicar `MfaRequiredGuard` a endpoints sensibles de Fintoc (link,
  unlink, withdraw) cuando pasemos a live.

## Escape hatch — emergencia en producción

Si el enforcement bloquea a alguien y no tenemos tiempo de resolverlo
por el canal normal, en Render:

1. Environment → agregar `DISABLE_MFA_ENFORCEMENT=true`.
2. Redeploy (30 s).
3. `MfaRequiredGuard` pasa a todos sin chequear aal. Loggea warning en
   cada request — visible al revisar logs para confirmar que sigue on.
4. Cuando esté resuelto: quitar el env var + redeploy.

**No dejar el flag prendido más allá de lo estrictamente necesario** —
mata la protección que activamos.

## Lockout recovery (user perdió su authenticator)

El `unenroll` de Supabase requiere que la sesión actual sea `aal2`. Si
el user perdió su dispositivo, no puede completar el challenge, por lo
tanto no puede quitar el factor. Hay dos caminos:

### Opción A — vía SQL directo (preferido)

Supabase dashboard → SQL Editor, corriendo como `service_role`:

```sql
-- Encontrar el user:
SELECT id, email FROM auth.users WHERE email = 'user@example.com';

-- Borrar sus factores MFA:
DELETE FROM auth.mfa_factors WHERE user_id = '<uuid>';
```

El user en su próximo login vuelve a `aal1`. Puede volver a enrolar desde
`/app/configuracion → Seguridad`.

### Opción B — escape hatch temporal

Sirve si no tenés acceso al SQL editor en ese momento:

1. Setear `DISABLE_MFA_ENFORCEMENT=true` en Render.
2. El user entra a admin / Fintoc / lo que sea.
3. Va a Seguridad → Desactivar. Ahora el guard MFA del `unenroll` también
   está bypasseado, así que funciona.
4. Quitar `DISABLE_MFA_ENFORCEMENT` de Render + redeploy.

Preferimos A porque B deja una ventana donde nadie tiene MFA.

## Troubleshooting

- **`MFA is disabled`**: olvidaste activar TOTP en Supabase Dashboard.
- **`SUPABASE_ANON_KEY env var is required`** al boot: olvidaste la env var.
- **403 `AAL2_REQUIRED` en admin pero el modal no aparece**: revisar que
  `MfaChallengeProvider` esté montado en `App.jsx` (envuelve `BrowserRouter`).
- **Segundo factor verifica OK pero siguiente request sigue en aal1**:
  la cookie no se guardó. Chequear `SameSite=Lax` + que el frontend
  haga la llamada con `credentials: 'include'`.
- **`getAuthenticatorAssuranceLevel` devuelve `aal1` en frontend pero
  `aal2` en backend**: cache stale. Re-fetchear `/auth/me` o `/auth/mfa/aal`
  después del `verify-enroll`.
- **Modal MFA aparece pero la lista de factores está vacía**: el user no
  tiene MFA enrollada. Redirigir a settings para activarla.
