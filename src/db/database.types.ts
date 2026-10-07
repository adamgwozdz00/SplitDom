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
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      add_expense: {
        Args: {
          p_amount: number
          p_created_at: string
          p_expense_id: string
          p_group_id: string
          p_payer_id: string
          p_period_id: string
          p_purchased_on: string
          p_shares: Json
          p_title: string
        }
        Returns: undefined
      }
      add_group: {
        Args: {
          p_group_id: string
          p_host_id: string
          p_name: string
          p_now: string
        }
        Returns: undefined
      }
      create_group: {
        Args: {
          p_group_id: string
          p_host_id: string
          p_name: string
          p_now: string
          p_period_id: string
          p_period_month: string
        }
        Returns: undefined
      }
      create_group_invite: {
        Args: {
          p_created_at: string
          p_created_by: string
          p_expires_at: string
          p_group_id: string
          p_invite_id: string
          p_token: string
        }
        Returns: undefined
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
      get_group_invite: { Args: { p_token: string }; Returns: Json }
      get_invite_preview: { Args: { p_token_hash: string }; Returns: Json }
      get_my_group: { Args: { p_group_id: string }; Returns: Json }
      list_my_group_aggregates: { Args: never; Returns: Json }
      list_my_groups: { Args: never; Returns: Json }
      list_my_open_billing_months: { Args: never; Returns: Json }
      list_period_expenses: {
        Args: { p_group_id: string; p_period_id: string }
        Returns: Json
      }
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
      redeem_group_invite: {
        Args: { p_token: string; p_used_at: string }
        Returns: Json
      }
      save_billing_period: {
        Args: {
          p_expected_version: number
          p_expenses: Json
          p_group_id: string
          p_period_id: string
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

