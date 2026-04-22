import { IsIn, IsObject, IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * Payload del webhook de Fintoc, validado a nivel de estructura.
 * La autenticidad ya fue validada por `FintocWebhookGuard` (HMAC).
 *
 * Nota: el ValidationPipe global tiene forbidNonWhitelisted=true.
 * Todos los campos que Fintoc envía deben estar declarados aquí
 * aunque no los usemos, si no la request se rechaza con 400.
 */
export class WebhookEventDto {
  @IsString()
  @MaxLength(120)
  id!: string;

  @IsString()
  @MaxLength(120)
  type!: string;

  @IsIn(['test', 'live'])
  mode!: 'test' | 'live';

  /** Siempre "event" — Fintoc lo incluye para distinguir el tipo de recurso. */
  @IsOptional()
  @IsString()
  object?: string;

  @IsOptional()
  @IsString()
  created_at?: string;

  @IsOptional()
  @IsObject()
  data?: Record<string, unknown>;
}
