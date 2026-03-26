# Guía de Implementación: Flujos de Autenticación con Supabase + Next.js

> **Objetivo**: Este documento es una especificación técnica para que Claude implemente los flujos de registro con verificación por OTP, recuperación de contraseña y cambio de contraseña en un proyecto Next.js App Router + Supabase + Tailwind CSS.
>
> **Instrucción para Claude**: Lee este documento completo antes de implementar. Adapta todos los textos, colores y branding al proyecto actual. Pregunta al usuario los valores de branding (color primario, nombre del proyecto, dominio) antes de comenzar.

---

## Arquitectura General

### Stack requerido
- Next.js 14+ (App Router)
- Supabase Auth (`@supabase/ssr`)
- Tailwind CSS
- SMTP custom (Resend o Gmail)

### Flujos implementados
1. **Registro** → email + teléfono + contraseña → código OTP de 6 dígitos al email → verificar → auto-login
2. **Recuperar contraseña** → email → código OTP → nueva contraseña → auto-login
3. **Cambiar contraseña** (desde perfil, logueado) → formulario directo sin OTP

### Principio clave
Los códigos OTP se envían por email usando `{{ .Token }}` en los templates de Supabase. El usuario **nunca sale del sitio** — ingresa el código en la misma página. No se usan magic links ni redirecciones externas.

---

## Paso 1: Configuración en Supabase Dashboard

### 1.1 Activar confirmación de email
**Authentication → Providers → Email:**
- "Confirm email" → **ON**
- "Email OTP Expiration" → 3600 (1 hora)

### 1.2 Configurar SMTP custom
**Project Settings → Auth → SMTP Settings → Enable Custom SMTP → ON**

#### Opción A: Gmail SMTP (recomendado para empezar, gratis, no cae en spam)
| Campo | Valor |
|---|---|
| SMTP Host | `smtp.gmail.com` |
| Port | `587` |
| Username | `tu-email@gmail.com` |
| Password | App Password de Google (myaccount.google.com/apppasswords) |
| Sender email | `tu-email@gmail.com` |
| Sender name | `NombreDelProyecto` |

#### Opción B: Resend (para dominio custom, 3,000 emails/mes gratis)
| Campo | Valor |
|---|---|
| SMTP Host | `smtp.resend.com` |
| Port | `465` |
| Username | `resend` |
| Password | API key de Resend (`re_...`) |
| Sender email | `soporte@tudominio.cl` |
| Sender name | `NombreDelProyecto` |

Para Resend, primero verificar el dominio en resend.com añadiendo registros DNS (DKIM, SPF, DMARC).

### 1.3 Configurar Email Templates
**Authentication → Email Templates**

#### Template: "Confirm signup"
**Subject:** `Tu código de verificación — {{NOMBRE_PROYECTO}}`

```html
<div style="max-width:480px;margin:0 auto;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <div style="background:{{COLOR_PRIMARIO}};padding:24px 32px;text-align:center;">
    <span style="color:#ffffff;font-size:22px;font-weight:900;letter-spacing:0.5px;">{{NOMBRE_PROYECTO}}</span>
  </div>
  <div style="padding:32px;background:#ffffff;border:1px solid #e5e7eb;border-top:none;">
    <h2 style="margin:0 0 8px;font-size:20px;font-weight:800;color:#111827;">Verifica tu email</h2>
    <p style="margin:0 0 24px;font-size:14px;color:#6b7280;line-height:1.6;">
      Ingresa este código para activar tu cuenta:
    </p>
    <div style="background:#f3f4f6;border-radius:8px;padding:20px;text-align:center;margin-bottom:24px;">
      <span style="font-size:32px;font-weight:900;letter-spacing:8px;color:#111827;">{{ .Token }}</span>
    </div>
    <p style="margin:0;font-size:12px;color:#9ca3af;line-height:1.5;">
      Este código expira en 1 hora. Si no creaste esta cuenta, ignora este email.
    </p>
  </div>
  <div style="padding:16px 32px;text-align:center;">
    <p style="margin:0;font-size:11px;color:#9ca3af;">{{NOMBRE_PROYECTO}}</p>
  </div>
</div>
```

