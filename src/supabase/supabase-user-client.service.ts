import { Injectable } from '@nestjs/common';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

/**
 * Factory for per-request Supabase clients that operate as a specific user.
 *
 * The global `SUPABASE` provider authenticates as `service_role` and bypasses
 * RLS — that's fine for backend-owned operations (admin reads, webhook
 * writes), but wrong for user-self-service flows like MFA enrollment,
 * password change, or any mutation that must be attributable to the user.
 *
 * This factory builds a client anchored to the caller's JWT. The client
 * uses the anon key for the apikey header and the user's access token as
 * the Authorization header, so Supabase treats calls as if the user made
 * them directly (RLS enforced, `auth.uid()` populated, MFA APIs available).
 */
@Injectable()
export class SupabaseUserClientFactory {
  private readonly url: string;
  private readonly anonKey: string;

  constructor() {
    const url = process.env.SUPABASE_URL;
    const anonKey = process.env.SUPABASE_ANON_KEY;
    if (!url) {
      throw new Error('SUPABASE_URL env var is required');
    }
    if (!anonKey) {
      throw new Error(
        'SUPABASE_ANON_KEY env var is required (needed for user-scoped ' +
          'operations such as MFA enrollment). Get it from Supabase ' +
          'Dashboard → Project Settings → API → anon public.',
      );
    }
    this.url = url;
    this.anonKey = anonKey;
  }

  create(accessToken: string): SupabaseClient {
    return createClient(this.url, this.anonKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
      global: {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      },
    });
  }
}
