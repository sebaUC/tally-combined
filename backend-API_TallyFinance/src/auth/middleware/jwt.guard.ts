import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
  Inject,
} from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import type { Request } from 'express';

@Injectable()
export class JwtGuard implements CanActivate {
  constructor(@Inject('SUPABASE') private supabase: SupabaseClient) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    type RequestWithAuth = Request & {
      authToken?: string;
      cookies?: Record<string, string>;
    };
    const req = ctx.switchToHttp().getRequest<RequestWithAuth>();
    const token = this.extractToken(req);
    if (!token) throw new UnauthorizedException('Missing token');

    const { data, error } = await this.supabase.auth.getUser(token);
    if (error || !data.user) throw new UnauthorizedException('Invalid token');

    (req as any).user = data.user;
    req.authToken = token;
    return true;
  }

  private extractToken(req: Request) {
    const auth = req.headers.authorization;
    if (auth?.startsWith('Bearer ')) {
      return auth.replace('Bearer ', '').trim();
    }

    const cookies = req.cookies ?? this.parseCookieHeader(req.headers.cookie);

    return cookies?.access_token;
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
