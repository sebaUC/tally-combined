import {
  BadRequestException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { SupabaseUserClientFactory } from '../../supabase/supabase-user-client.service';

/**
 * Thin proxy over Supabase Auth MFA APIs.
 *
 * These calls must run as the end user (they mutate their own auth state),
 * which is why every method takes the caller's access token and uses the
 * user-scoped Supabase client factory instead of the backend's service role.
 *
 * MFA must be enabled in Supabase Dashboard → Authentication → Providers →
 * Multi-factor authentication. Without that, `enroll` will fail with
 * `MFA is disabled`.
 */
@Injectable()
export class MfaService {
  constructor(private readonly userClients: SupabaseUserClientFactory) {}

  /**
   * Start TOTP enrollment. The returned QR + URI are what the user scans
   * with their authenticator app. The factor is not "active" until
   * `verifyEnroll` confirms a valid code.
   */
  async enroll(accessToken: string, friendlyName?: string) {
    const supabase = this.userClients.create(accessToken);
    const { data, error } = await supabase.auth.mfa.enroll({
      factorType: 'totp',
      friendlyName: friendlyName?.trim() || 'TallyFinance',
    });
    if (error) throw new BadRequestException(error.message);
    return {
      factorId: data.id,
      type: data.type,
      qrCode: data.totp.qr_code,
      secret: data.totp.secret,
      uri: data.totp.uri,
    };
  }

  /**
   * Verify the first code from the authenticator to finish enrollment.
   * On success, Supabase re-issues a session whose `aal` is `aal2`.
   */
  async verifyEnroll(
    accessToken: string,
    factorId: string,
    code: string,
  ) {
    const supabase = this.userClients.create(accessToken);
    const challenge = await supabase.auth.mfa.challenge({ factorId });
    if (challenge.error) {
      throw new BadRequestException(challenge.error.message);
    }
    const verify = await supabase.auth.mfa.verify({
      factorId,
      challengeId: challenge.data.id,
      code,
    });
    if (verify.error) throw new UnauthorizedException(verify.error.message);
    return { verified: true, session: verify.data };
  }

  /** Step-up challenge: start an MFA prompt for an existing factor. */
  async challenge(accessToken: string, factorId: string) {
    const supabase = this.userClients.create(accessToken);
    const { data, error } = await supabase.auth.mfa.challenge({ factorId });
    if (error) throw new BadRequestException(error.message);
    return { challengeId: data.id, expiresAt: data.expires_at };
  }

  /** Complete a step-up. Returns a new session with `aal2`. */
  async verify(
    accessToken: string,
    factorId: string,
    challengeId: string,
    code: string,
  ) {
    const supabase = this.userClients.create(accessToken);
    const { data, error } = await supabase.auth.mfa.verify({
      factorId,
      challengeId,
      code,
    });
    if (error) throw new UnauthorizedException(error.message);
    return { session: data };
  }

  /**
   * Remove a factor. Supabase requires the CURRENT session to be `aal2`
   * for this to succeed — prevents a lower-privileged session (e.g.
   * stolen password, no second factor) from disabling MFA.
   */
  async unenroll(accessToken: string, factorId: string) {
    const supabase = this.userClients.create(accessToken);
    const { error } = await supabase.auth.mfa.unenroll({ factorId });
    if (error) throw new BadRequestException(error.message);
    return { ok: true };
  }

  async listFactors(accessToken: string) {
    const supabase = this.userClients.create(accessToken);
    const { data, error } = await supabase.auth.mfa.listFactors();
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  async getAal(accessToken: string) {
    const supabase = this.userClients.create(accessToken);
    const { data, error } =
      await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    if (error) throw new BadRequestException(error.message);
    return data;
  }
}
