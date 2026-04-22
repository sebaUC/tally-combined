import { Module } from '@nestjs/common';
import { SupabaseModule } from '../supabase/supabase.module';
import { CommonModule } from '../common/common.module';
import { OnboardingService } from './onboarding.service';

@Module({
  imports: [SupabaseModule, CommonModule],
  providers: [OnboardingService],
  exports: [OnboardingService],
})
export class OnboardingModule {}
