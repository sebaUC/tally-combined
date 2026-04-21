import {
  Controller,
  Post,
  Body,
  UseGuards,
  Get,
  Req,
  Query,
  Param,
  BadRequestException,
  Res,
  UnauthorizedException,
  InternalServerErrorException,
  OnModuleInit,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { AuthService } from './auth.service';
import { SignUpDto } from './dto/sign-up.dto';
import { SignInDto } from './dto/sign-in.dto';
import { ProviderLoginDto } from './dto/provider-login.dto';
import { LinkChannelDto } from './dto/link-channel.dto';
import { OnboardingDto } from '../onboarding/dto/onboarding.dto';
import { JwtGuard } from './middleware/jwt.guard';
import { User } from './decorators/user.decorator';
import type { Request, Response, CookieOptions } from 'express';
import { AuthProfileService } from './services/auth-profile.service';
import { AuthChannelService } from './services/auth-channel.service';
import { OnboardingService } from '../onboarding/onboarding.service';
import { ChannelLinkCodeService } from '../common/utils/channel-link-code.service';
import { RedisService } from '../redis';
import {
  AsyncRateLimiter,
  createAsyncRateLimiter,
} from '../common/utils/resilience';

const isProduction = process.env.NODE_ENV === 'production';
const ACCESS_COOKIE = 'access_token';
const REFRESH_COOKIE = 'refresh_token';

const baseCookieOptions: CookieOptions = {
  httpOnly: true,
  secure: isProduction,
  sameSite: 'lax',
  path: '/',
};

const accessCookieOptions: CookieOptions = {
  ...baseCookieOptions,
  maxAge: 60 * 60 * 1000, // 1 hora
};

const refreshCookieOptions: CookieOptions = {
  ...baseCookieOptions,
  maxAge: 60 * 60 * 24 * 7 * 1000, // 7 días
};

type RequestWithCookies = Request & { cookies?: Record<string, string> };

@Controller('auth')
export class AuthController implements OnModuleInit {
  // Brute-force protection on sensitive auth endpoints.
  // 5 attempts per 15 minutes, keyed separately by IP and by email
  // so a single attacker can't exhaust the limit for a victim's account
  // nor rotate IPs to bypass the per-account limit.
  private authIpLimiter!: AsyncRateLimiter;
  private authEmailLimiter!: AsyncRateLimiter;

  constructor(
    private readonly auth: AuthService,
    private readonly profile: AuthProfileService,
    private readonly channels: AuthChannelService,
    private readonly onboarding: OnboardingService,
    private readonly linkCodes: ChannelLinkCodeService,
    private readonly redis: RedisService,
  ) {}

  onModuleInit() {
    const windowMs = 15 * 60 * 1000;
    this.authIpLimiter = createAsyncRateLimiter(this.redis, 5, windowMs);
    this.authEmailLimiter = createAsyncRateLimiter(this.redis, 5, windowMs);
  }

  private getClientIp(req: Request): string {
    // main.ts sets `trust proxy: 1`, so req.ip already honours the first
    // X-Forwarded-For hop set by the Render edge. Keep a last-resort
    // fallback for the local socket in case the adapter is misconfigured.
    return req.ip || req.socket?.remoteAddress || 'unknown';
  }

  private assertStrongPassword(
    pw: string | undefined,
  ): asserts pw is string {
    // Min 12 chars + at least one lowercase, uppercase, digit, and symbol.
    const STRONG_PW_REGEX =
      /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{12,}$/;
    if (!pw || !STRONG_PW_REGEX.test(pw)) {
      throw new BadRequestException(
        'La contraseña debe tener al menos 12 caracteres e incluir mayúscula, minúscula, número y símbolo.',
      );
    }
  }

  private async enforceAuthRateLimit(
    req: Request,
    action: string,
    email?: string,
  ): Promise<void> {
    const ip = this.getClientIp(req);
    const ipAllowed = await this.authIpLimiter.isAllowed(
      `auth:ip:${ip}:${action}`,
    );
    if (!ipAllowed) {
      throw new HttpException(
        'Demasiados intentos desde esta IP. Intenta de nuevo en unos minutos.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    if (email) {
      const normalized = email.trim().toLowerCase();
      const emailAllowed = await this.authEmailLimiter.isAllowed(
        `auth:email:${normalized}:${action}`,
      );
      if (!emailAllowed) {
        throw new HttpException(
          'Demasiados intentos para esta cuenta. Intenta de nuevo más tarde.',
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
    }
  }

  @Post('signup')
  async signUp(
    @Body() dto: SignUpDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    await this.enforceAuthRateLimit(req, 'signup', dto.email);
    const result = await this.auth.signUp(dto);
    const session = result.session;

    if (session?.access_token) {
      this.setAuthCookies(
        res,
        session.access_token,
        session.refresh_token ?? undefined,
      );
    }

    return {
      message: result.requiresVerification
        ? 'Código de verificación enviado al email'
        : 'Signup successful',
      user: result.user,
      requiresVerification: result.requiresVerification ?? false,
      email: result.user?.email,
      session: session
        ? {
            accessToken: session.access_token,
            refreshToken: session.refresh_token ?? null,
            expiresAt: session.expires_at ?? null,
            expiresIn: session.expires_in ?? null,
            tokenType: session.token_type ?? null,
          }
        : null,
    };
  }

  @Post('verify-signup')
  async verifySignup(
    @Body() body: { email: string; code: string },
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    if (!body.email || !body.code) {
      throw new BadRequestException('Email y código son requeridos');
    }
    await this.enforceAuthRateLimit(req, 'verify-signup', body.email);
    const result = await this.auth.verifySignupOtp(body.email, body.code);
    this.setAuthCookies(
      res,
      result.session.access_token,
      result.session.refresh_token ?? undefined,
    );

    return {
      message: 'Email verificado',
      user: result.user,
      session: {
        accessToken: result.session.access_token,
        refreshToken: result.session.refresh_token ?? null,
        expiresAt: result.session.expires_at ?? null,
        expiresIn: result.session.expires_in ?? null,
      },
    };
  }

  @Post('resend-otp')
  async resendOtp(
    @Body() body: { email: string; type?: string },
    @Req() req: Request,
  ) {
    if (!body.email) throw new BadRequestException('Email requerido');
    await this.enforceAuthRateLimit(req, 'resend-otp', body.email);
    const type = body.type === 'recovery' ? 'recovery' : 'signup';
    await this.auth.resendOtp(body.email, type);
    return { message: 'Código reenviado' };
  }

  @Post('request-password-reset')
  async requestPasswordReset(
    @Body() body: { email: string },
    @Req() req: Request,
  ) {
    if (!body.email) throw new BadRequestException('Email requerido');
    await this.enforceAuthRateLimit(req, 'request-password-reset', body.email);
    await this.auth.requestPasswordReset(body.email);
    return {
      message: 'Si el email existe, recibirás un código de recuperación',
    };
  }

  @Post('verify-recovery')
  async verifyRecovery(
    @Body() body: { email: string; code: string },
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    if (!body.email || !body.code) {
      throw new BadRequestException('Email y código son requeridos');
    }
    await this.enforceAuthRateLimit(req, 'verify-recovery', body.email);
    const result = await this.auth.verifyRecoveryOtp(body.email, body.code);
    this.setAuthCookies(
      res,
      result.session.access_token,
      result.session.refresh_token ?? undefined,
    );

    return {
      message: 'Código verificado',
      userId: result.user?.id,
      session: {
        accessToken: result.session.access_token,
        refreshToken: result.session.refresh_token ?? null,
      },
    };
  }

  @Post('reset-password')
  async resetPassword(
    @Body() body: { email: string; code: string; password: string },
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    if (!body.email || !body.code || !body.password) {
      throw new BadRequestException(
        'Email, código y contraseña son requeridos',
      );
    }
    await this.enforceAuthRateLimit(req, 'reset-password', body.email);
    this.assertStrongPassword(body.password);

    // Verify OTP first to get user ID
    const result = await this.auth.verifyRecoveryOtp(body.email, body.code);

    // Change password using admin API (no JWT needed)
    await this.auth.changePassword(result.user!.id, body.password);

    // Sign in with new credentials for a full session
    const session = await this.auth.signIn({
      email: body.email.trim().toLowerCase(),
      password: body.password,
    });

    if (session?.access_token) {
      this.setAuthCookies(
        res,
        session.access_token,
        session.refresh_token ?? undefined,
      );
    }

    return {
      message: 'Contraseña actualizada',
      session: session
        ? {
            accessToken: session.access_token,
            refreshToken: session.refresh_token ?? null,
          }
        : null,
    };
  }

  @Post('change-password')
  @UseGuards(JwtGuard)
  async changePassword(@Body() body: { password: string }, @User() user: any) {
    this.assertStrongPassword(body?.password);
    await this.auth.changePassword(user.id, body.password);
    return { message: 'Contraseña actualizada' };
  }

  @Post('delete-account')
  @UseGuards(JwtGuard)
  async deleteAccount(
    @User() user: any,
    @Res({ passthrough: true }) res: Response,
  ) {
    await this.auth.deleteAccount(user.id);
    // Clear cookies
    res.clearCookie('access_token');
    res.clearCookie('refresh_token');
    return { message: 'Cuenta eliminada' };
  }

  @Post('signin')
  async signIn(
    @Body() dto: SignInDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    await this.enforceAuthRateLimit(req, 'signin', dto.email);
    const session = await this.auth.signIn(dto);

    if (!session?.access_token || !session.refresh_token) {
      throw new InternalServerErrorException(
        'Sesión incompleta devuelta por Supabase.',
      );
    }

    this.setAuthCookies(res, session.access_token, session.refresh_token);

    // 🔥 Preemptively wake up AI service (fire-and-forget)

    const fullProfile = await this.profile.getUserFullProfile(
      session.access_token,
    );
    return {
      message: 'Login successful',
      session: {
        accessToken: session.access_token,
        refreshToken: session.refresh_token,
        expiresAt: session.expires_at,
        expiresIn: session.expires_in,
        tokenType: session.token_type,
      },
      user: fullProfile,
    };
  }

  // 1️⃣ Paso inicial OAuth: obtener URL de redirección
  @Post('provider')
  async signInWithProvider(@Body() dto: ProviderLoginDto) {
    return this.auth.signInWithProvider(dto);
  }

  @Get('callback')
  async handleOAuthCallback(
    @Req() req: RequestWithCookies,
    @Res({ passthrough: true }) res: Response,
    @Query('access_token') queryAccessToken?: string,
    @Query('refresh_token') queryRefreshToken?: string,
  ) {
    // Only accept tokens from query params or the URL fragment of the
    // current request. Reading from the Referer header is unsafe — a
    // crafted page could smuggle someone else's token to this endpoint.
    const fragmentAccess = this.extractFragmentParam(req.url, 'access_token');
    const accessToken = queryAccessToken || fragmentAccess;

    const fragmentRefresh = this.extractFragmentParam(req.url, 'refresh_token');
    const refreshToken = queryRefreshToken || fragmentRefresh;

    if (!accessToken) {
      throw new BadRequestException('Missing access_token');
    }

    this.setAuthCookies(res, accessToken, refreshToken);

    const user = await this.profile.getUser(accessToken);
    const profile = await this.profile.getUserProfile(user.id);

    return {
      message: 'Login successful',
      session: {
        accessToken,
        refreshToken,
      },
      user: {
        ...user,
        profile,
      },
    };
  }

  @Post('refresh')
  async refresh(
    @Req() req: RequestWithCookies,
    @Body() body: { refreshToken?: string },
    @Res({ passthrough: true }) res: Response,
  ) {
    // Accept refresh token from: (1) request body, (2) cookies, (3) raw cookie header.
    // Body-based token is needed for cross-origin deployments (Vercel → Render)
    // where sameSite=lax cookies are NOT sent on fetch requests.
    const refreshToken =
      body?.refreshToken ??
      req.cookies?.[REFRESH_COOKIE] ??
      this.parseCookieHeader(req.headers.cookie)[REFRESH_COOKIE];

    if (!refreshToken) {
      throw new UnauthorizedException('Refresh token no encontrado.');
    }

    const session = await this.auth.refreshSession(refreshToken);
    if (!session.access_token) {
      throw new UnauthorizedException('Sesión inválida.');
    }
    this.setAuthCookies(
      res,
      session.access_token,
      session.refresh_token ?? refreshToken,
    );

    // 🔥 Preemptively wake up AI service (fire-and-forget)

    return {
      message: 'Session refreshed',
      session: {
        accessToken: session.access_token,
        refreshToken: session.refresh_token ?? refreshToken,
        expiresAt: session.expires_at,
        expiresIn: session.expires_in,
        tokenType: session.token_type,
      },
    };
  }

  @Post('logout')
  async logout(@Res({ passthrough: true }) res: Response) {
    this.clearAuthCookies(res);
    return { message: 'Logged out' };
  }

  @UseGuards(JwtGuard)
  @Post('create-link-token')
  async createLinkToken(@Body('channel') channel: string, @User() user: any) {
    if (!user?.id) {
      throw new BadRequestException('Usuario no encontrado en la sesión.');
    }
    if (!channel || !['telegram', 'whatsapp'].includes(channel)) {
      throw new BadRequestException(
        'Debe indicar un canal válido (telegram o whatsapp).',
      );
    }

    return this.channels.createLinkToken(
      user.id,
      channel as 'telegram' | 'whatsapp',
    );
  }

  @UseGuards(JwtGuard)
  @Post('link-channel')
  async linkChannel(@Body() dto: LinkChannelDto, @User() user: any) {
    if (!user?.id) {
      throw new BadRequestException('Usuario no encontrado en la sesión.');
    }

    const channelAccount = await this.channels.linkChannel(user.id, dto);
    return { message: 'Channel linked', channelAccount };
  }

  @UseGuards(JwtGuard)
  @Get('me')
  async getMe(@User() user: any) {
    if (!user?.id) {
      throw new BadRequestException('Usuario no encontrado en la sesión.');
    }

    const profile = await this.profile.getUserProfile(user.id);
    const linkStatus = await this.channels.getLinkStatus(user.id);

    return {
      ...user,
      profile,
      linked: linkStatus.linked,
      isLinked: linkStatus.linked,
    };
  }

  @UseGuards(JwtGuard)
  @Get('sessions')
  async sessions(@User() user: any) {
    if (!user?.id) {
      throw new BadRequestException('Usuario no encontrado en la sesión.');
    }

    return this.profile.getUserSessions(user.id);
  }

  @UseGuards(JwtGuard)
  @Get('link-status')
  async linkStatus(@User() user: any) {
    if (!user?.id) {
      throw new BadRequestException('Usuario no encontrado en la sesión.');
    }

    return this.channels.getLinkStatus(user.id);
  }

  @UseGuards(JwtGuard)
  @Post('onboarding')
  async completeOnboarding(@Body() dto: OnboardingDto, @User() user: any) {
    if (!user?.id) {
      throw new BadRequestException('Usuario no encontrado en la sesión.');
    }

    await this.onboarding.processOnboarding(user.id, dto);
    return { success: true };
  }

  @UseGuards(JwtGuard)
  @Post('unlink-channel')
  async unlinkChannel(@Body('channel') channel: string, @User() user: any) {
    if (!user?.id) {
      throw new BadRequestException('Usuario no encontrado en la sesión.');
    }
    if (!channel || !['telegram', 'whatsapp'].includes(channel)) {
      throw new BadRequestException(
        'Debe indicar un canal válido (telegram o whatsapp).',
      );
    }

    return this.channels.unlinkChannel(
      user.id,
      channel as 'telegram' | 'whatsapp',
    );
  }

  /**
   * Check the status of a link code, including any conflicts.
   * Used by frontend to detect when a channel linking attempt fails due to conflict.
   */
  @UseGuards(JwtGuard)
  @Get('link-code-status/:code')
  async linkCodeStatus(@Param('code') code: string) {
    if (!code || code.length !== 8) {
      throw new BadRequestException('Código de vinculación inválido.');
    }

    // Check for conflict first
    const conflict = this.linkCodes.getConflict(code);
    if (conflict) {
      return {
        status: 'conflict',
        reason: conflict.reason,
        conflictedAt: new Date(conflict.conflictedAt).toISOString(),
      };
    }

    // Try to peek at the code to check if it's valid
    try {
      const codeData = await this.linkCodes.peek(code);
      return {
        status: 'pending',
        channel: codeData.channel,
        expiresAt: new Date(codeData.expiresAt).toISOString(),
      };
    } catch (err) {
      // Code might be used, expired, or not found
      const message = err instanceof Error ? err.message : 'Código inválido';

      // Detect if code was used (linked successfully)
      if (message.includes('ya fue utilizado')) {
        return {
          status: 'used',
          reason: message,
        };
      }

      // Detect if code expired
      if (message.includes('expirado')) {
        return {
          status: 'expired',
          reason: message,
        };
      }

      return {
        status: 'invalid',
        reason: message,
      };
    }
  }

  private setAuthCookies(
    res: Response,
    accessToken: string,
    refreshToken?: string,
  ) {
    res.cookie(ACCESS_COOKIE, accessToken, accessCookieOptions);
    if (refreshToken) {
      res.cookie(REFRESH_COOKIE, refreshToken, refreshCookieOptions);
    }
  }

  private clearAuthCookies(res: Response) {
    res.clearCookie(ACCESS_COOKIE, baseCookieOptions);
    res.clearCookie(REFRESH_COOKIE, baseCookieOptions);
  }

  private extractFragmentParam(source: string | undefined, key: string) {
    if (!source) return undefined;
    const fragment = source.includes('#') ? source.split('#')[1] : undefined;
    if (!fragment) return undefined;
    const params = new URLSearchParams(fragment);
    return params.get(key) ?? undefined;
  }

  private parseCookieHeader(header?: string) {
    if (!header) return {};
    return header.split(';').reduce<Record<string, string>>((acc, current) => {
      const [rawKey, ...rest] = current.trim().split('=');
      if (!rawKey) return acc;
      acc[rawKey] = decodeURIComponent(rest.join('='));
      return acc;
    }, {});
  }
}
