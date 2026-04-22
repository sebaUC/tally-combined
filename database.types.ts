export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "13.0.5"
  }
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      accounts: {
        Row: {
          created_at: string | null
          currency: string
          current_balance: number
          fintoc_account_id: string | null
          fintoc_link_id: string | null
          id: string
          institution: string | null
          last_synced_at: string | null
          name: string
          updated_at: string | null
          user_id: string
        }
        Insert: {
          created_at?: string | null
          currency?: string
          current_balance?: number
          fintoc_account_id?: string | null
          fintoc_link_id?: string | null
          id?: string
          institution?: string | null
          last_synced_at?: string | null
          name: string
          updated_at?: string | null
          user_id: string
        }
        Update: {
          created_at?: string | null
          currency?: string
          current_balance?: number
          fintoc_account_id?: string | null
          fintoc_link_id?: string | null
          id?: string
          institution?: string | null
          last_synced_at?: string | null
          name?: string
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "accounts_fintoc_link_id_fkey"
            columns: ["fintoc_link_id"]
            isOneToOne: false
            referencedRelation: "fintoc_links"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "accounts_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      bot_message_log: {
        Row: {
          bot_response: string | null
          channel: string | null
          created_at: string
          error: string | null
          id: string
          nudge_trigger: string | null
          phase_a_debug: Json | null
          phase_b_debug: Json | null
          tool_name: string | null
          user_id: string | null
          user_message: string
        }
        Insert: {
          bot_response?: string | null
          channel?: string | null
          created_at?: string
          error?: string | null
          id?: string
          nudge_trigger?: string | null
          phase_a_debug?: Json | null
          phase_b_debug?: Json | null
          tool_name?: string | null
          user_id?: string | null
          user_message: string
        }
        Update: {
          bot_response?: string | null
          channel?: string | null
          created_at?: string
          error?: string | null
          id?: string
          nudge_trigger?: string | null
          phase_a_debug?: Json | null
          phase_b_debug?: Json | null
          tool_name?: string | null
          user_id?: string | null
          user_message?: string
        }
        Relationships: []
      }
      categories: {
        Row: {
          budget: number
          created_at: string
          icon: string | null
          id: string
          name: string
          parent_id: string | null
          user_id: string
        }
        Insert: {
          budget?: number
          created_at?: string
          icon?: string | null
          id?: string
          name: string
          parent_id?: string | null
          user_id: string
        }
        Update: {
          budget?: number
          created_at?: string
          icon?: string | null
          id?: string
          name?: string
          parent_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "categories_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "categories_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      channel_accounts: {
        Row: {
          channel: Database["public"]["Enums"]["channel_t"]
          created_at: string
          external_user_id: string
          id: string
          user_id: string
          username: string | null
        }
        Insert: {
          channel: Database["public"]["Enums"]["channel_t"]
          created_at?: string
          external_user_id: string
          id?: string
          user_id: string
          username?: string | null
        }
        Update: {
          channel?: Database["public"]["Enums"]["channel_t"]
          created_at?: string
          external_user_id?: string
          id?: string
          user_id?: string
          username?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "channel_accounts_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      channel_link_codes: {
        Row: {
          channel: string
          code: string
          created_at: string
          expires_at: string
          external_user_id: string
          used_at: string | null
        }
        Insert: {
          channel: string
          code: string
          created_at?: string
          expires_at: string
          external_user_id: string
          used_at?: string | null
        }
        Update: {
          channel?: string
          code?: string
          created_at?: string
          expires_at?: string
          external_user_id?: string
          used_at?: string | null
        }
        Relationships: []
      }
      conversation_history: {
        Row: {
          action: string | null
          amount: number | null
          category: string | null
          channel: string | null
          content: string
          created_at: string
          id: string
          media_desc: string | null
          media_type: string | null
          role: string
          tool: string | null
          tx_id: string | null
          user_id: string
        }
        Insert: {
          action?: string | null
          amount?: number | null
          category?: string | null
          channel?: string | null
          content: string
          created_at?: string
          id?: string
          media_desc?: string | null
          media_type?: string | null
          role: string
          tool?: string | null
          tx_id?: string | null
          user_id: string
        }
        Update: {
          action?: string | null
          amount?: number | null
          category?: string | null
          channel?: string | null
          content?: string
          created_at?: string
          id?: string
          media_desc?: string | null
          media_type?: string | null
          role?: string
          tool?: string | null
          tx_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "conversation_history_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      fintoc_access_log: {
        Row: {
          action: string
          actor_id: string | null
          actor_type: string
          created_at: string
          detail: Json | null
          id: number
          ip_address: unknown
          link_id: string | null
          user_agent: string | null
          user_id: string | null
        }
        Insert: {
          action: string
          actor_id?: string | null
          actor_type: string
          created_at?: string
          detail?: Json | null
          id?: number
          ip_address?: unknown
          link_id?: string | null
          user_agent?: string | null
          user_id?: string | null
        }
        Update: {
          action?: string
          actor_id?: string | null
          actor_type?: string
          created_at?: string
          detail?: Json | null
          id?: number
          ip_address?: unknown
          link_id?: string | null
          user_agent?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "fintoc_access_log_link_id_fkey"
            columns: ["link_id"]
            isOneToOne: false
            referencedRelation: "fintoc_links"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fintoc_access_log_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      fintoc_links: {
        Row: {
          created_at: string
          fintoc_link_id: string | null
          holder_id: string | null
          holder_name: string | null
          id: string
          institution_id: string
          institution_name: string | null
          last_refresh_at: string | null
          last_webhook_at: string | null
          link_token_secret_id: string | null
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          fintoc_link_id?: string | null
          holder_id?: string | null
          holder_name?: string | null
          id?: string
          institution_id: string
          institution_name?: string | null
          last_refresh_at?: string | null
          last_webhook_at?: string | null
          link_token_secret_id?: string | null
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          fintoc_link_id?: string | null
          holder_id?: string | null
          holder_name?: string | null
          id?: string
          institution_id?: string
          institution_name?: string | null
          last_refresh_at?: string | null
          last_webhook_at?: string | null
          link_token_secret_id?: string | null
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "fintoc_links_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      goals: {
        Row: {
          created_at: string
          description: string | null
          id: string
          name: string
          progress_amount: number | null
          status: Database["public"]["Enums"]["goal_status_enum"]
          target_amount: number
          target_date: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          name: string
          progress_amount?: number | null
          status?: Database["public"]["Enums"]["goal_status_enum"]
          target_amount: number
          target_date?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          name?: string
          progress_amount?: number | null
          status?: Database["public"]["Enums"]["goal_status_enum"]
          target_amount?: number
          target_date?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "goals_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      income_expectations: {
        Row: {
          active: boolean | null
          amount: number | null
          created_at: string | null
          description: string | null
          id: string
          institution: string | null
          name: string | null
          pay_day: string | null
          period: string
          source: string | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          active?: boolean | null
          amount?: number | null
          created_at?: string | null
          description?: string | null
          id?: string
          institution?: string | null
          name?: string | null
          pay_day?: string | null
          period: string
          source?: string | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          active?: boolean | null
          amount?: number | null
          created_at?: string | null
          description?: string | null
          id?: string
          institution?: string | null
          name?: string | null
          pay_day?: string | null
          period?: string
          source?: string | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "income_expectations_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      merchants_global: {
        Row: {
          aliases: string[]
          created_at: string
          default_category: string | null
          embedding: string | null
          id: string
          logo_url: string | null
          name: string
          updated_at: string
          verified: boolean
        }
        Insert: {
          aliases?: string[]
          created_at?: string
          default_category?: string | null
          embedding?: string | null
          id?: string
          logo_url?: string | null
          name: string
          updated_at?: string
          verified?: boolean
        }
        Update: {
          aliases?: string[]
          created_at?: string
          default_category?: string | null
          embedding?: string | null
          id?: string
          logo_url?: string | null
          name?: string
          updated_at?: string
          verified?: boolean
        }
        Relationships: []
      }
      payment_method: {
        Row: {
          account_id: string | null
          currency: string
          fintoc_account_id: string | null
          fintoc_link_id: string | null
          id: string
          institution: string | null
          name: string | null
          number_masked: string | null
          payment_type: Database["public"]["Enums"]["payment_type_t"]
          user_id: string | null
        }
        Insert: {
          account_id?: string | null
          currency?: string
          fintoc_account_id?: string | null
          fintoc_link_id?: string | null
          id?: string
          institution?: string | null
          name?: string | null
          number_masked?: string | null
          payment_type: Database["public"]["Enums"]["payment_type_t"]
          user_id?: string | null
        }
        Update: {
          account_id?: string | null
          currency?: string
          fintoc_account_id?: string | null
          fintoc_link_id?: string | null
          id?: string
          institution?: string | null
          name?: string | null
          number_masked?: string | null
          payment_type?: Database["public"]["Enums"]["payment_type_t"]
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payment_method_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_method_fintoc_link_id_fkey"
            columns: ["fintoc_link_id"]
            isOneToOne: false
            referencedRelation: "fintoc_links"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_method_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      personality_snapshot: {
        Row: {
          intensity: number | null
          mood: Database["public"]["Enums"]["bot_mood_enum"]
          mood_updated_at: string | null
          tone: Database["public"]["Enums"]["bot_tone_enum"]
          updated_at: string
          user_id: string
        }
        Insert: {
          intensity?: number | null
          mood?: Database["public"]["Enums"]["bot_mood_enum"]
          mood_updated_at?: string | null
          tone?: Database["public"]["Enums"]["bot_tone_enum"]
          updated_at?: string
          user_id: string
        }
        Update: {
          intensity?: number | null
          mood?: Database["public"]["Enums"]["bot_mood_enum"]
          mood_updated_at?: string | null
          tone?: Database["public"]["Enums"]["bot_tone_enum"]
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "personality_snapshot_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      spending_expectations: {
        Row: {
          active: boolean | null
          amount: number | null
          created_at: string | null
          id: string
          period: string
          updated_at: string | null
          user_id: string
        }
        Insert: {
          active?: boolean | null
          amount?: number | null
          created_at?: string | null
          id?: string
          period: string
          updated_at?: string | null
          user_id: string
        }
        Update: {
          active?: boolean | null
          amount?: number | null
          created_at?: string | null
          id?: string
          period?: string
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "spending_expectations_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      transactions: {
        Row: {
          account_id: string | null
          amount: number
          auto_categorized: boolean
          category_id: string | null
          created_at: string
          currency: string
          description: string | null
          external_id: string | null
          fintoc_link_id: string | null
          id: number
          import_id: string | null
          income_expectation_id: string | null
          merchant_id: string | null
          merchant_name: string | null
          message_id: number | null
          metadata: Json | null
          name: string | null
          posted_at: string
          raw_description: string | null
          resolver_source: string | null
          source: Database["public"]["Enums"]["tx_source_t"]
          status: Database["public"]["Enums"]["tx_status_t"]
          transaction_at: string | null
          type: string
          user_id: string
        }
        Insert: {
          account_id?: string | null
          amount: number
          auto_categorized?: boolean
          category_id?: string | null
          created_at?: string
          currency?: string
          description?: string | null
          external_id?: string | null
          fintoc_link_id?: string | null
          id?: number
          import_id?: string | null
          income_expectation_id?: string | null
          merchant_id?: string | null
          merchant_name?: string | null
          message_id?: number | null
          metadata?: Json | null
          name?: string | null
          posted_at: string
          raw_description?: string | null
          resolver_source?: string | null
          source?: Database["public"]["Enums"]["tx_source_t"]
          status?: Database["public"]["Enums"]["tx_status_t"]
          transaction_at?: string | null
          type?: string
          user_id: string
        }
        Update: {
          account_id?: string | null
          amount?: number
          auto_categorized?: boolean
          category_id?: string | null
          created_at?: string
          currency?: string
          description?: string | null
          external_id?: string | null
          fintoc_link_id?: string | null
          id?: number
          import_id?: string | null
          income_expectation_id?: string | null
          merchant_id?: string | null
          merchant_name?: string | null
          message_id?: number | null
          metadata?: Json | null
          name?: string | null
          posted_at?: string
          raw_description?: string | null
          resolver_source?: string | null
          source?: Database["public"]["Enums"]["tx_source_t"]
          status?: Database["public"]["Enums"]["tx_status_t"]
          transaction_at?: string | null
          type?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "transactions_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_fintoc_link_id_fkey"
            columns: ["fintoc_link_id"]
            isOneToOne: false
            referencedRelation: "fintoc_links"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_income_expectation_id_fkey"
            columns: ["income_expectation_id"]
            isOneToOne: false
            referencedRelation: "income_expectations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_merchant_id_fkey"
            columns: ["merchant_id"]
            isOneToOne: false
            referencedRelation: "merchants_global"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      user_emotional_log: {
        Row: {
          confidence: number | null
          created_at: string
          emotion_detected: Database["public"]["Enums"]["emotion_t"]
          id: number
          message_id: number | null
          user_id: string
        }
        Insert: {
          confidence?: number | null
          created_at?: string
          emotion_detected: Database["public"]["Enums"]["emotion_t"]
          id?: number
          message_id?: number | null
          user_id: string
        }
        Update: {
          confidence?: number | null
          created_at?: string
          emotion_detected?: Database["public"]["Enums"]["emotion_t"]
          id?: number
          message_id?: number | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_emotional_log_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      user_merchant_preferences: {
        Row: {
          category_id: string
          last_used_at: string
          merchant_id: string
          times_used: number
          user_id: string
        }
        Insert: {
          category_id: string
          last_used_at?: string
          merchant_id: string
          times_used?: number
          user_id: string
        }
        Update: {
          category_id?: string
          last_used_at?: string
          merchant_id?: string
          times_used?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_merchant_preferences_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_merchant_preferences_merchant_id_fkey"
            columns: ["merchant_id"]
            isOneToOne: false
            referencedRelation: "merchants_global"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_merchant_preferences_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      user_prefs: {
        Row: {
          id: string
          notification_level: Database["public"]["Enums"]["notification_level_enum"]
          unified_balance: boolean | null
          updated_at: string | null
        }
        Insert: {
          id: string
          notification_level?: Database["public"]["Enums"]["notification_level_enum"]
          unified_balance?: boolean | null
          updated_at?: string | null
        }
        Update: {
          id?: string
          notification_level?: Database["public"]["Enums"]["notification_level_enum"]
          unified_balance?: boolean | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "user_prefs_id_fkey"
            columns: ["id"]
            isOneToOne: true
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      users: {
        Row: {
          auth_provider: string | null
          avatar_url: string | null
          created_at: string | null
          email: string | null
          full_name: string | null
          id: string
          is_active: boolean | null
          last_login_at: string | null
          locale: string | null
          nickname: string | null
          onboarding_completed: boolean
          package: Database["public"]["Enums"]["app_pkg_enum"]
          timezone: string | null
          updated_at: string | null
        }
        Insert: {
          auth_provider?: string | null
          avatar_url?: string | null
          created_at?: string | null
          email?: string | null
          full_name?: string | null
          id: string
          is_active?: boolean | null
          last_login_at?: string | null
          locale?: string | null
          nickname?: string | null
          onboarding_completed?: boolean
          package?: Database["public"]["Enums"]["app_pkg_enum"]
          timezone?: string | null
          updated_at?: string | null
        }
        Update: {
          auth_provider?: string | null
          avatar_url?: string | null
          created_at?: string | null
          email?: string | null
          full_name?: string | null
          id?: string
          is_active?: boolean | null
          last_login_at?: string | null
          locale?: string | null
          nickname?: string | null
          onboarding_completed?: boolean
          package?: Database["public"]["Enums"]["app_pkg_enum"]
          timezone?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      delete_user_account: { Args: { p_user_id: string }; Returns: undefined }
      fintoc_delete_link_token: {
        Args: { p_secret_id: string }
        Returns: undefined
      }
      fintoc_get_link_token: { Args: { p_link_id: string }; Returns: string }
      fintoc_store_link_token: {
        Args: { p_description?: string; p_link_token: string; p_name: string }
        Returns: string
      }
      show_limit: { Args: never; Returns: number }
      show_trgm: { Args: { "": string }; Returns: string[] }
      update_account_balance: {
        Args: { p_account_id: string; p_delta: number }
        Returns: undefined
      }
    }
    Enums: {
      app_pkg_enum: "basic" | "intermedio" | "avanzado"
      bot_mood_enum:
        | "normal"
        | "happy"
        | "disappointed"
        | "tired"
        | "hopeful"
        | "frustrated"
        | "proud"
      bot_tone_enum: "neutral" | "friendly" | "strict" | "toxic"
      channel_t: "telegram" | "whatsapp" | "web"
      emotion_t:
        | "neutral"
        | "feliz"
        | "triste"
        | "ansioso"
        | "enojado"
        | "estresado"
      goal_status_enum: "in_progress" | "completed" | "canceled"
      notification_level_enum: "none" | "light" | "medium" | "intense"
      payment_type_t: "credito" | "debito"
      tx_source_t:
        | "manual"
        | "chat_intent"
        | "import"
        | "bank_api"
        | "ai_extraction"
      tx_status_t: "posted" | "pending" | "voided"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      app_pkg_enum: ["basic", "intermedio", "avanzado"],
      bot_mood_enum: [
        "normal",
        "happy",
        "disappointed",
        "tired",
        "hopeful",
        "frustrated",
        "proud",
      ],
      bot_tone_enum: ["neutral", "friendly", "strict", "toxic"],
      channel_t: ["telegram", "whatsapp", "web"],
      emotion_t: [
        "neutral",
        "feliz",
        "triste",
        "ansioso",
        "enojado",
        "estresado",
      ],
      goal_status_enum: ["in_progress", "completed", "canceled"],
      notification_level_enum: ["none", "light", "medium", "intense"],
      payment_type_t: ["credito", "debito"],
      tx_source_t: [
        "manual",
        "chat_intent",
        "import",
        "bank_api",
        "ai_extraction",
      ],
      tx_status_t: ["posted", "pending", "voided"],
    },
  },
} as const