#### Template: "Reset Password"
**Subject:** `Tu código de recuperación — {{NOMBRE_PROYECTO}}`

```html
<div style="max-width:480px;margin:0 auto;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <div style="background:{{COLOR_PRIMARIO}};padding:24px 32px;text-align:center;">
    <span style="color:#ffffff;font-size:22px;font-weight:900;letter-spacing:0.5px;">{{NOMBRE_PROYECTO}}</span>
  </div>
  <div style="padding:32px;background:#ffffff;border:1px solid #e5e7eb;border-top:none;">
    <h2 style="margin:0 0 8px;font-size:20px;font-weight:800;color:#111827;">Recupera tu contraseña</h2>
    <p style="margin:0 0 24px;font-size:14px;color:#6b7280;line-height:1.6;">
      Ingresa este código para cambiar tu contraseña:
    </p>
    <div style="background:#f3f4f6;border-radius:8px;padding:20px;text-align:center;margin-bottom:24px;">
      <span style="font-size:32px;font-weight:900;letter-spacing:8px;color:#111827;">{{ .Token }}</span>
    </div>
    <p style="margin:0;font-size:12px;color:#9ca3af;line-height:1.5;">
      Este código expira en 1 hora. Si no solicitaste este cambio, ignora este email.
    </p>
  </div>
  <div style="padding:16px 32px;text-align:center;">
    <p style="margin:0;font-size:11px;color:#9ca3af;">{{NOMBRE_PROYECTO}}</p>
  </div>
</div>
```

> **IMPORTANTE**: Los templates usan `{{ .Token }}` (NO `{{ .ConfirmationURL }}`). Esto hace que Supabase envíe un código numérico en vez de un link.

### 1.4 Configurar Redirect URLs
**Authentication → URL Configuration → Redirect URLs:**
```
http://localhost:3000/**
https://tudominio.cl/**
https://www.tudominio.cl/**
```

---

## Paso 2: Componentes a Crear

### 2.1 Componente OtpInput (`/src/components/OtpInput.tsx`)

Input visual de N dígitos individuales con:
- **Auto-advance**: al escribir un dígito, foco pasa al siguiente
- **Backspace**: vuelve al input anterior
- **Paste**: pegar código completo llena todos los inputs
- **Auto-complete**: `autoComplete="one-time-code"` para sugerencia del OS
- **inputMode="numeric"**: teclado numérico en mobile
- **Shake animation**: al error, los inputs tiemblan y se limpian
- **Visual feedback**: borde azul cuando el input tiene valor
- **onComplete callback**: se dispara automáticamente al llenar todos los dígitos (sin botón)
- **disabled state**: mientras verifica, inputs deshabilitados con spinner

```typescript
interface OtpInputProps {
  length?: number        // default 6
  onComplete: (code: string) => void
  disabled?: boolean
  error?: boolean
}
```

### Animación shake requerida en globals.css:
```css
@keyframes shake {
  0%, 100% { transform: translateX(0); }
  20% { transform: translateX(-8px); }
  40% { transform: translateX(8px); }
  60% { transform: translateX(-4px); }
  80% { transform: translateX(4px); }
}
.animate-shake {
  animation: shake 0.4s ease-in-out;
}
```

---

## Paso 3: Flujo de Registro

### Archivo: `/src/app/auth/registro/page.tsx`

### Pasos del flujo:

```
Step 1: 'form'    → Usuario llena email + teléfono + contraseña
Step 2: 'otp'     → Ingresa código de 6 dígitos (misma página)
Step 3: 'success' → Check verde → redirect automático
```

### Lógica clave:

#### Step 1 → Step 2 (enviar código)
```typescript
const { data, error } = await supabase.auth.signUp({
  email: email.trim().toLowerCase(),
  password,
})

// Si el email ya existe:
if (data.user?.identities?.length === 0) {
  // Mostrar error "Ya existe una cuenta con este email"
  return
}

// Pasar a step 'otp'
setStep('otp')
setResendCooldown(60) // cooldown de reenvío
```

