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
import { AiWarmupService } from '../common/services/ai-warmup.service';

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
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly profile: AuthProfileService,
    private readonly channels: AuthChannelService,
    private readonly onboarding: OnboardingService,
    private readonly linkCodes: ChannelLinkCodeService,
    private readonly aiWarmup: AiWarmupService,
  ) {}

  @Post('signup')
  async signUp(
    @Body() dto: SignUpDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.auth.signUp(dto);
    const session = result.session;

    if (session?.access_token) {
      this.setAuthCookies(
        res,
        session.access_token,
        session.refresh_token ?? undefined,
      );

      // 🔥 Preemptively wake up AI service (fire-and-forget)
      this.aiWarmup.pingAsync();
    }

    return {
      message: 'Signup successful',
      user: result.user,
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

  @Post('signin')
  async signIn(
    @Body() dto: SignInDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const session = await this.auth.signIn(dto);

    if (!session?.access_token || !session.refresh_token) {
      throw new InternalServerErrorException(
        'Sesión incompleta devuelta por Supabase.',
      );
    }

    this.setAuthCookies(res, session.access_token, session.refresh_token);

    // 🔥 Preemptively wake up AI service (fire-and-forget)
    this.aiWarmup.pingAsync();

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
    const fragmentAccess = this.extractFragmentParam(req.url, 'access_token');
    const refererAccess = this.extractFragmentParam(
      req.headers.referer,
      'access_token',
    );
    const accessToken = queryAccessToken || fragmentAccess || refererAccess;

    const fragmentRefresh = this.extractFragmentParam(req.url, 'refresh_token');
    const refererRefresh = this.extractFragmentParam(
      req.headers.referer,
      'refresh_token',
    );
    const refreshToken = queryRefreshToken || fragmentRefresh || refererRefresh;

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
    @Res({ passthrough: true }) res: Response,
  ) {
    const refreshToken =
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
    this.aiWarmup.pingAsync();

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
  async createLinkToken(
    @Body('channel') channel: string,
    @User() user: any,
  ) {
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
