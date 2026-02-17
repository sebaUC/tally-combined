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

    // 🗄️ Paso 2: Insertar perfil extendido en public.users
    const now = new Date().toISOString();
    const { error: insertError } = await this.supabase.from('users').upsert(
      {
        id: user.id,
        package: defaults.package,
        is_active: true,
        created_at: now,
        updated_at: now,
      },
      { onConflict: 'id' },
    );

    if (insertError) {
      this.logger.error(`[signup] DB insert failed: ${insertError.message}`);
      throw new InternalServerErrorException(
        `DB insert failed: ${insertError.message}`,
      );
    }

    const sessionPayload = data.session ?? null;

    this.logger.log(`[signup] User created successfully: ${user.id}`);
    return { user, session: sessionPayload };
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
