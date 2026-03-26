# Plan: Flujos de Autenticación — OTP + Recuperación de Contraseña

## Contexto

TallyFinance actualmente NO verifica email al registrarse, NO tiene recuperación de contraseña, y NO tiene verificación OTP. Los usuarios pueden registrarse con emails falsos y si pierden la contraseña, pierden la cuenta.

Este plan implementa 3 flujos usando la infraestructura nativa de Supabase Auth (`verifyOtp`, `resetPasswordForEmail`, `resend`) — sin crear tablas ni servicios de OTP propios. Supabase se encarga de generar, enviar y verificar los códigos.

**Stack:** NestJS (backend) + React/Vite (frontend) + Supabase Auth

---

## Flujos a implementar

```
1. REGISTRO → email + contraseña → código OTP al email → verificar → auto-login → onboarding
2. RECUPERAR CONTRASEÑA → email → código OTP → nueva contraseña → auto-login
3. CAMBIAR CONTRASEÑA → (logueado) formulario directo sin OTP
```

**Principio:** Los códigos OTP se envían por email usando `{{ .Token }}` en los templates de Supabase. El usuario nunca sale del sitio — ingresa el código en la misma página.

---

## Paso 1: Configuración Supabase Dashboard

### 1.1 Activar confirmación de email
**Authentication → Providers → Email:**
- "Confirm email" → **ON**
- "Email OTP Expiration" → 3600 (1 hora)

### 1.2 Configurar SMTP custom
**Project Settings → Auth → SMTP Settings → Enable Custom SMTP → ON**

Gmail SMTP (gratis, no cae en spam):
| Campo | Valor |
|---|---|
| SMTP Host | `smtp.gmail.com` |
| Port | `587` |
| Username | Email del proyecto |
| Password | App Password de Google |
| Sender email | Email del proyecto |
| Sender name | `TallyFinance` |

### 1.3 Email Templates
**Authentication → Email Templates**

**"Confirm signup"** — Subject: `Tu código de verificación — TallyFinance`
```html
<div style="max-width:480px;margin:0 auto;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <div style="background:#0364c6;padding:24px 32px;text-align:center;">
    <span style="color:#fff;font-size:22px;font-weight:900;">TallyFinance</span>
  </div>
  <div style="padding:32px;background:#fff;border:1px solid #e5e7eb;border-top:none;">
    <h2 style="margin:0 0 8px;font-size:20px;font-weight:800;color:#111827;">Verifica tu email</h2>
    <p style="margin:0 0 24px;font-size:14px;color:#6b7280;">Ingresa este código para activar tu cuenta:</p>
    <div style="background:#f3f4f6;border-radius:8px;padding:20px;text-align:center;margin-bottom:24px;">
      <span style="font-size:32px;font-weight:900;letter-spacing:8px;color:#111827;">{{ .Token }}</span>
    </div>
    <p style="margin:0;font-size:12px;color:#9ca3af;">Este código expira en 1 hora.</p>
  </div>
</div>
```

**"Reset Password"** — Subject: `Tu código de recuperación — TallyFinance`
Mismo template pero título "Recupera tu contraseña" y texto "para cambiar tu contraseña".

**IMPORTANTE:** Usar `{{ .Token }}` (NO `{{ .ConfirmationURL }}`). Esto hace que Supabase envíe código numérico en vez de link.

### 1.4 Redirect URLs
```
http://localhost:5173/**
https://tallyfinance.vercel.app/**
```

---

## Paso 2: Cambios en Backend (NestJS)

### 2.1 Cambio en signup — NO crear sesión inmediata

**Archivo:** `auth.service.ts`

Actualmente `signUp()` crea sesión inmediata porque email confirmation está OFF. Al activar "Confirm email", `signUp()` retorna `data.session = null` y envía el código OTP automáticamente.

**Cambio:**
```typescript
async signUp(dto: SignUpDto) {
  const { data, error } = await this.supabase.auth.signUp({
    email: dto.email.trim().toLowerCase(),
    password: dto.password,
    options: {
      data: { full_name: dto.fullName },
    },
  });

  if (error) throw new BadRequestException(error.message);

  // Con "Confirm email" ON: data.session es null
  // El código OTP ya se envió al email automáticamente
  // Si el email ya existe con identidad verificada:
  if (data.user?.identities?.length === 0) {
    throw new BadRequestException('Ya existe una cuenta con este email');
  }

  // NO crear perfil en public.users todavía — se crea después de verificar OTP
  // NO setear cookies — no hay sesión aún

  return {
    message: 'Código de verificación enviado al email',
    email: dto.email.trim().toLowerCase(),
    requiresVerification: true,
  };
}
```

### 2.2 Nuevo endpoint — verificar OTP de registro

**Archivo:** `auth.controller.ts`