#### Step 2 → Step 3 (verificar OTP)
```typescript
const { error } = await supabase.auth.verifyOtp({
  email: email.trim().toLowerCase(),
  token: code,     // el código de 6 dígitos
  type: 'signup',  // IMPORTANTE: type es 'signup' para confirmación de registro
})

if (error) {
  setOtpError(true) // trigger shake animation
  return
}

// AHORA hay sesión — guardar perfil del usuario
const { data: { user } } = await supabase.auth.getUser()
if (user) {
  await supabase.from('users').upsert({
    id: user.id,
    email: user.email,
    name: `user${Math.floor(Math.random() * 90000) + 10000}`,
    phone: fullPhone,
  }, { onConflict: 'id' })
}

setStep('success')
setTimeout(() => { router.push('/'); router.refresh() }, 1500)
```

> **IMPORTANTE**: El upsert a la tabla `users` DEBE hacerse después de `verifyOtp`, no después de `signUp`. Con "Confirm email" activado, `signUp` no crea sesión, y la RLS requiere `auth.uid()` para el INSERT.

#### Reenviar código
```typescript
const { error } = await supabase.auth.resend({
  type: 'signup',
  email: email.trim().toLowerCase(),
})
setResendCooldown(60)
```

### UX del paso OTP:
- Icono de sobre animado arriba
- "Enviamos un código de 6 dígitos a **email@ejemplo.com**"
- Componente OtpInput centrado
- Spinner "Verificando..." mientras procesa
- "Código incorrecto" en rojo si falla (con shake)
- "¿No recibiste el código?" con countdown "Reenviar en **45s**"
- Cuando el countdown llega a 0: botón "Reenviar código"
- "← Volver al formulario" abajo

---

## Paso 4: Flujo de Recuperar Contraseña

### Archivo: `/src/app/auth/olvide-contrasena/page.tsx`

### Pasos del flujo:

```
Step 1: 'email'    → Usuario ingresa email
Step 2: 'otp'      → Ingresa código de 6 dígitos
Step 3: 'password' → Ingresa nueva contraseña
Step 4: 'success'  → Check verde → redirect automático
```

### Lógica clave:

#### Step 1 → Step 2 (enviar código de recovery)
```typescript
const { error } = await supabase.auth.resetPasswordForEmail(email)
setStep('otp')
setResendCooldown(60)
```

#### Step 2 → Step 3 (verificar OTP de recovery)
```typescript
const { error } = await supabase.auth.verifyOtp({
  email: email.trim().toLowerCase(),
  token: code,
  type: 'recovery',  // IMPORTANTE: type es 'recovery' para reset password
})

if (!error) setStep('password')
```

#### Step 3 → Step 4 (guardar nueva contraseña)
```typescript
// Después de verifyOtp exitoso, ya hay sesión activa
const { error } = await supabase.auth.updateUser({ password: newPassword })

if (!error) {
  setStep('success')
  setTimeout(() => { router.push('/'); router.refresh() }, 1500)
}
```

### Aceptar query params (para ser llamado desde otras páginas):
```typescript
const searchParams = useSearchParams()
const prefilledEmail = searchParams.get('email') || ''
const alreadySent = searchParams.get('sent') === '1'
const [step, setStep] = useState(alreadySent && prefilledEmail ? 'otp' : 'email')
const [email, setEmail] = useState(prefilledEmail)
const [resendCooldown, setResendCooldown] = useState(alreadySent ? 60 : 0)
```

Así desde cualquier otra página puedes redirigir con:
```
/auth/olvide-contrasena?email=user@mail.com&sent=1
```

---

## Paso 5: Cambio de Contraseña desde Perfil

### Archivo: `/src/app/perfil/page.tsx` (sección dentro de la página)

### Lógica: Sin OTP — el usuario ya está autenticado

```typescript
// Componente inline que se expande al hacer click en "Cambiar"
function ChangePasswordSection() {
  const [open, setOpen] = useState(false)
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')

  async function handleSubmit(e) {
    e.preventDefault()
    // Validar contraseña...

    const { error } = await supabase.auth.updateUser({ password })

    if (!error) {
      // Mostrar popup de éxito
      setOpen(false)
    }
  }

  return (
    <div>
      <div> Contraseña — <button onClick={() => setOpen(!open)}>Cambiar</button> </div>
      {open && (
        <form onSubmit={handleSubmit}>
          <input type="password" placeholder="Nueva contraseña" />
          <input type="password" placeholder="Confirmar contraseña" />
          <button type="submit">Actualizar contraseña</button>
        </form>
      )}
    </div>
  )
}
```

