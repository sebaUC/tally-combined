import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ConfigService } from '@nestjs/config';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  const cfg = app.get(ConfigService);
  const corsOrigins = (cfg.get<string>('CORS_ORIGINS') ?? '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);

  // 1️⃣ Habilitar CORS para tus canales (web, Telegram, WhatsApp)
  app.enableCors({
    origin: corsOrigins.length ? corsOrigins : true,
    credentials: true,
  });

  // 2️⃣ Validación global con DTOs (class-validator)
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true, // elimina campos no declarados en DTOs
      forbidNonWhitelisted: true, // lanza error si envían algo extra
      transform: true, // convierte tipos automáticamente
    }),
  );

  // 3️⃣ Logs y puerto
  const port = Number(cfg.get<string>('PORT') ?? 3000);
  await app.listen(port, '0.0.0.0');
  const baseUrl = cfg.get<string>('APP_BASE_URL') ?? `http://localhost:${port}`;
  console.log(`🚀 API corriendo en ${baseUrl}`);
}
bootstrap();
