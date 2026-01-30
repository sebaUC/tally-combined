import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
  ForbiddenException,
  Inject,
} from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import type { Request } from 'express';

/**
 * SECURITY LAYER 1: Hardcoded UUID whitelist
 * These are the only users who can EVER access admin endpoints.
 * To add a new admin: add their UUID here AND set app_metadata.role = 'admin' in Supabase.
 */
const ADMIN_WHITELIST: string[] = [
  '9d1454f5-4317-4baf-aec8-78bd8a06edb0',
];

@Injectable()
export class AdminGuard implements CanActivate {
  constructor(@Inject('SUPABASE') private supabase: SupabaseClient) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<Request & { user?: any; authToken?: string }>();

    // Extract token from Bearer header or cookie
    const token = this.extractToken(req);
    if (!token) {
      throw new UnauthorizedException('Missing authentication token');
    }

    // Validate token with Supabase
    const { data, error } = await this.supabase.auth.getUser(token);
    if (error || !data.user) {
      throw new UnauthorizedException('Invalid or expired token');
    }

    const user = data.user;
    const userId = user.id;
    const email = user.email || 'unknown';

    // SECURITY LAYER 1: Check hardcoded whitelist
    if (!ADMIN_WHITELIST.includes(userId)) {
      console.warn(`[AdminGuard] BLOCKED: User ${email} (${userId}) not in whitelist`);
      throw new ForbiddenException('Access denied');
    }

    // SECURITY LAYER 2: Check app_metadata.role === 'admin'
    const appMetadata = user.app_metadata || {};
    if (appMetadata.role !== 'admin') {
      console.warn(`[AdminGuard] BLOCKED: User ${email} (${userId}) missing admin role in app_metadata`);
      throw new ForbiddenException('Access denied');
    }

    // Both checks passed - grant access
    console.log(`[AdminGuard] ACCESS GRANTED: ${email} (${userId})`);

    // Attach user to request for use in controllers
    req.user = user;
    req.authToken = token;

    return true;
  }

  private extractToken(req: Request): string | undefined {
    // Check Bearer header first
    const auth = req.headers.authorization;
    if (auth?.startsWith('Bearer ')) {
      return auth.replace('Bearer ', '').trim();
    }

    // Fall back to cookie
    const cookies = req.cookies ?? this.parseCookieHeader(req.headers.cookie);
    return cookies?.access_token;
  }

  private parseCookieHeader(header?: string): Record<string, string> {
    if (!header) return {};
    return header.split(';').reduce<Record<string, string>>((acc, current) => {
      const [rawKey, ...rest] = current.trim().split('=');
      if (!rawKey) return acc;
      acc[rawKey] = decodeURIComponent(rest.join('='));
      return acc;
    }, {});
  }
}
