import {
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  MinLength,
} from 'class-validator';

export class SignUpDto {
  @IsEmail({}, { message: 'Debe proporcionar un correo electrónico válido.' })
  @IsNotEmpty({ message: 'El correo electrónico es obligatorio.' })
  email: string;

  @IsString()
  @MinLength(6, { message: 'La contraseña debe tener al menos 6 caracteres.' })
  password: string;

  @IsString()
  @IsNotEmpty({ message: 'El nombre completo es obligatorio.' })
  fullName: string;

  @IsOptional()
  @IsString()
  nickname?: string;

  @IsOptional()
  @IsString()
  locale?: string; // Ejemplo: 'es-CL'

  @IsOptional()
  @IsString()
  timezone?: string; // Ejemplo: 'America/Santiago'
}
