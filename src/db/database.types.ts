export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  public: {
    Tables: {
      billing_periods: {
        Row: {
          closed_at: string | null
          group_id: string
          id: string
          month: string
          opened_at: string
          version: number
        }
        Insert: {
          closed_at?: string | null
          group_id: string
          id: string
          month: string
          opened_at: string
          version?: number
        }
        Update: {
          closed_at?: string | null
          group_id?: string
          id?: string
          month?: string
          opened_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "billing_periods_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "groups"
            referencedColumns: ["id"]
          },
        ]
      }
      expense_shares: {
        Row: {
          amount: number
          expense_id: string
          group_id: string
          user_id: string
        }
        Insert: {
          amount: number
          expense_id: string
          group_id: string
          user_id: string
        }
        Update: {
          amount?: number
          expense_id?: string
          group_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "expense_shares_expense_id_group_id_fkey"
            columns: ["expense_id", "group_id"]
            isOneToOne: false
            referencedRelation: "expenses"
            referencedColumns: ["id", "group_id"]
          },
          {
            foreignKeyName: "expense_shares_group_id_user_id_fkey"
            columns: ["group_id", "user_id"]
            isOneToOne: false
            referencedRelation: "group_members"
            referencedColumns: ["group_id", "user_id"]
          },
        ]
      }
      expenses: {
        Row: {
          amount: number
          created_at: string
          group_id: string
          id: string
          payer_id: string
          period_id: string
          purchased_on: string
          title: string
        }
        Insert: {
          amount: number
          created_at: string
          group_id: string
          id: string
          payer_id: string
          period_id: string
          purchased_on: string
          title: string
        }
        Update: {
          amount?: number
          created_at?: string
          group_id?: string
          id?: string
          payer_id?: string
          period_id?: string
          purchased_on?: string
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "expenses_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expenses_group_id_payer_id_fkey"
            columns: ["group_id", "payer_id"]
            isOneToOne: false
            referencedRelation: "group_members"
            referencedColumns: ["group_id", "user_id"]
          },
          {
            foreignKeyName: "expenses_period_id_group_id_fkey"
            columns: ["period_id", "group_id"]
            isOneToOne: false
            referencedRelation: "billing_periods"
            referencedColumns: ["id", "group_id"]
          },
        ]
      }
      group_invites: {
        Row: {
          created_at: string
          created_by: string
          expires_at: string
          group_id: string
          id: string
          token_hash: string
          used_at: string | null
          used_by: string | null
        }
        Insert: {
          created_at: string
          created_by: string
          expires_at: string
          group_id: string
          id: string
          token_hash: string
          used_at?: string | null
          used_by?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string
          expires_at?: string
          group_id?: string
          id?: string
          token_hash?: string
          used_at?: string | null
          used_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "group_invites_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "groups"
            referencedColumns: ["id"]
          },
        ]
      }
      group_members: {
        Row: {
          group_id: string
          joined_at: string
          user_id: string
        }
        Insert: {
          group_id: string
          joined_at: string
          user_id: string
        }
        Update: {
          group_id?: string
          joined_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "group_members_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "groups"
            referencedColumns: ["id"]
          },
        ]
      }
      groups: {
        Row: {
          created_at: string
          host_id: string
          id: string
          name: string
          version: number
        }
        Insert: {
          created_at: string
          host_id: string
          id: string
          name: string
          version?: number
        }
        Update: {
          created_at?: string
          host_id?: string
          id?: string
          name?: string
          version?: number
        }
        Relationships: []
      }
      member_profiles: {
        Row: {
          account_number: string | null
          display_name: string | null
          updated_at: string
          user_id: string
          version: number
        }
        Insert: {
          account_number?: string | null
          display_name?: string | null
          updated_at?: string
          user_id: string
          version?: number
        }
        Update: {
          account_number?: string | null
          display_name?: string | null
          updated_at?: string
          user_id?: string
          version?: number
        }
        Relationships: []
      }
      opening_debts: {
        Row: {
          amount: number
          creditor_id: string
          debtor_id: string
          group_id: string
          period_id: string
        }
        Insert: {
          amount: number
          creditor_id: string
          debtor_id: string
          group_id: string
          period_id: string
        }
        Update: {
          amount?: number
          creditor_id?: string
          debtor_id?: string
          group_id?: string
          period_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "opening_debts_group_id_creditor_id_fkey"
            columns: ["group_id", "creditor_id"]
            isOneToOne: false
            referencedRelation: "group_members"
            referencedColumns: ["group_id", "user_id"]
          },
          {
            foreignKeyName: "opening_debts_group_id_debtor_id_fkey"
            columns: ["group_id", "debtor_id"]
            isOneToOne: false
            referencedRelation: "group_members"
            referencedColumns: ["group_id", "user_id"]
          },
          {
            foreignKeyName: "opening_debts_period_id_group_id_fkey"
            columns: ["period_id", "group_id"]
            isOneToOne: false
            referencedRelation: "billing_periods"
            referencedColumns: ["id", "group_id"]
          },
        ]
      }
      payments: {
        Row: {
          amount: number
          confirmed_at: string | null
          group_id: string
          id: string
          period_id: string
          recipient_id: string
          rejected_at: string | null
          sender_id: string
          sent_at: string
        }
        Insert: {
          amount: number
          confirmed_at?: string | null
          group_id: string
          id: string
          period_id: string
          recipient_id: string
          rejected_at?: string | null
          sender_id: string
          sent_at: string
        }
        Update: {
          amount?: number
          confirmed_at?: string | null
          group_id?: string
          id?: string
          period_id?: string
          recipient_id?: string
          rejected_at?: string | null
          sender_id?: string
          sent_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "payments_group_id_recipient_id_fkey"
            columns: ["group_id", "recipient_id"]
            isOneToOne: false
            referencedRelation: "group_members"
            referencedColumns: ["group_id", "user_id"]
          },
          {
            foreignKeyName: "payments_group_id_sender_id_fkey"
            columns: ["group_id", "sender_id"]
            isOneToOne: false
            referencedRelation: "group_members"
            referencedColumns: ["group_id", "user_id"]
          },
          {
            foreignKeyName: "payments_period_id_group_id_fkey"
            columns: ["period_id", "group_id"]
            isOneToOne: false
            referencedRelation: "billing_periods"
            referencedColumns: ["id", "group_id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      add_group: {
        Args: {
          p_group_id: string
          p_host_id: string
          p_name: string
          p_now: string
        }
        Returns: undefined
      }
      close_billing_period: {
        Args: {
          p_closed_at: string
          p_expected_version: number
          p_group_id: string
          p_moved: string[]
          p_next_month: string
          p_next_opened_at: string
          p_next_period_id: string
          p_opening: Json
          p_period_id: string
        }
        Returns: boolean
      }
      get_current_billing_period: {
        Args: { p_group_id: string }
        Returns: Json
      }
      get_group_aggregate: { Args: { p_group_id: string }; Returns: Json }
      get_group_by_invite_token: {
        Args: { p_token_hash: string }
        Returns: Json
      }
      get_group_member_account_numbers: {
        Args: { p_group_id: string; p_user_ids: string[] }
        Returns: Json
      }
      get_group_member_display_names: {
        Args: { p_group_id: string; p_user_ids: string[] }
        Returns: Json
      }
      get_invite_preview: { Args: { p_token_hash: string }; Returns: Json }
      get_my_member_profile: { Args: never; Returns: Json }
      list_my_group_aggregates: { Args: never; Returns: Json }
      list_my_open_billing_months: { Args: never; Returns: Json }
      open_billing_period: {
        Args: {
          p_group_id: string
          p_month: string
          p_opened_at: string
          p_period_id: string
          p_version: number
        }
        Returns: undefined
      }
      save_billing_period_with_confirmations: {
        Args: {
          p_added: Json
          p_changed: Json
          p_confirmed: Json
          p_expected_version: number
          p_group_id: string
          p_period_id: string
          p_rejected: Json
          p_removed: string[]
          p_sent: Json
          p_withdrawn: string[]
        }
        Returns: boolean
      }
      save_group: {
        Args: {
          p_expected_version: number
          p_group_id: string
          p_new_invites: Json
          p_new_members: Json
          p_used_invites: Json
        }
        Returns: boolean
      }
      save_my_member_profile: {
        Args: { p_account_number?: string; p_expected_version: number }
        Returns: boolean
      }
      save_my_member_profile_with_display_name: {
        Args: {
          p_account_number?: string
          p_display_name?: string
          p_expected_version: number
        }
        Returns: boolean
      }
    }
    Enums: {
      [_ in never]: never
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const

