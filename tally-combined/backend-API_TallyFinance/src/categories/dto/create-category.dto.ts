import {
  IsString,
  MinLength,
  MaxLength,
  IsOptional,
  IsUUID,
} from 'class-validator';

export class CreateCategoryDto {
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name: string;

  @IsOptional()
  @IsString()
  @MaxLength(10)
  icon?: string;

  @IsOptional()
  @IsUUID()
  parentId?: string;
}
