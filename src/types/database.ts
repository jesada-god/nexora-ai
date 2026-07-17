export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Currency = 'THB' | 'USD';
export type AppLanguage = 'th' | 'en';

export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string;
          full_name: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          full_name?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          full_name?: string | null;
          updated_at?: string;
        };
        Relationships: [];
      };
      user_settings: {
        Row: {
          user_id: string;
          base_currency: Currency;
          language: AppLanguage;
          price_alerts_enabled: boolean;
          daily_summary_enabled: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          user_id: string;
          base_currency?: Currency;
          language?: AppLanguage;
          price_alerts_enabled?: boolean;
          daily_summary_enabled?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          base_currency?: Currency;
          language?: AppLanguage;
          price_alerts_enabled?: boolean;
          daily_summary_enabled?: boolean;
          updated_at?: string;
        };
        Relationships: [];
      };
      watchlists: {
        Row: { id: string; user_id: string; name: string; created_at: string; updated_at: string };
        Insert: { id?: string; user_id: string; name?: string; created_at?: string; updated_at?: string };
        Update: { name?: string; updated_at?: string };
        Relationships: [];
      };
      watchlist_items: {
        Row: { id: string; watchlist_id: string; symbol: string; created_at: string };
        Insert: { id?: string; watchlist_id: string; symbol: string; created_at?: string };
        Update: { symbol?: string };
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: {
      delete_own_account: {
        Args: Record<PropertyKey, never>;
        Returns: undefined;
      };
      get_or_create_default_watchlist: {
        Args: Record<PropertyKey, never>;
        Returns: string;
      };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
}
