import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';

@Injectable()
export class AuthProfileService {
  private readonly logger = new Logger(AuthProfileService.name);

  constructor(@Inject('SUPABASE') private readonly supabase: SupabaseClient) {}

  async getUser(jwt: string) {
    const { data, error } = await this.supabase.auth.getUser(jwt);
    if (error) throw new BadRequestException(error.message);
    if (!data?.user)
      throw new BadRequestException('Usuario no encontrado o token inválido.');
    return data.user;
  }

  async getUserProfile(userId: string) {
    const { data, error } = await this.supabase
      .from('users')
      .select('*')
      .eq('id', userId)
      .single();

    if (error) throw new BadRequestException(error.message);
    if (!data)
      throw new BadRequestException('Perfil de usuario no encontrado.');

    return data;
  }

  async getUserFullProfile(jwt: string) {
    const { data: authData, error: authError } =
      await this.supabase.auth.getUser(jwt);
    if (authError) throw new BadRequestException(authError.message);

    const userId = authData?.user?.id;
    if (!userId) throw new BadRequestException('Usuario no encontrado.');

    const { data: profile, error: profileError } = await this.supabase
      .from('users')
      .select('*')
      .eq('id', userId)
      .single();

    if (profileError) throw new BadRequestException(profileError.message);
    if (!profile)
      throw new BadRequestException('Perfil de usuario no encontrado.');

    this.logger.log(`[profile] Loaded full profile for user ${userId}`);
    return { ...authData.user, profile };
  }

  async getUserSessions(userId: string) {
    const { data, error } = await this.supabase
      .from('my_sessions')
      .select('id, created_at, refreshed_at, not_after, user_agent, ip, tag')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (error) {
      this.logger.warn(
        `[sessions] Failed to fetch sessions for ${userId}: ${error.message}`,
      );
      throw new BadRequestException(error.message);
    }

    return data ?? [];
  }
}
