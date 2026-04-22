import { IsNotEmpty, IsString, MaxLength, MinLength } from 'class-validator';

/**
 * Payload recibido del frontend al completarse el widget de Fintoc.
 * El `exchange_token` viene de `onSuccess` del widget y es single-use.
 */
export class ExchangeTokenDto {
  @IsString()
  @IsNotEmpty()
  @MinLength(10)
  @MaxLength(500)
  exchange_token!: string;
}
