/**
 * Hand-written Supabase Database types. Must match supabase/migrations exactly
 * (same shape `supabase gen types typescript` produces). Update together with migrations.
 */
export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Database = {
  __InternalSupabase: {
    PostgrestVersion: "13.0.5";
  };
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string;
          email: string;
          full_name: string | null;
          role: Database["public"]["Enums"]["app_role"];
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          email: string;
          full_name?: string | null;
          role?: Database["public"]["Enums"]["app_role"];
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          email?: string;
          full_name?: string | null;
          role?: Database["public"]["Enums"]["app_role"];
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      businesses: {
        Row: {
          id: string;
          name: string;
          station_name: string;
          name_pronunciation: string | null;
          station_name_pronunciation: string | null;
          contact_email: string | null;
          announcement_language: string;
          logo_path: string | null;
          is_active: boolean;
          announcement_every_n_tracks: number;
          announcement_volume: number;
          branding_version: number;
          business_type: Database["public"]["Enums"]["business_type"];
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          station_name: string;
          name_pronunciation?: string | null;
          station_name_pronunciation?: string | null;
          contact_email?: string | null;
          announcement_language?: string;
          logo_path?: string | null;
          is_active?: boolean;
          announcement_every_n_tracks?: number;
          announcement_volume?: number;
          branding_version?: number;
          business_type?: Database["public"]["Enums"]["business_type"];
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          name?: string;
          station_name?: string;
          name_pronunciation?: string | null;
          station_name_pronunciation?: string | null;
          contact_email?: string | null;
          announcement_language?: string;
          logo_path?: string | null;
          is_active?: boolean;
          announcement_every_n_tracks?: number;
          announcement_volume?: number;
          branding_version?: number;
          business_type?: Database["public"]["Enums"]["business_type"];
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      business_members: {
        Row: {
          business_id: string;
          user_id: string;
          created_at: string;
        };
        Insert: {
          business_id: string;
          user_id: string;
          created_at?: string;
        };
        Update: {
          business_id?: string;
          user_id?: string;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "business_members_business_id_fkey";
            columns: ["business_id"];
            isOneToOne: false;
            referencedRelation: "businesses";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "business_members_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: true;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      genres: {
        Row: {
          id: string;
          name: string;
          slug: string;
          description: string | null;
          sort_order: number;
          is_enabled: boolean;
          available_to_all: boolean;
          /** Object path in the private `genre-covers` bucket, or null (default artwork). */
          cover_path: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          slug: string;
          description?: string | null;
          sort_order?: number;
          is_enabled?: boolean;
          available_to_all?: boolean;
          cover_path?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          name?: string;
          slug?: string;
          description?: string | null;
          sort_order?: number;
          is_enabled?: boolean;
          available_to_all?: boolean;
          cover_path?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      business_genre_access: {
        Row: {
          business_id: string;
          genre_id: string;
          created_at: string;
        };
        Insert: {
          business_id: string;
          genre_id: string;
          created_at?: string;
        };
        Update: {
          business_id?: string;
          genre_id?: string;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "business_genre_access_business_id_fkey";
            columns: ["business_id"];
            isOneToOne: false;
            referencedRelation: "businesses";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "business_genre_access_genre_id_fkey";
            columns: ["genre_id"];
            isOneToOne: false;
            referencedRelation: "genres";
            referencedColumns: ["id"];
          },
        ];
      };
      tracks: {
        Row: {
          id: string;
          title: string;
          artist: string;
          duration_seconds: number;
          storage_path: string;
          file_size_bytes: number;
          mime_type: string;
          bitrate_kbps: number | null;
          sample_rate_hz: number | null;
          original_filename: string | null;
          is_active: boolean;
          removed_at: string | null;
          created_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          title: string;
          artist?: string;
          duration_seconds: number;
          storage_path: string;
          file_size_bytes: number;
          mime_type?: string;
          bitrate_kbps?: number | null;
          sample_rate_hz?: number | null;
          original_filename?: string | null;
          is_active?: boolean;
          removed_at?: string | null;
          created_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          title?: string;
          artist?: string;
          duration_seconds?: number;
          storage_path?: string;
          file_size_bytes?: number;
          mime_type?: string;
          bitrate_kbps?: number | null;
          sample_rate_hz?: number | null;
          original_filename?: string | null;
          is_active?: boolean;
          removed_at?: string | null;
          created_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "tracks_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      track_genres: {
        Row: {
          track_id: string;
          genre_id: string;
          created_at: string;
        };
        Insert: {
          track_id: string;
          genre_id: string;
          created_at?: string;
        };
        Update: {
          track_id?: string;
          genre_id?: string;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "track_genres_track_id_fkey";
            columns: ["track_id"];
            isOneToOne: false;
            referencedRelation: "tracks";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "track_genres_genre_id_fkey";
            columns: ["genre_id"];
            isOneToOne: false;
            referencedRelation: "genres";
            referencedColumns: ["id"];
          },
        ];
      };
      announcements: {
        Row: {
          id: string;
          business_id: string;
          template_key: string | null;
          placement: Database["public"]["Enums"]["announcement_placement"];
          text: string;
          spoken_text: string | null;
          language: string;
          status: Database["public"]["Enums"]["announcement_status"];
          source: Database["public"]["Enums"]["announcement_source"] | null;
          audio_path: string | null;
          audio_duration_seconds: number | null;
          audio_size_bytes: number | null;
          voice_id: string | null;
          voice_name: string | null;
          model_id: string | null;
          generation_hash: string | null;
          generation_started_at: string | null;
          generation_attempts: number;
          last_error: string | null;
          needs_review: boolean;
          review_reason: string | null;
          branding_version: number;
          approved_at: string | null;
          approved_by: string | null;
          created_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          business_id: string;
          template_key?: string | null;
          placement?: Database["public"]["Enums"]["announcement_placement"];
          text: string;
          spoken_text?: string | null;
          language?: string;
          status?: Database["public"]["Enums"]["announcement_status"];
          source?: Database["public"]["Enums"]["announcement_source"] | null;
          audio_path?: string | null;
          audio_duration_seconds?: number | null;
          audio_size_bytes?: number | null;
          voice_id?: string | null;
          voice_name?: string | null;
          model_id?: string | null;
          generation_hash?: string | null;
          generation_started_at?: string | null;
          generation_attempts?: number;
          last_error?: string | null;
          needs_review?: boolean;
          review_reason?: string | null;
          branding_version?: number;
          approved_at?: string | null;
          approved_by?: string | null;
          created_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          business_id?: string;
          template_key?: string | null;
          placement?: Database["public"]["Enums"]["announcement_placement"];
          text?: string;
          spoken_text?: string | null;
          language?: string;
          status?: Database["public"]["Enums"]["announcement_status"];
          source?: Database["public"]["Enums"]["announcement_source"] | null;
          audio_path?: string | null;
          audio_duration_seconds?: number | null;
          audio_size_bytes?: number | null;
          voice_id?: string | null;
          voice_name?: string | null;
          model_id?: string | null;
          generation_hash?: string | null;
          generation_started_at?: string | null;
          generation_attempts?: number;
          last_error?: string | null;
          needs_review?: boolean;
          review_reason?: string | null;
          branding_version?: number;
          approved_at?: string | null;
          approved_by?: string | null;
          created_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "announcements_business_id_fkey";
            columns: ["business_id"];
            isOneToOne: false;
            referencedRelation: "businesses";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "announcements_approved_by_fkey";
            columns: ["approved_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "announcements_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      playback_preferences: {
        Row: {
          user_id: string;
          business_id: string;
          genre_id: string | null;
          volume: number;
          muted: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          user_id: string;
          business_id: string;
          genre_id?: string | null;
          volume?: number;
          muted?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          user_id?: string;
          business_id?: string;
          genre_id?: string | null;
          volume?: number;
          muted?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "playback_preferences_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "playback_preferences_business_id_fkey";
            columns: ["business_id"];
            isOneToOne: false;
            referencedRelation: "businesses";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "playback_preferences_genre_id_fkey";
            columns: ["genre_id"];
            isOneToOne: false;
            referencedRelation: "genres";
            referencedColumns: ["id"];
          },
        ];
      };
      rate_limit_buckets: {
        Row: {
          key: string;
          window_started_at: string;
          count: number;
        };
        Insert: {
          key: string;
          window_started_at: string;
          count: number;
        };
        Update: {
          key?: string;
          window_started_at?: string;
          count?: number;
        };
        Relationships: [];
      };
      /**
       * Public "Request access" submissions. Inserted only with the secret key (service role);
       * admins select/update/delete. At most one open ('new' | 'contacted') request per lower(email):
       * a duplicate fails with 23505 on `access_requests_open_email_key`.
       */
      access_requests: {
        Row: {
          id: string;
          business_name: string;
          business_type: Database["public"]["Enums"]["business_type"];
          contact_name: string;
          email: string;
          phone: string | null;
          message: string | null;
          status: Database["public"]["Enums"]["access_request_status"];
          admin_notes: string | null;
          handled_by: string | null;
          handled_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          business_name: string;
          business_type: Database["public"]["Enums"]["business_type"];
          contact_name: string;
          email: string;
          phone?: string | null;
          message?: string | null;
          status?: Database["public"]["Enums"]["access_request_status"];
          admin_notes?: string | null;
          handled_by?: string | null;
          handled_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          business_name?: string;
          business_type?: Database["public"]["Enums"]["business_type"];
          contact_name?: string;
          email?: string;
          phone?: string | null;
          message?: string | null;
          status?: Database["public"]["Enums"]["access_request_status"];
          admin_notes?: string | null;
          handled_by?: string | null;
          handled_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "access_requests_handled_by_fkey";
            columns: ["handled_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      /**
       * Singleton (`id` is always `true`; the row is created by the migration). Readable by anon and
       * authenticated; updatable by platform admins only. Never inserted or deleted by the API roles.
       */
      platform_settings: {
        Row: {
          id: boolean;
          contact_email: string | null;
          contact_phone: string | null;
          privacy_policy: string | null;
          terms_of_service: string | null;
          default_announcement_every_n_tracks: number;
          updated_at: string;
          updated_by: string | null;
        };
        Insert: {
          id?: boolean;
          contact_email?: string | null;
          contact_phone?: string | null;
          privacy_policy?: string | null;
          terms_of_service?: string | null;
          default_announcement_every_n_tracks?: number;
          updated_at?: string;
          updated_by?: string | null;
        };
        Update: {
          id?: boolean;
          contact_email?: string | null;
          contact_phone?: string | null;
          privacy_policy?: string | null;
          terms_of_service?: string | null;
          default_announcement_every_n_tracks?: number;
          updated_at?: string;
          updated_by?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "platform_settings_updated_by_fkey";
            columns: ["updated_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      /** Service role only. Counts one call against p_key; true while within p_max per window. */
      consume_rate_limit: {
        Args: { p_key: string; p_max: number; p_window_seconds: number };
        Returns: boolean;
      };
      /** Admin only (42501 otherwise). sort_order = 1-based array position; unlisted genres follow. */
      reorder_genres: {
        Args: { p_genre_ids: string[] };
        Returns: undefined;
      };
      /** Admin only (42501 otherwise). Replaces the business's exclusive genre assignments. */
      set_business_genre_access: {
        Args: { p_business_id: string; p_genre_ids: string[] };
        Returns: undefined;
      };
      /** Admin only (42501 otherwise). Replaces the track's genres. */
      set_track_genres: {
        Args: { p_track_id: string; p_genre_ids: string[] };
        Returns: undefined;
      };
      /** One row per genre visible to the caller (RLS applies). */
      genre_track_counts: {
        Args: Record<PropertyKey, never>;
        Returns: {
          genre_id: string;
          playable_count: number;
          total_count: number;
        }[];
      };
    };
    Enums: {
      app_role: "platform_admin" | "business_user";
      announcement_status: "draft" | "generating" | "ready" | "failed" | "active";
      announcement_source: "upload" | "tts";
      announcement_placement: "welcome" | "rotation" | "both";
      business_type: "cafe" | "restaurant" | "hotel" | "bar" | "other";
      access_request_status: "new" | "contacted" | "approved" | "declined";
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type PublicSchema = Database["public"];

export type Tables<T extends keyof PublicSchema["Tables"]> = PublicSchema["Tables"][T]["Row"];
export type TablesInsert<T extends keyof PublicSchema["Tables"]> = PublicSchema["Tables"][T]["Insert"];
export type TablesUpdate<T extends keyof PublicSchema["Tables"]> = PublicSchema["Tables"][T]["Update"];
export type Enums<T extends keyof PublicSchema["Enums"]> = PublicSchema["Enums"][T];

export type AppRole = Enums<"app_role">;
export type AnnouncementStatusEnum = Enums<"announcement_status">;
export type AnnouncementSourceEnum = Enums<"announcement_source">;
export type AnnouncementPlacementEnum = Enums<"announcement_placement">;
export type BusinessTypeEnum = Enums<"business_type">;
export type AccessRequestStatusEnum = Enums<"access_request_status">;
