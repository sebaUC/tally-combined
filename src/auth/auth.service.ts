import {
  Injectable,
  Inject,
  Logger,
  BadRequestException,
  InternalServerErrorException,
  UnauthorizedException,
} from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SignUpDto } from './dto/sign-up.dto';
import { SignInDto } from './dto/sign-in.dto';
import { ProviderLoginDto } from './dto/provider-login.dto';
import * as moment from 'moment-timezone';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(@Inject('SUPABASE') private readonly supabase: SupabaseClient) {}

  // 🟢 Registro de usuario
  async signUp(dto: SignUpDto) {
    // 🔎 Validaciones estrictas
    if (!dto.password || dto.password.length < 6) {
      throw new BadRequestException(
        'La contraseña debe tener al menos 6 caracteres.',
      );
    }

    if (!dto.fullName?.trim()) {
      throw new BadRequestException(
        'El nombre completo es obligatorio para el registro.',
      );
    }
    // 🔎 Validaciones estrictas
    if (!dto.email || !dto.email.includes('@')) {
      throw new BadRequestException('El correo electrónico no es válido.');
    }

    //  Detección automática de locale y timezone
    const detectedLocale =
      dto.locale ||
      Intl.DateTimeFormat().resolvedOptions().locale ||
      process.env.DEFAULT_LOCALE ||
      'es-CL';

    const detectedTimezone =
      dto.timezone ||
      moment.tz.guess() ||
      process.env.DEFAULT_TIMEZONE ||
      'America/Santiago';

    const defaults = {
      package: process.env.DEFAULT_PACKAGE ?? 'basic',
    };

    const fullName = dto.fullName.trim();

    this.logger.log(`[signup] Attempting registration for ${dto.email}`);

    // 🪪 Paso 1: Crear usuario en Supabase Auth
    const { data, error } = await this.supabase.auth.signUp({
      email: dto.email,
      password: dto.password,
      options: {
        data: {
          full_name: fullName,
          locale: detectedLocale,
          timezone: detectedTimezone,
        },
      },
    });

    if (error) {
      this.logger.error(`[signup] Auth error: ${error.message}`);
      throw new BadRequestException(`Auth error: ${error.message}`);
    }

    const user = data?.user;
    if (!user?.id) {
      throw new InternalServerErrorException(
        'No se creó el usuario en auth.users.',
      );
    }

    // Con "Confirm email" activo: data.session es null, OTP se envió automáticamente
    // Con "Confirm email" desactivado: data.session existe, login inmediato
    const sessionPayload = data.session ?? null;

    if (sessionPayload) {
      // Email confirmation OFF — crear perfil inmediatamente
      const now = new Date().toISOString();
      await this.supabase.from('users').upsert(
        {
          id: user.id,
          email: dto.email,
          full_name: fullName,
          package: defaults.package,
          is_active: true,
          created_at: now,
          updated_at: now,
        },
        { onConflict: 'id' },
      );
    }
    // Si no hay session (email confirm ON), el perfil se crea después de verifyOtp

    // Si el email ya existe con identidad verificada
    if (user.identities?.length === 0) {
      throw new BadRequestException('Ya existe una cuenta con este email');
    }

    this.logger.log(
      `[signup] User created: ${user.id} (session=${!!sessionPayload})`,
    );
    return {
      user,
      session: sessionPayload,
      requiresVerification: !sessionPayload,
    };
  }

  // 🔑 Verificar OTP de registro
  async verifySignupOtp(email: string, code: string) {
    const { data, error } = await this.supabase.auth.verifyOtp({
      email: email.trim().toLowerCase(),
      token: code,
      type: 'signup',
    });

    if (error) {
      this.logger.warn(`[verifyOtp] Failed for ${email}: ${error.message}`);
      throw new BadRequestException('Código incorrecto o expirado');
    }

    if (!data.user || !data.session) {
      throw new InternalServerErrorException(
        'Verificación exitosa pero sin sesión',
      );
    }

    // Crear perfil en public.users AHORA (después de verificar)
    const now = new Date().toISOString();
    const fullName = data.user.user_metadata?.full_name ?? '';
    await this.supabase.from('users').upsert(
      {
        id: data.user.id,
        email: data.user.email,
        full_name: fullName,
        package: process.env.DEFAULT_PACKAGE ?? 'basic',
        is_active: true,
        created_at: now,
        updated_at: now,
      },
      { onConflict: 'id' },
    );

    this.logger.log(`[verifyOtp] Signup verified for ${email}`);
    return { user: data.user, session: data.session };
  }

  // 📧 Reenviar código OTP
  async resendOtp(email: string, type: 'signup' | 'recovery') {
    const resendType = type === 'recovery' ? 'email_change' : 'signup';
    const { error } = await this.supabase.auth.resend({
      type: resendType as any,
      email: email.trim().toLowerCase(),
    });

    if (error) {
      this.logger.warn(`[resendOtp] Failed: ${error.message}`);
      throw new BadRequestException(error.message);
    }

    this.logger.log(`[resendOtp] Code resent to ${email} (type=${type})`);
  }

  // 🔓 Solicitar recovery de contraseña
  async requestPasswordReset(email: string) {
    await this.supabase.auth.resetPasswordForEmail(email.trim().toLowerCase());
    // No revelar si el email existe (seguridad)
    this.logger.log(`[requestReset] Reset requested for ${email}`);
  }

  // 🔑 Verificar OTP de recovery
  async verifyRecoveryOtp(email: string, code: string) {
    const { data, error } = await this.supabase.auth.verifyOtp({
      email: email.trim().toLowerCase(),
      token: code,
      type: 'recovery',
    });

    if (error) {
      this.logger.warn(
        `[verifyRecovery] Failed for ${email}: ${error.message}`,
      );
      throw new BadRequestException('Código incorrecto o expirado');
    }

    if (!data.session) {
      throw new InternalServerErrorException(
        'Verificación exitosa pero sin sesión',
      );
    }

    this.logger.log(`[verifyRecovery] Recovery verified for ${email}`);
    return { user: data.user, session: data.session };
  }

  // 🗑️ Eliminar cuenta completa
  async deleteAccount(userId: string) {
    this.logger.warn(`[deleteAccount] Deleting all data for user ${userId}`);

    // Use raw SQL to handle FK constraints in correct order
    const { error: rpcError } = await this.supabase.rpc('delete_user_account', {
      p_user_id: userId,
    });

    if (rpcError) {
      this.logger.error(`[deleteAccount] RPC failed: ${rpcError.message}`);
      // Fallback: try table-by-table deletion
      const tables = [
        'transactions',
        'bot_message_log',
        'conversation_history',
        'channel_accounts',
        'goals',
        'payment_method',
        'categories',
        'accounts',
        'spending_expectations',
        'income_expectations',
        'personality_snapshot',
        'user_emotional_log',
      ];
      for (const table of tables) {
        await this.supabase.from(table).delete().eq('user_id', userId);
      }
      await this.supabase.from('user_prefs').delete().eq('id', userId);
      await this.supabase.from('users').delete().eq('id', userId);
    }

    // Delete from auth.users (removes login credentials)
    const { error: authError } =
      await this.supabase.auth.admin.deleteUser(userId);
    if (authError) {
      this.logger.error(
        `[deleteAccount] Failed to delete auth user: ${authError.message}`,
      );
      // Don't throw — public data is already deleted, auth cleanup is best-effort
    }

    this.logger.log(`[deleteAccount] Account fully deleted: ${userId}`);
  }

  // 🔒 Cambiar contraseña (autenticado)
  async changePassword(userId: string, newPassword: string) {
    const { error } = await this.supabase.auth.admin.updateUserById(userId, {
      password: newPassword,
    });

    if (error) {
      this.logger.warn(`[changePassword] Failed: ${error.message}`);
      throw new BadRequestException(error.message);
    }

    this.logger.log(`[changePassword] Password changed for user ${userId}`);
  }

  // 🟢 Login clásico (email/password)
  async signIn(dto: SignInDto) {
    if (!dto.password) {
      throw new BadRequestException('Debe ingresar una contraseña.');
    }

    const { data, error } = await this.supabase.auth.signInWithPassword({
      email: dto.email,
      password: dto.password,
    });

    if (error) {
      this.logger.warn(`[signin] Failed for ${dto.email}: ${error.message}`);
      throw new BadRequestException(`Auth error: ${error.message}`);
    }

    this.logger.log(`[signin] User logged in successfully: ${dto.email}`);
    return data.session;
  }

  // 🟡 Login con proveedor externo (Google, GitHub, etc.)
  async signInWithProvider(dto: ProviderLoginDto) {
    const redirectTo = dto.redirectTo ?? process.env.OAUTH_REDIRECT_URL;
    if (!redirectTo)
      throw new BadRequestException('OAUTH_REDIRECT_URL no configurada.');

    const { data, error } = await this.supabase.auth.signInWithOAuth({
      provider: dto.provider,
      options: { redirectTo, skipBrowserRedirect: true },
    });

    if (error) throw new BadRequestException(`OAuth error: ${error.message}`);
    if (!data?.url)
      throw new InternalServerErrorException(
        'No se recibió URL de redirección del proveedor.',
      );

    this.logger.log(`[oauth] Redirecting to provider: ${dto.provider}`);
    return { redirectUrl: data.url };
  }

  // 🔐 Obtener usuario autenticado desde JWT
  async getUser(jwt: string) {
    const { data, error } = await this.supabase.auth.getUser(jwt);
    if (error) throw new BadRequestException(error.message);
    if (!data?.user)
      throw new BadRequestException('Usuario no encontrado o token inválido.');
    return data.user;
  }

  async refreshSession(refreshToken: string) {
    if (!refreshToken) {
      throw new UnauthorizedException('Refresh token requerido.');
    }

    const { data, error } = await this.supabase.auth.refreshSession({
      refresh_token: refreshToken,
    });

    if (error) {
      this.logger.warn(`[refresh] Failed: ${error.message}`);
      throw new UnauthorizedException(error.message);
    }

    if (!data?.session) {
      throw new UnauthorizedException('Sesión inválida.');
    }

    this.logger.log('[refresh] Session refreshed successfully');
    return data.session;
  }
}
