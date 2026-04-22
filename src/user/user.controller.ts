import {
  Controller,
  Get,
  Post,
  Delete,
  Patch,
  Body,
  Query,
  UseGuards,
} from '@nestjs/common';
import { UsersService } from './user.service';
import { JwtGuard } from '../auth/middleware/jwt.guard';
import { User } from '../auth/decorators/user.decorator';

@Controller('api/users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @UseGuards(JwtGuard)
  @Get('me')
  async me(@User() user: any) {
    return this.users.getMe(user.id);
  }

  @UseGuards(JwtGuard)
  @Get('context')
  async context(@User() user: any) {
    return this.users.getContext(user.id);
  }

  @UseGuards(JwtGuard)
  @Get('transactions')
  async transactions(@User() user: any, @Query('limit') limit?: string) {
    const parsedLimit = Math.min(
      Math.max(parseInt(limit || '50', 10) || 50, 1),
      200,
    );
    return this.users.getTransactions(user.id, parsedLimit);
  }

  @UseGuards(JwtGuard)
  @Patch('settings')
  async updateSettings(
    @User() user: any,
    @Body()
    body: {
      tone?: string;
      intensity?: number;
      notification_level?: string;
      full_name?: string;
      nickname?: string;
      age?: number;
    },
  ) {
    const results: Record<string, any> = {};

    // Update users table if profile fields provided
    const profilePatch: Record<string, any> = {};
    if (body.full_name !== undefined) profilePatch.full_name = body.full_name;
    if (body.nickname !== undefined) profilePatch.nickname = body.nickname;
    if (body.age !== undefined) profilePatch.age = body.age;

    if (Object.keys(profilePatch).length > 0) {
      results.profile = await this.users.updateProfile(user.id, profilePatch);
    }

    // Update personality_snapshot if tone or intensity provided
    const personaPatch: Record<string, any> = {};
    if (body.tone) personaPatch.tone = body.tone;
    if (body.intensity !== undefined) personaPatch.intensity = body.intensity;

    if (Object.keys(personaPatch).length > 0) {
      results.personality = await this.users.updatePersona(
        user.id,
        personaPatch,
      );
    }

    // Update user_prefs if notification_level provided
    if (body.notification_level) {
      results.prefs = await this.users.updatePrefs(user.id, {
        notification_level: body.notification_level,
      });
    }

    return results;
  }

  @UseGuards(JwtGuard)
  @Post('adjust-balance')
  async adjustBalance(@User() user: any, @Body() body: { balance: number }) {
    if (body.balance == null || !isFinite(body.balance) || body.balance < 0) {
      return { error: 'Balance must be a non-negative number' };
    }
    return this.users.adjustBalance(user.id, body.balance);
  }

  @UseGuards(JwtGuard)
  @Delete('reset')
  async resetTransactions(@User() user: any) {
    return this.users.resetTransactions(user.id);
  }
}
