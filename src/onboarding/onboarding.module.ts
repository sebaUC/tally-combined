import { Module } from '@nestjs/common';
import { SupabaseModule } from '../supabase/supabase.module';
import { CommonModule } from '../common/common.module';
import { InsightsModule } from '../insights/insights.module';
import { OnboardingService } from './onboarding.service';

@Module({
  imports: [SupabaseModule, CommonModule, InsightsModule],
  providers: [OnboardingService],
  exports: [OnboardingService],
})
export class OnboardingModule {}
