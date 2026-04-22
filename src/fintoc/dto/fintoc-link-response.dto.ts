/**
 * Shape de las respuestas públicas del módulo Fintoc al frontend.
 * NUNCA incluye link_token ni secret_id — sólo IDs públicos y metadata.
 */

export interface FintocLinkPublicDto {
  id: string; // UUID local
  fintoc_link_id: string | null; // ID público de Fintoc (link_xxx)
  institution_id: string;
  institution_name: string | null;
  holder_name: string | null;
  status: string;
  last_refresh_at: string | null;
  created_at: string;
}

export interface FintocAccountPublicDto {
  id: string;
  name: string;
  institution: string | null;
  currency: string;
  current_balance: number;
  fintoc_account_id: string | null;
  last_synced_at: string | null;
}

export interface CreateLinkIntentResponseDto {
  widget_token: string;
  public_key: string;
}

export interface ExchangeTokenResponseDto {
  link: FintocLinkPublicDto;
  accounts: FintocAccountPublicDto[];
}
