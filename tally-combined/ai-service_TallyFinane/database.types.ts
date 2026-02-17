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
  public: {
    Tables: {
      categories: {
        Row: {
          created_at: string
          icon: string | null
          id: string
          name: string
          parent_id: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          icon?: string | null
          id?: string
          name: string
          parent_id?: string | null
          user_id: string
        }
        Update: {
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
          external_user_id: string | null
          token: string
          used_at: string | null
          user_id: string | null
        }
        Insert: {
          channel: string
          code: string
          created_at?: string
          expires_at: string
          external_user_id?: string | null
          token: string
          used_at?: string | null
          user_id?: string | null
        }
        Update: {
          channel?: string
          code?: string
          created_at?: string
          expires_at?: string
          external_user_id?: string | null
          token?: string
          used_at?: string | null
          user_id?: string | null
        }
        Relationships: []
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
      payment_method: {
        Row: {
          currency: string
          id: string
          institution: string | null
          name: string | null
          number_masked: string | null
          payment_type: Database["public"]["Enums"]["payment_type_t"]
          user_id: string | null
        }
        Insert: {
          currency?: string
          id?: string
          institution?: string | null
          name?: string | null
          number_masked?: string | null
          payment_type: Database["public"]["Enums"]["payment_type_t"]
          user_id?: string | null
        }
        Update: {
          currency?: string
          id?: string
          institution?: string | null
          name?: string | null
          number_masked?: string | null
          payment_type?: Database["public"]["Enums"]["payment_type_t"]
          user_id?: string | null
        }
        Relationships: [
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
          amount: number
          category_id: string | null
          created_at: string
          currency: string
          description: string | null
          id: number
          import_id: string | null
          merchant_id: string | null
          message_id: number | null
          metadata: Json | null
          payment_method_id: string
          posted_at: string
          source: Database["public"]["Enums"]["tx_source_t"]
          status: Database["public"]["Enums"]["tx_status_t"]
          user_id: string
        }
        Insert: {
          amount: number
          category_id?: string | null
          created_at?: string
          currency?: string
          description?: string | null
          id?: number
          import_id?: string | null
          merchant_id?: string | null
          message_id?: number | null
          metadata?: Json | null
          payment_method_id: string
          posted_at: string
          source?: Database["public"]["Enums"]["tx_source_t"]
          status?: Database["public"]["Enums"]["tx_status_t"]
          user_id: string
        }
        Update: {
          amount?: number
          category_id?: string | null
          created_at?: string
          currency?: string
          description?: string | null
          id?: number
          import_id?: string | null
          merchant_id?: string | null
          message_id?: number | null
          metadata?: Json | null
          payment_method_id?: string
          posted_at?: string
          source?: Database["public"]["Enums"]["tx_source_t"]
          status?: Database["public"]["Enums"]["tx_status_t"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "transactions_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_payment_method_id_fkey"
            columns: ["payment_method_id"]
            isOneToOne: false
            referencedRelation: "payment_method"
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
      show_limit: { Args: never; Returns: number }
      show_trgm: { Args: { "": string }; Returns: string[] }
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
      bot_tone_enum:
        | "neutral"
        | "friendly"
        | "serious"
        | "motivational"
        | "strict"
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
      bot_tone_enum: [
        "neutral",
        "friendly",
        "serious",
        "motivational",
        "strict",
      ],
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
