import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';

/**
 * Gate endpoints that require the caller to have completed MFA in the
 * current session. Requires JwtGuard to have run first so `req.authToken`
 * is populated.
 *
 * The decision reads the `aal` (Authenticator Assurance Level) claim from
 * the Supabase JWT directly — no network round-trip. Supabase issues
 * `aal: "aal2"` only after a TOTP verify succeeds for the current session.
 *
 * On failure, emits a structured 403 that the frontend can catch to
 * trigger an MFA step-up flow instead of a generic logout.
 */
@Injectable()
export class MfaRequiredGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    // Emergency rollback escape hatch. Setting DISABLE_MFA_ENFORCEMENT=true
    // in Render lets us lift the gate without a redeploy if the MFA flow
    // locks someone out. Log loudly so we don't forget it on.
    if (process.env.DISABLE_MFA_ENFORCEMENT === 'true') {
      // eslint-disable-next-line no-console
      console.warn(
        '[MfaRequiredGuard] DISABLE_MFA_ENFORCEMENT=true — skipping MFA check. ' +
          'This is meant for emergency rollback only. Unset this variable.',
      );
      return true;
    }

    const req = ctx
      .switchToHttp()
      .getRequest<Request & { authToken?: string }>();

    const token = req.authToken;
    if (!token) {
      throw new UnauthorizedException('Missing auth token');
    }

    const payload = this.decodeJwtClaims(token);
    if (!payload) {
      throw new UnauthorizedException('Malformed auth token');
    }

    if (payload.aal !== 'aal2') {
      throw new ForbiddenException({
        error: 'AAL2_REQUIRED',
        message:
          'This action requires multi-factor authentication. Complete the ' +
          'MFA challenge and retry.',
      });
    }
    return true;
  }

  private decodeJwtClaims(
    token: string,
  ): { aal?: string; [key: string]: unknown } | null {
    try {
      const parts = token.split('.');
      if (parts.length !== 3) return null;
      const payload = Buffer.from(parts[1], 'base64url').toString('utf8');
      return JSON.parse(payload);
    } catch {
      return null;
    }
  }
}
