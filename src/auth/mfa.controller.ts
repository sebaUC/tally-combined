import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Post,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response, CookieOptions } from 'express';
import { MfaService } from './services/mfa.service';
import { JwtGuard } from './middleware/jwt.guard';
import { MfaRequiredGuard } from './middleware/mfa.guard';
import { AuthToken } from './decorators/auth-token.decorator';

const isProduction = process.env.NODE_ENV === 'production';

const baseCookieOptions: CookieOptions = {
  httpOnly: true,
  secure: isProduction,
  sameSite: 'lax',
  path: '/',
};

const accessCookieOptions: CookieOptions = {
  ...baseCookieOptions,
  maxAge: 60 * 60 * 1000,
};

const refreshCookieOptions: CookieOptions = {
  ...baseCookieOptions,
  maxAge: 60 * 60 * 24 * 7 * 1000,
};

@Controller('auth/mfa')
@UseGuards(JwtGuard)
export class MfaController {
  constructor(private readonly mfa: MfaService) {}

  /** Start TOTP enrollment. Returns QR + secret for the authenticator app. */
  @Post('enroll')
  async enroll(
    @AuthToken() token: string,
    @Body() body: { friendlyName?: string },
  ) {
    return this.mfa.enroll(token, body?.friendlyName);
  }

  /**
   * Confirm enrollment with the first authenticator code. On success,
   * Supabase issues a new session with `aal: "aal2"`; we rotate the
   * auth cookies to that session so every subsequent request is stepped-up.
   */
  @Post('verify-enroll')
  async verifyEnroll(
    @AuthToken() token: string,
    @Body() body: { factorId?: string; code?: string },
    @Res({ passthrough: true }) res: Response,
  ) {
    if (!body?.factorId || !body?.code) {
      throw new BadRequestException('factorId and code are required');
    }
    const result = await this.mfa.verifyEnroll(
      token,
      body.factorId,
      body.code,
    );
    this.rotateAuthCookies(res, result.session);
    return {
      verified: true,
      session: this.sessionPayload(result.session),
    };
  }

  /** Start a step-up challenge for an already-enrolled factor. */
  @Post('challenge')
  async challenge(
    @AuthToken() token: string,
    @Body() body: { factorId?: string },
  ) {
    if (!body?.factorId) {
      throw new BadRequestException('factorId is required');
    }
    return this.mfa.challenge(token, body.factorId);
  }

  /**
   * Complete a step-up challenge. Returns a new session at `aal2` and
   * rotates the cookies so subsequent requests pass MfaRequiredGuard.
   */
  @Post('verify')
  async verify(
    @AuthToken() token: string,
    @Body()
    body: { factorId?: string; challengeId?: string; code?: string },
    @Res({ passthrough: true }) res: Response,
  ) {
    if (!body?.factorId || !body?.challengeId || !body?.code) {
      throw new BadRequestException(
        'factorId, challengeId and code are required',
      );
    }
    const result = await this.mfa.verify(
      token,
      body.factorId,
      body.challengeId,
      body.code,
    );
    this.rotateAuthCookies(res, result.session);
    return { session: this.sessionPayload(result.session) };
  }

  /**
   * Remove a factor. Requires the CURRENT session to already be `aal2` —
   * prevents a stolen-password attacker from disabling MFA.
   */
  @Post('unenroll')
  @UseGuards(MfaRequiredGuard)
  async unenroll(
    @AuthToken() token: string,
    @Body() body: { factorId?: string },
  ) {
    if (!body?.factorId) {
      throw new BadRequestException('factorId is required');
    }
    return this.mfa.unenroll(token, body.factorId);
  }

  @Get('factors')
  async factors(@AuthToken() token: string) {
    return this.mfa.listFactors(token);
  }

  /** Exposes the current + next AAL so the frontend can decide whether to prompt. */
  @Get('aal')
  async aal(@AuthToken() token: string) {
    return this.mfa.getAal(token);
  }

  // ── helpers ─────────────────────────────────────────────────────

  private rotateAuthCookies(
    res: Response,
    session: { access_token?: string; refresh_token?: string } | null,
  ) {
    if (!session?.access_token) return;
    res.cookie('access_token', session.access_token, accessCookieOptions);
    if (session.refresh_token) {
      res.cookie(
        'refresh_token',
        session.refresh_token,
        refreshCookieOptions,
      );
    }
  }

  private sessionPayload(
    session: {
      access_token?: string;
      refresh_token?: string;
      expires_at?: number;
      expires_in?: number;
      token_type?: string;
    } | null,
  ) {
    if (!session) return null;
    return {
      accessToken: session.access_token,
      refreshToken: session.refresh_token ?? null,
      expiresAt: session.expires_at ?? null,
      expiresIn: session.expires_in ?? null,
      tokenType: session.token_type ?? null,
    };
  }
}
