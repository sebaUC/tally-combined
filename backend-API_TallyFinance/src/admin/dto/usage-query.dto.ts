import { IsOptional, IsInt, IsIn } from 'class-validator';
import { Transform } from 'class-transformer';

export class UsageQueryDto {
  @IsOptional()
  @IsInt()
  @IsIn([7, 14, 30])
  @Transform(({ value }) => parseInt(value, 10))
  days?: number = 7;
}
