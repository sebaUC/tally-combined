import { IsEmail, IsNotEmpty, MinLength } from 'class-validator';

export class SignInDto {
  @IsEmail({}, { message: 'Debe ingresar un correo electrónico válido.' })
  email: string;

  @IsNotEmpty({ message: 'Debe ingresar una contraseña.' })
  @MinLength(6, { message: 'La contraseña debe tener al menos 6 caracteres.' })
  password: string;
}
