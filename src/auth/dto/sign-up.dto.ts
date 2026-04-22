import {
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MinLength,
} from 'class-validator';

// Min 12 chars + at least one lowercase, uppercase, digit, and symbol.
// Enforced on signup; existing weaker passwords stay valid until next
// change-password or reset-password, which both apply the new policy.
const STRONG_PASSWORD_REGEX =
  /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{12,}$/;

const STRONG_PASSWORD_MSG =
  'La contraseña debe tener al menos 12 caracteres e incluir mayúscula, minúscula, número y símbolo.';

export class SignUpDto {
  @IsEmail({}, { message: 'Debe proporcionar un correo electrónico válido.' })
  @IsNotEmpty({ message: 'El correo electrónico es obligatorio.' })
  email: string;

  @IsString()
  @MinLength(12, {
    message: 'La contraseña debe tener al menos 12 caracteres.',
  })
  @Matches(STRONG_PASSWORD_REGEX, { message: STRONG_PASSWORD_MSG })
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