```typescript
@Post('auth/verify-signup')
async verifySignup(@Body() body: { email: string; code: string }, @Res() res) {
  const { data, error } = await this.supabase.auth.verifyOtp({
    email: body.email.trim().toLowerCase(),
    token: body.code,
    type: 'signup',
  });

  if (error) throw new BadRequestException('Código incorrecto o expirado');

  // AHORA hay sesión — crear perfil del usuario
  const user = data.user;
  await this.supabase.from('users').upsert({
    id: user.id,
    email: user.email,
    full_name: user.user_metadata?.full_name,
    package: process.env.DEFAULT_PACKAGE || 'basic',
  }, { onConflict: 'id' });

  // Setear cookies con los tokens
  this.setAuthCookies(res, data.session);

  return res.json({
    user: data.user,
    session: data.session,
    access_token: data.session.access_token,
    refresh_token: data.session.refresh_token,
  });
}
```

### 2.3 Nuevo endpoint — reenviar código OTP

```typescript
@Post('auth/resend-otp')
async resendOtp(@Body() body: { email: string; type: 'signup' | 'recovery' }) {
  const { error } = await this.supabase.auth.resend({
    type: body.type === 'recovery' ? 'email_change' : 'signup',
    email: body.email.trim().toLowerCase(),
  });

  if (error) throw new BadRequestException(error.message);
  return { message: 'Código reenviado' };
}
```

### 2.4 Nuevo endpoint — solicitar recuperación de contraseña

```typescript
@Post('auth/request-password-reset')
async requestPasswordReset(@Body() body: { email: string }) {
  const { error } = await this.supabase.auth.resetPasswordForEmail(
    body.email.trim().toLowerCase(),
  );

  // No revelar si el email existe o no (seguridad)
  return { message: 'Si el email existe, recibirás un código de recuperación' };
}
```

### 2.5 Nuevo endpoint — verificar OTP de recovery + cambiar contraseña

```typescript
@Post('auth/verify-recovery')
async verifyRecovery(@Body() body: { email: string; code: string }, @Res() res) {
  const { data, error } = await this.supabase.auth.verifyOtp({
    email: body.email.trim().toLowerCase(),
    token: body.code,
    type: 'recovery',
  });

  if (error) throw new BadRequestException('Código incorrecto o expirado');

  // Ahora hay sesión activa — el usuario puede cambiar contraseña
  this.setAuthCookies(res, data.session);

  return res.json({
    message: 'Código verificado. Puedes cambiar tu contraseña.',
    session: data.session,
    access_token: data.session.access_token,
  });
}
```

### 2.6 Nuevo endpoint — cambiar contraseña (autenticado)

```typescript
@Post('auth/change-password')
@UseGuards(JwtGuard)
async changePassword(@Body() body: { password: string }, @User() user) {
  if (!body.password || body.password.length < 6) {
    throw new BadRequestException('La contraseña debe tener al menos 6 caracteres');
  }

  const { error } = await this.supabase.auth.admin.updateUserById(user.id, {
    password: body.password,
  });

  if (error) throw new BadRequestException(error.message);
  return { message: 'Contraseña actualizada' };
}
```

### 2.7 DTOs nuevos

**`verify-otp.dto.ts`:**
```typescript
export class VerifyOtpDto {
  @IsEmail()
  email: string;

  @IsString()
  @Length(6, 6)
  code: string;
}
```

**`request-reset.dto.ts`:**
```typescript
export class RequestResetDto {
  @IsEmail()
  email: string;
}
```

**`change-password.dto.ts`:**
```typescript
export class ChangePasswordDto {
  @IsString()
  @MinLength(6)
  password: string;
}
```

---

## Paso 3: Cambios en Frontend (React/Vite)

### 3.1 Componente OtpInput

**Archivo:** `src/components/OtpInput.jsx`

Input visual de 6 dígitos individuales:
- Auto-advance al escribir un dígito
- Backspace vuelve al anterior
- Paste llena todos los inputs
- `inputMode="numeric"` para teclado numérico en mobile
- `autoComplete="one-time-code"` para sugerencia del OS
- Shake animation al error
- onComplete callback al llenar todos los dígitos (sin botón)
- disabled state con spinner mientras verifica

### 3.2 Modificar flujo de registro

**Archivo:** `src/pages/auth/Auth.jsx`

```
Step 1: 'form'    → Email + nombre + contraseña
Step 2: 'otp'     → Código de 6 dígitos (misma página)
Step 3: 'success' → Check verde → redirect a /onboarding
```

**Cambios clave:**
- Después de signup exitoso, pasar a step 'otp' (no redirect inmediato)
- En step 'otp': mostrar OtpInput + "Enviamos código a email@..."
- Al completar OTP: llamar `POST /auth/verify-signup`
- Si ok → guardar tokens → redirect a onboarding
- Timer de reenvío (60s countdown) + botón "Reenviar código"
- Botón "← Volver al formulario"

### 3.3 Nueva página: Recuperar contraseña

**Archivo:** `src/pages/auth/ForgotPassword.jsx`

```
Step 1: 'email'    → Ingresa email
Step 2: 'otp'      → Código de 6 dígitos
Step 3: 'password' → Nueva contraseña + confirmar
Step 4: 'success'  → Check verde → redirect a /app
```

