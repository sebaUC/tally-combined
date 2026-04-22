import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';

/**
 * Returns the Bearer token that JwtGuard attached to the request.
 * Use this in controllers that need to call Supabase as the user
 * (e.g. MFA endpoints), not as the backend service-role.
 */
export const AuthToken = createParamDecorator(
  (_: unknown, ctx: ExecutionContext) => {
    const req = ctx.switchToHttp().getRequest<Request & { authToken?: string }>();
    return req.authToken;
  },
);