---

## Paso 6: Validaciones de Contraseña (consistentes en todos los flujos)

```typescript
const PASSWORD_MIN = 6

function validatePassword(password, confirmPassword) {
  if (!password) return 'Ingresa una contraseña'
  if (password.length < PASSWORD_MIN) return `Mínimo ${PASSWORD_MIN} caracteres`
  if (!/[A-Z]/.test(password)) return 'Debe tener al menos una mayúscula'
  if (!/[0-9]/.test(password)) return 'Debe tener al menos un número'
  if (password !== confirmPassword) return 'Las contraseñas no coinciden'
  return null
}
```

---

## Paso 7: Link "¿Olvidaste tu contraseña?" en Login

En la página de login (`/auth/login`), agregar debajo del campo de contraseña:

```tsx
<Link href="/auth/olvide-contrasena" className="text-xs text-gray-400 hover:text-brand-500">
  ¿Olvidaste tu contraseña?
</Link>
```

---

## Paso 8: Tabla `users` requerida

```sql
CREATE TABLE public.users (
  id uuid PRIMARY KEY REFERENCES auth.users(id),
  email text,
  name text,
  phone text,
  avatar_url text,
  is_admin boolean DEFAULT false,
  must_change_password boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own profile" ON public.users FOR SELECT USING (auth.uid() = id);
CREATE POLICY "Users can insert own profile" ON public.users FOR INSERT WITH CHECK (auth.uid() = id);
CREATE POLICY "Users can update own profile" ON public.users FOR UPDATE USING (auth.uid() = id);
CREATE POLICY "Admins can view all users" ON public.users FOR SELECT USING (is_admin());
CREATE POLICY "Admins can update any user" ON public.users FOR UPDATE USING (is_admin());
```

---

## Paso 9: Middleware

El middleware solo refresca la sesión y protege rutas. NO hace queries a la DB.

```typescript
// src/middleware.ts
export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|api/|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|css|js)$).*)',
  ],
}
```

```typescript
// src/lib/supabase/middleware.ts
// Solo: refreshSession + redirect si ruta protegida y no hay sesión
await supabase.auth.getUser() // refresh
const { data: { session } } = await supabase.auth.getSession()

const protectedPaths = ['/perfil', '/mis-productos']
if (isProtected && !session) {
  redirect('/auth/login?redirect=' + pathname)
}
```

---

## Resumen de tipos OTP por flujo

| Flujo | Método de envío | `type` en `verifyOtp` |
|---|---|---|
| Registro | `signUp()` (automático) | `'signup'` |
| Recuperar contraseña | `resetPasswordForEmail()` | `'recovery'` |
| Reenviar registro | `resend({ type: 'signup' })` | `'signup'` |

---

## Checklist de Implementación

- [ ] Supabase: Activar "Confirm email"
- [ ] Supabase: Configurar SMTP (Gmail o Resend)
- [ ] Supabase: Template "Confirm signup" con `{{ .Token }}`
- [ ] Supabase: Template "Reset Password" con `{{ .Token }}`
- [ ] Supabase: Redirect URLs configuradas
- [ ] Código: Componente `OtpInput`
- [ ] Código: Animación shake en globals.css
- [ ] Código: Página `/auth/registro` con flujo form → OTP → success
- [ ] Código: Página `/auth/olvide-contrasena` con flujo email → OTP → password → success
- [ ] Código: Link "¿Olvidaste tu contraseña?" en login
- [ ] Código: Sección "Cambiar contraseña" en perfil (sin OTP)
- [ ] Código: Upsert a `users` DESPUÉS de `verifyOtp` (no después de `signUp`)
- [ ] DB: Tabla `users` con RLS
- [ ] Middleware: Sin queries a DB, solo refresh + protect
