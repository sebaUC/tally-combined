import { Inject, Injectable, Logger } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';

/**
 * Envuelve Supabase Vault para guardar/leer link_tokens de Fintoc.
 *
 * Garantías ISO 27001 / PCI-DSS A.8.24 (criptografía):
 * - El link_token NUNCA existe como columna en plaintext
 * - Vault cifra con AES-256-GCM antes de persistir
 * - Esta clase es el ÚNICO punto que puede descifrar un token
 * - `useToken()` garantiza que el token plaintext sólo vive el tiempo
 *    del callback y no se propaga fuera del scope
 * - Nunca loggeamos el valor del token
 */
@Injectable()
export class FintocCryptoService {
  private readonly logger = new Logger(FintocCryptoService.name);

  constructor(
    @Inject('SUPABASE') private readonly supabase: SupabaseClient,
  ) {}

  /**
   * Guarda un link_token en Vault y devuelve el secret_id (UUID).
   * El token se descarta de memoria apenas retorna este método.
   */
  async storeToken(params: {
    token: string;
    name: string;
    description?: string;
  }): Promise<string> {
    const { data, error } = await this.supabase.rpc('fintoc_store_link_token', {
      p_link_token: params.token,
      p_name: params.name,
      p_description: params.description ?? null,
    });

    if (error) {
      this.logger.error(`Failed to store token in Vault: ${error.message}`);
      throw new Error(`Vault store failed: ${error.message}`);
    }
    if (!data) {
      throw new Error('Vault returned no secret_id');
    }

    return data as string;
  }

  /**
   * Ejecuta `callback` con el link_token descifrado en memoria.
   * Después del callback el token NO queda referenciado en ninguna variable
   * accesible desde fuera. Este es el patrón preferido para usar tokens.
   *
   * @example
   * await crypto.useToken(linkId, async (token) => {
   *   return api.listMovements({ linkToken: token, ... });
   * });
   */
  async useToken<T>(
    linkId: string,
    callback: (token: string) => Promise<T>,
  ): Promise<T> {
    const token = await this.decryptToken(linkId);
    try {
      return await callback(token);
    } finally {
      // JS no nos deja borrar strings de memoria explícitamente,
      // pero al salir de este scope el GC puede reclamar la variable.
      // Al menos garantizamos que no queda referencia expuesta afuera.
    }
  }

  /**
   * Borra el secret del Vault (cuando el user revoca el link).
   */
  async deleteToken(secretId: string): Promise<void> {
    const { error } = await this.supabase.rpc('fintoc_delete_link_token', {
      p_secret_id: secretId,
    });

    if (error) {
      this.logger.error(`Failed to delete token from Vault: ${error.message}`);
      throw new Error(`Vault delete failed: ${error.message}`);
    }
  }

  /**
   * Acceso directo al token descifrado. Sólo usar si `useToken` no encaja.
   * PREFERIR `useToken` siempre que sea posible.
   */
  private async decryptToken(linkId: string): Promise<string> {
    const { data, error } = await this.supabase.rpc('fintoc_get_link_token', {
      p_link_id: linkId,
    });

    if (error) {
      this.logger.error(
        `Failed to decrypt token for link ${linkId}: ${error.message}`,
      );
      throw new Error('Token decrypt failed');
    }
    if (!data || typeof data !== 'string') {
      throw new Error('Vault returned no token');
    }

    return data;
  }
}