**Flujo:**
1. Email → `POST /auth/request-password-reset`
2. OTP → `POST /auth/verify-recovery` → obtener sesión
3. Password → `POST /auth/change-password` (ya autenticado)
4. Success → redirect

### 3.4 Link en login

Agregar debajo del campo de contraseña en el formulario de login:
```
¿Olvidaste tu contraseña? → navega a /auth/forgot-password
```

### 3.5 Cambiar contraseña desde configuración

**Archivo:** `src/pages/app/Settings.jsx` (sección dentro de configuración)

Formulario expandible:
- Nueva contraseña + confirmar
- Validación frontend (8+ chars, 1 mayúscula, 1 número)
- `POST /auth/change-password`
- Toast de éxito

### 3.6 Nuevos métodos en authApi

```javascript
// apiClient.js
verifySignup: (email, code) => post('/auth/verify-signup', { email, code }),
resendOtp: (email, type) => post('/auth/resend-otp', { email, type }),
requestPasswordReset: (email) => post('/auth/request-password-reset', { email }),
verifyRecovery: (email, code) => post('/auth/verify-recovery', { email, code }),
changePassword: (password) => post('/auth/change-password', { password }),
```

### 3.7 Nueva ruta

```javascript
// Router
{ path: '/auth/forgot-password', element: <ForgotPassword /> }
```

---

## Paso 4: Validaciones de Contraseña (consistentes)

Frontend y backend usan las mismas reglas:
- Mínimo 6 caracteres (backend) / 8 caracteres (frontend muestra más estricto)
- 1 mayúscula
- 1 número
- Confirmar contraseña (solo frontend)

---

## Resumen de endpoints

| Método | Path | Auth | Nuevo? | Propósito |
|--------|------|------|--------|-----------|
| POST | `/auth/signup` | No | Modificado | Registra + envía OTP (no crea sesión) |
| POST | `/auth/verify-signup` | No | **Nuevo** | Verifica OTP de registro → crea sesión + perfil |
| POST | `/auth/resend-otp` | No | **Nuevo** | Reenvía código OTP |
| POST | `/auth/request-password-reset` | No | **Nuevo** | Envía código de recovery al email |
| POST | `/auth/verify-recovery` | No | **Nuevo** | Verifica código recovery → crea sesión |
| POST | `/auth/change-password` | JWT | **Nuevo** | Cambiar contraseña (autenticado) |
| POST | `/auth/signin` | No | Sin cambio | Login normal |
| POST | `/auth/refresh` | Cookie | Sin cambio | Refresh token |

---

## Resumen de archivos

### Backend (modificar/crear)

| Archivo | Cambio |
|---------|--------|
| `auth.service.ts` | Modificar signUp para no crear sesión inmediata |
| `auth.controller.ts` | 4 endpoints nuevos: verify-signup, resend-otp, request-password-reset, verify-recovery, change-password |
| `dto/verify-otp.dto.ts` | **Nuevo** |
| `dto/request-reset.dto.ts` | **Nuevo** |
| `dto/change-password.dto.ts` | **Nuevo** |

### Frontend (modificar/crear)

| Archivo | Cambio |
|---------|--------|
| `components/OtpInput.jsx` | **Nuevo** — componente de input OTP |
| `pages/auth/Auth.jsx` | Agregar step OTP después de registro |
| `pages/auth/ForgotPassword.jsx` | **Nuevo** — flujo recovery completo |
| `lib/apiClient.js` | 5 métodos nuevos en authApi |
| `App.jsx` (router) | Nueva ruta /auth/forgot-password |
| `pages/app/Settings.jsx` | Sección cambiar contraseña |
| `styles/globals.css` | Animación shake para OTP |

### Supabase Dashboard (configuración manual)

| Config | Cambio |
|--------|--------|
| Email provider | Activar "Confirm email" |
| SMTP | Configurar Gmail SMTP |
| Template "Confirm signup" | Template con `{{ .Token }}` |
| Template "Reset Password" | Template con `{{ .Token }}` |
| Redirect URLs | Agregar dominios |

---

## Orden de implementación

1. **Supabase Dashboard** — SMTP + templates + activar confirm email
2. **Backend** — DTOs + endpoints nuevos + modificar signup
3. **Frontend** — OtpInput component + modificar Auth.jsx + ForgotPassword.jsx
4. **Testing** — Probar los 3 flujos end-to-end

---

## Notas importantes

- El upsert a `public.users` se hace DESPUÉS de `verifyOtp`, no después de `signUp`. Con "Confirm email" activo, `signUp` no crea sesión y las RLS requieren `auth.uid()`.
- `supabase.auth.resend()` para reenviar el código de registro usa `type: 'signup'`.
- `supabase.auth.resetPasswordForEmail()` envía el código de recovery automáticamente.
- `supabase.auth.verifyOtp()` con `type: 'recovery'` crea una sesión autenticada — después el usuario puede llamar `updateUser({ password })` o el backend puede usar `admin.updateUserById()`.
- NO se necesitan tablas nuevas — Supabase Auth maneja los códigos OTP internamente.
- NO se necesita servicio de email externo — Supabase Auth envía los emails vía SMTP configurado.
