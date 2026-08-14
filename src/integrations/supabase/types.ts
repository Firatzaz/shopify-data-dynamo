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
    PostgrestVersion: "14.15"
  }
  public: {
    Tables: {
      event_log: {
        Row: {
          created_at: string
          dry_run: boolean
          entity_id: string | null
          entity_type: string
          field: string | null
          id: string
          message: string | null
          new_value: string | null
          old_value: string | null
          origin_store_id: string | null
          payload: Json | null
          sku: string | null
          source: string
          status: string
          store_id: string | null
          user_id: string
          webhook_id: string | null
        }
        Insert: {
          created_at?: string
          dry_run?: boolean
          entity_id?: string | null
          entity_type: string
          field?: string | null
          id?: string
          message?: string | null
          new_value?: string | null
          old_value?: string | null
          origin_store_id?: string | null
          payload?: Json | null
          sku?: string | null
          source: string
          status?: string
          store_id?: string | null
          user_id: string
          webhook_id?: string | null
        }
        Update: {
          created_at?: string
          dry_run?: boolean
          entity_id?: string | null
          entity_type?: string
          field?: string | null
          id?: string
          message?: string | null
          new_value?: string | null
          old_value?: string | null
          origin_store_id?: string | null
          payload?: Json | null
          sku?: string | null
          source?: string
          status?: string
          store_id?: string | null
          user_id?: string
          webhook_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "event_log_origin_store_id_fkey"
            columns: ["origin_store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_log_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      oauth_states: {
        Row: {
          created_at: string
          label: string | null
          role: string
          shopify_domain: string
          state: string
          user_id: string
        }
        Insert: {
          created_at?: string
          label?: string | null
          role?: string
          shopify_domain: string
          state: string
          user_id: string
        }
        Update: {
          created_at?: string
          label?: string | null
          role?: string
          shopify_domain?: string
          state?: string
          user_id?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          created_at: string
          email: string | null
          full_name: string | null
          id: string
        }
        Insert: {
          created_at?: string
          email?: string | null
          full_name?: string | null
          id: string
        }
        Update: {
          created_at?: string
          email?: string | null
          full_name?: string | null
          id?: string
        }
        Relationships: []
      }
      snapshot_archives: {
        Row: {
          checksum: string | null
          full_state: Json
          id: string
          is_verified: boolean
          source: string | null
          store_id: string | null
          taken_at: string
          user_id: string
        }
        Insert: {
          checksum?: string | null
          full_state?: Json
          id?: string
          is_verified?: boolean
          source?: string | null
          store_id?: string | null
          taken_at?: string
          user_id: string
        }
        Update: {
          checksum?: string | null
          full_state?: Json
          id?: string
          is_verified?: boolean
          source?: string | null
          store_id?: string | null
          taken_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "snapshot_archives_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      snapshots: {
        Row: {
          event_log_range_end: string | null
          event_log_range_start: string | null
          id: string
          reason: string | null
          store_id: string | null
          taken_at: string
          user_id: string
        }
        Insert: {
          event_log_range_end?: string | null
          event_log_range_start?: string | null
          id?: string
          reason?: string | null
          store_id?: string | null
          taken_at?: string
          user_id: string
        }
        Update: {
          event_log_range_end?: string | null
          event_log_range_start?: string | null
          id?: string
          reason?: string | null
          store_id?: string | null
          taken_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "snapshots_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      stores: {
        Row: {
          access_token_encrypted: string | null
          api_version: string
          created_at: string
          id: string
          installed_at: string | null
          label: string | null
          last_sync_at: string | null
          role: string
          scope: string | null
          shopify_domain: string
          status: string
          user_id: string
        }
        Insert: {
          access_token_encrypted?: string | null
          api_version?: string
          created_at?: string
          id?: string
          installed_at?: string | null
          label?: string | null
          last_sync_at?: string | null
          role?: string
          scope?: string | null
          shopify_domain: string
          status?: string
          user_id: string
        }
        Update: {
          access_token_encrypted?: string | null
          api_version?: string
          created_at?: string
          id?: string
          installed_at?: string | null
          label?: string | null
          last_sync_at?: string | null
          role?: string
          scope?: string | null
          shopify_domain?: string
          status?: string
          user_id?: string
        }
        Relationships: []
      }
      sync_queue: {
        Row: {
          attempts: number
          created_at: string
          id: string
          last_error: string | null
          payload: Json
          processed_at: string | null
          status: string
          store_id: string | null
          user_id: string | null
          webhook_id: string | null
          webhook_topic: string
        }
        Insert: {
          attempts?: number
          created_at?: string
          id?: string
          last_error?: string | null
          payload?: Json
          processed_at?: string | null
          status?: string
          store_id?: string | null
          user_id?: string | null
          webhook_id?: string | null
          webhook_topic: string
        }
        Update: {
          attempts?: number
          created_at?: string
          id?: string
          last_error?: string | null
          payload?: Json
          processed_at?: string | null
          status?: string
          store_id?: string | null
          user_id?: string | null
          webhook_id?: string | null
          webhook_topic?: string
        }
        Relationships: [
          {
            foreignKeyName: "sync_queue_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      sync_rules: {
        Row: {
          active: boolean
          buffer_quantity: number
          created_at: string
          destination_store_id: string
          dry_run: boolean
          field_toggles: Json
          id: string
          source_store_id: string
          user_id: string
        }
        Insert: {
          active?: boolean
          buffer_quantity?: number
          created_at?: string
          destination_store_id: string
          dry_run?: boolean
          field_toggles?: Json
          id?: string
          source_store_id: string
          user_id: string
        }
        Update: {
          active?: boolean
          buffer_quantity?: number
          created_at?: string
          destination_store_id?: string
          dry_run?: boolean
          field_toggles?: Json
          id?: string
          source_store_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "sync_rules_destination_store_id_fkey"
            columns: ["destination_store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sync_rules_source_store_id_fkey"
            columns: ["source_store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
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
    Enums: {},
  },
} as const
