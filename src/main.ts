import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ConfigService } from '@nestjs/config';
import helmet from 'helmet';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    // rawBody exposed as req.rawBody — needed for Fintoc webhook HMAC validation.
    // JSON parsing still runs for all controllers.
    rawBody: true,
  });

  // Trust the first-hop proxy (Render, etc.) so req.ip reflects the real
  // client IP instead of the proxy. Without this, the auth rate limiter
  // keys off a single proxy IP and shares the bucket across all clients.
  const httpAdapter = app.getHttpAdapter().getInstance();
  if (typeof httpAdapter?.set === 'function') {
    httpAdapter.set('trust proxy', 1);
  }

  const cfg = app.get(ConfigService);
  const nodeEnv = cfg.get<string>('NODE_ENV') ?? 'development';
  const isProduction = nodeEnv === 'production';

  const corsOrigins = (cfg.get<string>('CORS_ORIGINS') ?? '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);

  // CORS — fail closed in production if no explicit allow-list is configured.
  // `origin: true` reflects any request origin, which combined with
  // `credentials: true` enables cross-site credentialed requests.
  if (isProduction && corsOrigins.length === 0) {
    throw new Error(
      'CORS_ORIGINS must be set to an explicit allow-list in production. ' +
        'Refusing to start with a wildcard CORS configuration.',
    );
  }

  app.enableCors({
    origin: corsOrigins.length ? corsOrigins : true,
    credentials: true,
  });

  // Security headers (Helmet). Applied before route handlers.
  // contentSecurityPolicy is disabled because this process serves a JSON API
  // (the SPA lives on Vercel with its own CSP); enabling the default CSP
  // would block legitimate responses without adding protection.
  app.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginResourcePolicy: { policy: 'cross-origin' },
      referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
      hsts: isProduction
        ? { maxAge: 63072000, includeSubDomains: true, preload: false }
        : false,
    }),
  );

  // Global DTO validation (class-validator).
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  const port = Number(cfg.get<string>('PORT') ?? 3000);
  await app.listen(port, '0.0.0.0');
  const baseUrl = cfg.get<string>('APP_BASE_URL') ?? `http://localhost:${port}`;
  console.log(`🚀 API corriendo en ${baseUrl}`);
}
bootstrap();
