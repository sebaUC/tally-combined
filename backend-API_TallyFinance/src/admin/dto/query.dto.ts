import { IsOptional, IsString, IsInt, Min, Max, IsUUID, IsDateString } from 'class-validator';
import { Transform } from 'class-transformer';

export class MessagesQueryDto {
  @IsOptional()
  @IsUUID()
  userId?: string;

  @IsOptional()
  @IsString()
  channel?: string;

  @IsOptional()
  @IsDateString()
  from?: string; // ISO date string

  @IsOptional()
  @IsDateString()
  to?: string; // ISO date string

  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === '1')
  hasError?: boolean;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  @Transform(({ value }) => parseInt(value, 10))
  limit?: number = 50;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Transform(({ value }) => parseInt(value, 10))
  offset?: number = 0;
}

export class DashboardQueryDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(168) // Max 7 days
  @Transform(({ value }) => parseInt(value, 10))
  hours?: number = 24;
}
