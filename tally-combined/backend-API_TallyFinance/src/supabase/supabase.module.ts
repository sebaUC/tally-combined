// src/supabase/supabase.module.ts
import { Module, Global } from '@nestjs/common';
import { createClient } from '@supabase/supabase-js';

@Global()
@Module({
  providers: [
    {
      provide: 'SUPABASE',
      useFactory: () => {
        const url = process.env.SUPABASE_URL;
        const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

        if (!url || !serviceKey) {
          throw new Error(
            'SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY no configurados',
          );
        }

        return createClient(url, serviceKey, {
          auth: {
            autoRefreshToken: false,
            persistSession: false,
          },
          global: {
            headers: {
              Authorization: `Bearer ${serviceKey}`,
              apikey: serviceKey,
            },
          },
        });
      },
    },
  ],
  exports: ['SUPABASE'],
})
export class SupabaseModule {}
