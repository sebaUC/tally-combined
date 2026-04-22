/**
 * Tipos del payload de Fintoc (objetos que recibimos de su API).
 * Basados en https://docs.fintoc.com (v1).
 */

export interface FintocLinkIntent {
  id: string;
  widget_token: string;
  mode: 'test' | 'live';
  created_at: string;
}

export interface FintocInstitution {
  id: string;
  name: string;
  country: string;
}

export interface FintocLink {
  id: string;
  link_token: string;
  mode: 'test' | 'live';
  institution: FintocInstitution;
  holder_id?: string | null;
  holder_name?: string | null;
  created_at: string;
}

export interface FintocAccount {
  id: string;
  object: 'account';
  type: 'checking_account' | 'savings_account' | 'credit_card' | string;
  name: string;
  official_name?: string | null;
  number?: string | null;
  holder_id?: string | null;
  holder_name?: string | null;
  currency: string;
  balance: {
    available: number; // centavos
    current: number; // centavos
  };
}

export interface FintocMovementAccountRef {
  holder_id?: string | null;
  number?: string | null;
  institution: {
    id: string;
    name: string;
    country: string;
  };
  holder_name?: string | null;
}

export interface FintocMovement {
  id: string;
  object: 'movement';
  amount: number; // centavos, signo indica gasto(-) o ingreso(+)
  currency: string;
  description: string;
  post_date: string; // ISO-8601
  transaction_date?: string | null;
  type: 'transfer' | 'check' | 'other';
  status: 'confirmed' | 'processing' | 'reversed' | 'duplicated';
  pending: boolean;
  recipient_account?: FintocMovementAccountRef | null;
  sender_account?: FintocMovementAccountRef | null;
  comment?: string | null;
  reference_id?: string | null;
  transfer_id?: string | null;
  document_number?: string | null;
}

export interface FintocWebhookEvent {
  id: string; // evt_...
  type: string;
  mode: 'test' | 'live';
  created_at?: string;
  data?: Record<string, unknown>;
}

export interface FintocRefreshIntent {
  id: string;
  object: 'refresh_intent';
  refreshed_object: string;
  status: 'created' | 'succeeded' | 'failed' | 'rejected';
  type: 'only_last' | 'historical';
}
