import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { ConnectController } from './connect.controller';
import { AuthService } from './auth.service';
import { SupabaseModule } from '../supabase/supabase.module';
import { JwtGuard } from './middleware/jwt.guard';
import { CommonModule } from '../common/common.module';
import { OnboardingModule } from '../onboarding/onboarding.module';
import { AuthProfileService } from './services/auth-profile.service';
import { AuthChannelService } from './services/auth-channel.service';

@Module({
  imports: [SupabaseModule, CommonModule, OnboardingModule],
  controllers: [AuthController, ConnectController],
  providers: [AuthService, JwtGuard, AuthProfileService, AuthChannelService],
  exports: [AuthService, JwtGuard, AuthProfileService, AuthChannelService],
})
export class AuthModule {}
