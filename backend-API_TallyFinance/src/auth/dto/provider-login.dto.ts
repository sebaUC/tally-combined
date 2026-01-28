import { IsNotEmpty, IsString, IsIn, IsOptional } from 'class-validator';
import type { Provider } from '@supabase/supabase-js';

export class ProviderLoginDto {
  @IsString()
  @IsNotEmpty({ message: 'Debe especificar un proveedor de autenticación.' })
  @IsIn(['google'], {
    message: 'Proveedor no válido. Use "google", "github" o "apple".',
  })
  provider: Provider;

  @IsOptional()
  @IsString()
  redirectTo?: string; // URL de redirección tras login OAuth
}
