import { IsIn, IsOptional } from 'class-validator';

/**
 * Payload opcional al crear un Link Intent.
 * Actualmente usamos defaults fijos (product=movements, country=cl)
 * — el DTO queda listo para extenderse sin romper el contrato.
 */
export class CreateLinkIntentDto {
  @IsOptional()
  @IsIn(['movements'])
  product?: 'movements';

  @IsOptional()
  @IsIn(['cl'])
  country?: 'cl';
}
