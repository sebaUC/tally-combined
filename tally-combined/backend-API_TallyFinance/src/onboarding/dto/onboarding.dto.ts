import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export const notificationLevels = [
  'none',
  'light',
  'medium',
  'intense',
] as const;
export type NotificationLevel = (typeof notificationLevels)[number];

export const botTones = [
  'neutral',
  'friendly',
  'serious',
  'motivational',
  'strict',
] as const;
export type BotTone = (typeof botTones)[number];

class PersonalityDto {
  @IsEnum(botTones)
  tone: BotTone;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(1)
  intensity: number;
}

class SubCategoryDto {
  @IsString()
  name: string;

  @IsOptional()
  @IsString()
  icon?: string;
}

class CategoryDto {
  @IsString()
  name: string;

  @IsOptional()
  @IsString()
  icon?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SubCategoryDto)
  children?: SubCategoryDto[];
}

const goalStatuses = ['in_progress', 'completed', 'canceled'] as const;
type GoalStatus = (typeof goalStatuses)[number];

class GoalDto {
  @IsOptional()
  @IsString()
  id?: string;

  @IsString()
  name: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  targetAmount?: number;

  @IsOptional()
  @IsString()
  targetDate?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  progressAmount?: number;

  @IsOptional()
  @IsEnum(goalStatuses)
  status?: GoalStatus;
}

class SpendingEntryDto {
  @IsBoolean()
  active: boolean;

  @IsString()
  amount: string;
}

class SpendingExpectationsDto {
  @ValidateNested()
  @Type(() => SpendingEntryDto)
  daily: SpendingEntryDto;

  @ValidateNested()
  @Type(() => SpendingEntryDto)
  weekly: SpendingEntryDto;

  @ValidateNested()
  @Type(() => SpendingEntryDto)
  monthly: SpendingEntryDto;
}

const paymentTypes = ['credito', 'debito'] as const;
type PaymentType = (typeof paymentTypes)[number];

class PaymentMethodDto {
  @IsString()
  name: string;

  @IsString()
  institution: string;

  @IsEnum(paymentTypes)
  payment_type: PaymentType;

  @IsString()
  currency: string;

  @IsOptional()
  @IsString()
  number_masked?: string;
}

export class OnboardingAnswers {
  @IsEnum(notificationLevels)
  notifications: NotificationLevel;

  @IsBoolean()
  unifiedBalance: boolean;

  @ValidateNested()
  @Type(() => PersonalityDto)
  personality: PersonalityDto;

  @IsObject()
  @ValidateNested()
  @Type(() => SpendingExpectationsDto)
  spendingExpectations: SpendingExpectationsDto;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @ArrayMaxSize(50)
  @Type(() => CategoryDto)
  categories?: CategoryDto[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @ArrayMaxSize(20)
  @Type(() => GoalDto)
  goals?: GoalDto[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @ArrayMaxSize(20)
  @Type(() => PaymentMethodDto)
  payment_method?: PaymentMethodDto[];
}

export class OnboardingDto {
  @IsObject()
  @ValidateNested()
  @Type(() => OnboardingAnswers)
  answers: OnboardingAnswers;
}
