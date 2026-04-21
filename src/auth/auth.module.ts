import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { ConnectController } from './connect.controller';
import { MfaController } from './mfa.controller';
import { AuthService } from './auth.service';
import { SupabaseModule } from '../supabase/supabase.module';
import { JwtGuard } from './middleware/jwt.guard';
import { MfaRequiredGuard } from './middleware/mfa.guard';
import { CommonModule } from '../common/common.module';
import { OnboardingModule } from '../onboarding/onboarding.module';
import { AuthProfileService } from './services/auth-profile.service';
import { AuthChannelService } from './services/auth-channel.service';
import { MfaService } from './services/mfa.service';

@Module({
  imports: [SupabaseModule, CommonModule, OnboardingModule],
  controllers: [AuthController, ConnectController, MfaController],
  providers: [
    AuthService,
    JwtGuard,
    MfaRequiredGuard,
    AuthProfileService,
    AuthChannelService,
    MfaService,
  ],
  exports: [
    AuthService,
    JwtGuard,
    MfaRequiredGuard,
    AuthProfileService,
    AuthChannelService,
    MfaService,
  ],
})
export class AuthModule {}
