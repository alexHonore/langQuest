export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  public: {
    Tables: {
      account_settings: {
        Row: {
          audio_speed: number;
          conversation_mode: string;
          created_at: string;
          default_hint_behavior: string;
          notification_preferences: NonNullable<Json>;
          offline_download_settings: NonNullable<Json>;
          preferred_input_device: string | null;
          preferred_output_device: string | null;
          retention_settings: NonNullable<Json>;
          script_preferences: NonNullable<Json>;
          transliteration_preferences: NonNullable<Json>;
          updated_at: string;
          user_id: string;
        };
        ComputedFields: never;
        Insert: {
          audio_speed?: number;
          conversation_mode?: string;
          created_at?: string;
          default_hint_behavior?: string;
          notification_preferences?: NonNullable<Json>;
          offline_download_settings?: NonNullable<Json>;
          preferred_input_device?: string | null;
          preferred_output_device?: string | null;
          retention_settings?: NonNullable<Json>;
          script_preferences?: NonNullable<Json>;
          transliteration_preferences?: NonNullable<Json>;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          audio_speed?: number;
          conversation_mode?: string;
          created_at?: string;
          default_hint_behavior?: string;
          notification_preferences?: NonNullable<Json>;
          offline_download_settings?: NonNullable<Json>;
          preferred_input_device?: string | null;
          preferred_output_device?: string | null;
          retention_settings?: NonNullable<Json>;
          script_preferences?: NonNullable<Json>;
          transliteration_preferences?: NonNullable<Json>;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      ai_model_benchmarks: {
        Row: {
          cost_per_call_usd: number | null;
          created_at: string;
          dialect_adherence: number | null;
          evaluator_version: string;
          false_correction_rate: number | null;
          id: string;
          intelligibility: number | null;
          latency_p50_ms: number | null;
          latency_p95_ms: number | null;
          model: string;
          naturalness: number | null;
          notes: string | null;
          passed: boolean;
          profile_id: string;
          reviewer_id: string | null;
          sample_set_id: string;
          source_language_code: string | null;
          target_variety_id: string | null;
          updated_at: string;
          wer: number | null;
        };
        ComputedFields: never;
        Insert: {
          cost_per_call_usd?: number | null;
          created_at?: string;
          dialect_adherence?: number | null;
          evaluator_version: string;
          false_correction_rate?: number | null;
          id?: string;
          intelligibility?: number | null;
          latency_p50_ms?: number | null;
          latency_p95_ms?: number | null;
          model: string;
          naturalness?: number | null;
          notes?: string | null;
          passed?: boolean;
          profile_id: string;
          reviewer_id?: string | null;
          sample_set_id: string;
          source_language_code?: string | null;
          target_variety_id?: string | null;
          updated_at?: string;
          wer?: number | null;
        };
        Update: {
          cost_per_call_usd?: number | null;
          created_at?: string;
          dialect_adherence?: number | null;
          evaluator_version?: string;
          false_correction_rate?: number | null;
          id?: string;
          intelligibility?: number | null;
          latency_p50_ms?: number | null;
          latency_p95_ms?: number | null;
          model?: string;
          naturalness?: number | null;
          notes?: string | null;
          passed?: boolean;
          profile_id?: string;
          reviewer_id?: string | null;
          sample_set_id?: string;
          source_language_code?: string | null;
          target_variety_id?: string | null;
          updated_at?: string;
          wer?: number | null;
        };
        Relationships: [
          {
            foreignKeyName: 'ai_model_benchmarks_profile_id_fkey';
            columns: ['profile_id'];
            isOneToOne: false;
            referencedRelation: 'ai_model_profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'ai_model_benchmarks_source_language_code_fkey';
            columns: ['source_language_code'];
            isOneToOne: false;
            referencedRelation: 'languages';
            referencedColumns: ['code'];
          },
          {
            foreignKeyName: 'ai_model_benchmarks_target_variety_id_fkey';
            columns: ['target_variety_id'];
            isOneToOne: false;
            referencedRelation: 'language_varieties';
            referencedColumns: ['id'];
          },
        ];
      };
      ai_model_profiles: {
        Row: {
          benchmark_status: string;
          capabilities: NonNullable<Json>;
          created_at: string;
          daily_budget_usd: number | null;
          enabled: boolean;
          fallback_models: string[];
          id: string;
          latency_class: string;
          params: NonNullable<Json>;
          primary_model: string;
          provider: string;
          source_language_code: string | null;
          target_variety_id: string | null;
          task: string;
          updated_at: string;
          updated_by: string | null;
          version: number;
        };
        ComputedFields: never;
        Insert: {
          benchmark_status?: string;
          capabilities?: NonNullable<Json>;
          created_at?: string;
          daily_budget_usd?: number | null;
          enabled?: boolean;
          fallback_models?: string[];
          id?: string;
          latency_class?: string;
          params?: NonNullable<Json>;
          primary_model: string;
          provider: string;
          source_language_code?: string | null;
          target_variety_id?: string | null;
          task: string;
          updated_at?: string;
          updated_by?: string | null;
          version?: number;
        };
        Update: {
          benchmark_status?: string;
          capabilities?: NonNullable<Json>;
          created_at?: string;
          daily_budget_usd?: number | null;
          enabled?: boolean;
          fallback_models?: string[];
          id?: string;
          latency_class?: string;
          params?: NonNullable<Json>;
          primary_model?: string;
          provider?: string;
          source_language_code?: string | null;
          target_variety_id?: string | null;
          task?: string;
          updated_at?: string;
          updated_by?: string | null;
          version?: number;
        };
        Relationships: [
          {
            foreignKeyName: 'ai_model_profiles_source_language_code_fkey';
            columns: ['source_language_code'];
            isOneToOne: false;
            referencedRelation: 'languages';
            referencedColumns: ['code'];
          },
          {
            foreignKeyName: 'ai_model_profiles_target_variety_id_fkey';
            columns: ['target_variety_id'];
            isOneToOne: false;
            referencedRelation: 'language_varieties';
            referencedColumns: ['id'];
          },
        ];
      };
      ai_requests: {
        Row: {
          audio_seconds: number | null;
          created_at: string;
          enrollment_id: string | null;
          error_code: string | null;
          estimated_cost_usd: number | null;
          fallback_index: number;
          id: string;
          input_tokens: number | null;
          latency_ms: number | null;
          model: string;
          output_tokens: number | null;
          profile_id: string | null;
          provider: string;
          redacted_log: Json | null;
          success: boolean;
          task: string;
          trace_id: string;
          user_id: string | null;
        };
        ComputedFields: never;
        Insert: {
          audio_seconds?: number | null;
          created_at?: string;
          enrollment_id?: string | null;
          error_code?: string | null;
          estimated_cost_usd?: number | null;
          fallback_index?: number;
          id?: string;
          input_tokens?: number | null;
          latency_ms?: number | null;
          model: string;
          output_tokens?: number | null;
          profile_id?: string | null;
          provider: string;
          redacted_log?: Json | null;
          success: boolean;
          task: string;
          trace_id: string;
          user_id?: string | null;
        };
        Update: {
          audio_seconds?: number | null;
          created_at?: string;
          enrollment_id?: string | null;
          error_code?: string | null;
          estimated_cost_usd?: number | null;
          fallback_index?: number;
          id?: string;
          input_tokens?: number | null;
          latency_ms?: number | null;
          model?: string;
          output_tokens?: number | null;
          profile_id?: string | null;
          provider?: string;
          redacted_log?: Json | null;
          success?: boolean;
          task?: string;
          trace_id?: string;
          user_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'ai_requests_enrollment_id_fkey';
            columns: ['enrollment_id'];
            isOneToOne: false;
            referencedRelation: 'user_course_enrollments';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'ai_requests_profile_id_fkey';
            columns: ['profile_id'];
            isOneToOne: false;
            referencedRelation: 'ai_model_profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      asset_provenance_events: {
        Row: {
          actor_id: string | null;
          asset_id: string;
          created_at: string;
          details: NonNullable<Json>;
          event_type: string;
          id: string;
          job_id: string | null;
        };
        ComputedFields: never;
        Insert: {
          actor_id?: string | null;
          asset_id: string;
          created_at?: string;
          details?: NonNullable<Json>;
          event_type: string;
          id?: string;
          job_id?: string | null;
        };
        Update: {
          actor_id?: string | null;
          asset_id?: string;
          created_at?: string;
          details?: NonNullable<Json>;
          event_type?: string;
          id?: string;
          job_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'asset_provenance_events_asset_id_fkey';
            columns: ['asset_id'];
            isOneToOne: false;
            referencedRelation: 'media_assets';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'asset_provenance_events_asset_id_fkey';
            columns: ['asset_id'];
            isOneToOne: false;
            referencedRelation: 'media_assets_staff';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'asset_provenance_events_job_id_fkey';
            columns: ['job_id'];
            isOneToOne: false;
            referencedRelation: 'processing_jobs';
            referencedColumns: ['id'];
          },
        ];
      };
      asset_suggestions: {
        Row: {
          confidence: number | null;
          created_at: string;
          decided_at: string | null;
          decision_note: string | null;
          id: string;
          job_id: string | null;
          kind: string;
          lesson_id: string | null;
          media_asset_id: string;
          provenance: NonNullable<Json>;
          review_status: string;
          reviewer_id: string | null;
          suggestion: NonNullable<Json>;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          confidence?: number | null;
          created_at?: string;
          decided_at?: string | null;
          decision_note?: string | null;
          id?: string;
          job_id?: string | null;
          kind: string;
          lesson_id?: string | null;
          media_asset_id: string;
          provenance?: NonNullable<Json>;
          review_status?: string;
          reviewer_id?: string | null;
          suggestion?: NonNullable<Json>;
          updated_at?: string;
        };
        Update: {
          confidence?: number | null;
          created_at?: string;
          decided_at?: string | null;
          decision_note?: string | null;
          id?: string;
          job_id?: string | null;
          kind?: string;
          lesson_id?: string | null;
          media_asset_id?: string;
          provenance?: NonNullable<Json>;
          review_status?: string;
          reviewer_id?: string | null;
          suggestion?: NonNullable<Json>;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'asset_suggestions_job_id_fkey';
            columns: ['job_id'];
            isOneToOne: false;
            referencedRelation: 'processing_jobs';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'asset_suggestions_lesson_id_fkey';
            columns: ['lesson_id'];
            isOneToOne: false;
            referencedRelation: 'audio_lessons';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'asset_suggestions_media_asset_id_fkey';
            columns: ['media_asset_id'];
            isOneToOne: false;
            referencedRelation: 'media_assets';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'asset_suggestions_media_asset_id_fkey';
            columns: ['media_asset_id'];
            isOneToOne: false;
            referencedRelation: 'media_assets_staff';
            referencedColumns: ['id'];
          },
        ];
      };
      audio_chapters: {
        Row: {
          collection_id: string;
          cover_visual_asset_id: string | null;
          created_at: string;
          id: string;
          sort_order: number;
          state: string;
          summary_translations: NonNullable<Json>;
          title_translations: NonNullable<Json>;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          collection_id: string;
          cover_visual_asset_id?: string | null;
          created_at?: string;
          id?: string;
          sort_order?: number;
          state?: string;
          summary_translations?: NonNullable<Json>;
          title_translations?: NonNullable<Json>;
          updated_at?: string;
        };
        Update: {
          collection_id?: string;
          cover_visual_asset_id?: string | null;
          created_at?: string;
          id?: string;
          sort_order?: number;
          state?: string;
          summary_translations?: NonNullable<Json>;
          title_translations?: NonNullable<Json>;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'audio_chapters_collection_id_fkey';
            columns: ['collection_id'];
            isOneToOne: false;
            referencedRelation: 'audio_course_collections';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'audio_chapters_cover_fkey';
            columns: ['cover_visual_asset_id'];
            isOneToOne: false;
            referencedRelation: 'visual_assets';
            referencedColumns: ['id'];
          },
        ];
      };
      audio_collection_manifests: {
        Row: {
          checksum: string;
          collection_id: string;
          created_at: string;
          generated_by_job_id: string | null;
          id: string;
          instruction_language_code: string;
          manifest: NonNullable<Json>;
          published_at: string | null;
          updated_at: string;
          version: number;
        };
        ComputedFields: never;
        Insert: {
          checksum: string;
          collection_id: string;
          created_at?: string;
          generated_by_job_id?: string | null;
          id?: string;
          instruction_language_code?: string;
          manifest: NonNullable<Json>;
          published_at?: string | null;
          updated_at?: string;
          version: number;
        };
        Update: {
          checksum?: string;
          collection_id?: string;
          created_at?: string;
          generated_by_job_id?: string | null;
          id?: string;
          instruction_language_code?: string;
          manifest?: NonNullable<Json>;
          published_at?: string | null;
          updated_at?: string;
          version?: number;
        };
        Relationships: [
          {
            foreignKeyName: 'audio_collection_manifests_collection_id_fkey';
            columns: ['collection_id'];
            isOneToOne: false;
            referencedRelation: 'audio_course_collections';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'audio_collection_manifests_generated_by_job_id_fkey';
            columns: ['generated_by_job_id'];
            isOneToOne: false;
            referencedRelation: 'processing_jobs';
            referencedColumns: ['id'];
          },
        ];
      };
      audio_course_collections: {
        Row: {
          content_rights_id: string | null;
          course_track_id: string | null;
          cover_visual_asset_id: string | null;
          created_at: string;
          description_translations: NonNullable<Json>;
          id: string;
          instruction_language_code: string | null;
          instructor_speaker_id: string | null;
          published_version: number | null;
          region: string | null;
          sort_order: number;
          state: string;
          target_variety_id: string | null;
          title_translations: NonNullable<Json>;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          content_rights_id?: string | null;
          course_track_id?: string | null;
          cover_visual_asset_id?: string | null;
          created_at?: string;
          description_translations?: NonNullable<Json>;
          id?: string;
          instruction_language_code?: string | null;
          instructor_speaker_id?: string | null;
          published_version?: number | null;
          region?: string | null;
          sort_order?: number;
          state?: string;
          target_variety_id?: string | null;
          title_translations?: NonNullable<Json>;
          updated_at?: string;
        };
        Update: {
          content_rights_id?: string | null;
          course_track_id?: string | null;
          cover_visual_asset_id?: string | null;
          created_at?: string;
          description_translations?: NonNullable<Json>;
          id?: string;
          instruction_language_code?: string | null;
          instructor_speaker_id?: string | null;
          published_version?: number | null;
          region?: string | null;
          sort_order?: number;
          state?: string;
          target_variety_id?: string | null;
          title_translations?: NonNullable<Json>;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'audio_course_collections_content_rights_id_fkey';
            columns: ['content_rights_id'];
            isOneToOne: false;
            referencedRelation: 'content_rights';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'audio_course_collections_course_track_id_fkey';
            columns: ['course_track_id'];
            isOneToOne: false;
            referencedRelation: 'course_tracks';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'audio_course_collections_cover_fkey';
            columns: ['cover_visual_asset_id'];
            isOneToOne: false;
            referencedRelation: 'visual_assets';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'audio_course_collections_instruction_language_code_fkey';
            columns: ['instruction_language_code'];
            isOneToOne: false;
            referencedRelation: 'languages';
            referencedColumns: ['code'];
          },
          {
            foreignKeyName: 'audio_course_collections_instructor_speaker_id_fkey';
            columns: ['instructor_speaker_id'];
            isOneToOne: false;
            referencedRelation: 'speakers';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'audio_course_collections_target_variety_id_fkey';
            columns: ['target_variety_id'];
            isOneToOne: false;
            referencedRelation: 'language_varieties';
            referencedColumns: ['id'];
          },
        ];
      };
      audio_cover_art: {
        Row: {
          chapter_id: string | null;
          collection_id: string | null;
          created_at: string;
          generated_from_template: boolean;
          id: string;
          lesson_id: string | null;
          review_status: string;
          template_id: string | null;
          updated_at: string;
          visual_asset_id: string;
        };
        ComputedFields: never;
        Insert: {
          chapter_id?: string | null;
          collection_id?: string | null;
          created_at?: string;
          generated_from_template?: boolean;
          id?: string;
          lesson_id?: string | null;
          review_status?: string;
          template_id?: string | null;
          updated_at?: string;
          visual_asset_id: string;
        };
        Update: {
          chapter_id?: string | null;
          collection_id?: string | null;
          created_at?: string;
          generated_from_template?: boolean;
          id?: string;
          lesson_id?: string | null;
          review_status?: string;
          template_id?: string | null;
          updated_at?: string;
          visual_asset_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'audio_cover_art_chapter_id_fkey';
            columns: ['chapter_id'];
            isOneToOne: false;
            referencedRelation: 'audio_chapters';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'audio_cover_art_collection_id_fkey';
            columns: ['collection_id'];
            isOneToOne: false;
            referencedRelation: 'audio_course_collections';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'audio_cover_art_lesson_id_fkey';
            columns: ['lesson_id'];
            isOneToOne: false;
            referencedRelation: 'audio_lessons';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'audio_cover_art_visual_asset_id_fkey';
            columns: ['visual_asset_id'];
            isOneToOne: false;
            referencedRelation: 'visual_assets';
            referencedColumns: ['id'];
          },
        ];
      };
      audio_lesson_assets: {
        Row: {
          asset_id: string;
          asset_type: string;
          created_at: string;
          id: string;
          lesson_id: string;
          sort_order: number;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          asset_id: string;
          asset_type: string;
          created_at?: string;
          id?: string;
          lesson_id: string;
          sort_order?: number;
          updated_at?: string;
        };
        Update: {
          asset_id?: string;
          asset_type?: string;
          created_at?: string;
          id?: string;
          lesson_id?: string;
          sort_order?: number;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'audio_lesson_assets_asset_id_fkey';
            columns: ['asset_id'];
            isOneToOne: false;
            referencedRelation: 'media_assets';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'audio_lesson_assets_asset_id_fkey';
            columns: ['asset_id'];
            isOneToOne: false;
            referencedRelation: 'media_assets_staff';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'audio_lesson_assets_lesson_id_fkey';
            columns: ['lesson_id'];
            isOneToOne: false;
            referencedRelation: 'audio_lessons';
            referencedColumns: ['id'];
          },
        ];
      };
      audio_lessons: {
        Row: {
          chapter_id: string;
          content_rights_id: string | null;
          cover_visual_asset_id: string | null;
          created_at: string;
          description_translations: NonNullable<Json>;
          episode_number: number | null;
          id: string;
          instruction_language_code: string | null;
          level: string | null;
          listen_length_ms: number | null;
          published_revision: number | null;
          quality_review_status: string;
          regional_dialect: string | null;
          scene: string | null;
          sort_order: number;
          spoken_language_codes: string[];
          state: string;
          tags: string[];
          target_variety_id: string | null;
          title_translations: NonNullable<Json>;
          topic: string | null;
          transcript_status: string;
          updated_at: string;
          visibility: string;
        };
        ComputedFields: never;
        Insert: {
          chapter_id: string;
          content_rights_id?: string | null;
          cover_visual_asset_id?: string | null;
          created_at?: string;
          description_translations?: NonNullable<Json>;
          episode_number?: number | null;
          id?: string;
          instruction_language_code?: string | null;
          level?: string | null;
          listen_length_ms?: number | null;
          published_revision?: number | null;
          quality_review_status?: string;
          regional_dialect?: string | null;
          scene?: string | null;
          sort_order?: number;
          spoken_language_codes?: string[];
          state?: string;
          tags?: string[];
          target_variety_id?: string | null;
          title_translations?: NonNullable<Json>;
          topic?: string | null;
          transcript_status?: string;
          updated_at?: string;
          visibility?: string;
        };
        Update: {
          chapter_id?: string;
          content_rights_id?: string | null;
          cover_visual_asset_id?: string | null;
          created_at?: string;
          description_translations?: NonNullable<Json>;
          episode_number?: number | null;
          id?: string;
          instruction_language_code?: string | null;
          level?: string | null;
          listen_length_ms?: number | null;
          published_revision?: number | null;
          quality_review_status?: string;
          regional_dialect?: string | null;
          scene?: string | null;
          sort_order?: number;
          spoken_language_codes?: string[];
          state?: string;
          tags?: string[];
          target_variety_id?: string | null;
          title_translations?: NonNullable<Json>;
          topic?: string | null;
          transcript_status?: string;
          updated_at?: string;
          visibility?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'audio_lessons_chapter_id_fkey';
            columns: ['chapter_id'];
            isOneToOne: false;
            referencedRelation: 'audio_chapters';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'audio_lessons_content_rights_id_fkey';
            columns: ['content_rights_id'];
            isOneToOne: false;
            referencedRelation: 'content_rights';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'audio_lessons_cover_fkey';
            columns: ['cover_visual_asset_id'];
            isOneToOne: false;
            referencedRelation: 'visual_assets';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'audio_lessons_instruction_language_code_fkey';
            columns: ['instruction_language_code'];
            isOneToOne: false;
            referencedRelation: 'languages';
            referencedColumns: ['code'];
          },
          {
            foreignKeyName: 'audio_lessons_target_variety_id_fkey';
            columns: ['target_variety_id'];
            isOneToOne: false;
            referencedRelation: 'language_varieties';
            referencedColumns: ['id'];
          },
        ];
      };
      audit_logs: {
        Row: {
          action: string;
          actor_id: string | null;
          actor_role: string | null;
          after: Json | null;
          before: Json | null;
          created_at: string;
          entity_id: string | null;
          entity_table: string | null;
          id: string;
          ip_hash: string | null;
          request_id: string | null;
        };
        ComputedFields: never;
        Insert: {
          action: string;
          actor_id?: string | null;
          actor_role?: string | null;
          after?: Json | null;
          before?: Json | null;
          created_at?: string;
          entity_id?: string | null;
          entity_table?: string | null;
          id?: string;
          ip_hash?: string | null;
          request_id?: string | null;
        };
        Update: {
          action?: string;
          actor_id?: string | null;
          actor_role?: string | null;
          after?: Json | null;
          before?: Json | null;
          created_at?: string;
          entity_id?: string | null;
          entity_table?: string | null;
          id?: string;
          ip_hash?: string | null;
          request_id?: string | null;
        };
        Relationships: [];
      };
      bookmarks: {
        Row: {
          client_event_id: string;
          created_at: string;
          id: string;
          lesson_id: string;
          note: string | null;
          position_ms: number;
          segment_id: string | null;
          updated_at: string;
          user_id: string;
        };
        ComputedFields: never;
        Insert: {
          client_event_id: string;
          created_at?: string;
          id?: string;
          lesson_id: string;
          note?: string | null;
          position_ms: number;
          segment_id?: string | null;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          client_event_id?: string;
          created_at?: string;
          id?: string;
          lesson_id?: string;
          note?: string | null;
          position_ms?: number;
          segment_id?: string | null;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'bookmarks_lesson_id_fkey';
            columns: ['lesson_id'];
            isOneToOne: false;
            referencedRelation: 'audio_lessons';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'bookmarks_segment_id_fkey';
            columns: ['segment_id'];
            isOneToOne: false;
            referencedRelation: 'transcript_segments';
            referencedColumns: ['id'];
          },
        ];
      };
      chapters: {
        Row: {
          cover_visual_asset_id: string | null;
          created_at: string;
          description_translations: NonNullable<Json>;
          id: string;
          lesson_course_id: string;
          map_visual_asset_id: string | null;
          region: string | null;
          scene: string | null;
          sort_index: number;
          state: string;
          title_translations: NonNullable<Json>;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          cover_visual_asset_id?: string | null;
          created_at?: string;
          description_translations?: NonNullable<Json>;
          id?: string;
          lesson_course_id: string;
          map_visual_asset_id?: string | null;
          region?: string | null;
          scene?: string | null;
          sort_index?: number;
          state?: string;
          title_translations?: NonNullable<Json>;
          updated_at?: string;
        };
        Update: {
          cover_visual_asset_id?: string | null;
          created_at?: string;
          description_translations?: NonNullable<Json>;
          id?: string;
          lesson_course_id?: string;
          map_visual_asset_id?: string | null;
          region?: string | null;
          scene?: string | null;
          sort_index?: number;
          state?: string;
          title_translations?: NonNullable<Json>;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'chapters_cover_fkey';
            columns: ['cover_visual_asset_id'];
            isOneToOne: false;
            referencedRelation: 'visual_assets';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'chapters_lesson_course_id_fkey';
            columns: ['lesson_course_id'];
            isOneToOne: false;
            referencedRelation: 'lesson_courses';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'chapters_map_fkey';
            columns: ['map_visual_asset_id'];
            isOneToOne: false;
            referencedRelation: 'visual_assets';
            referencedColumns: ['id'];
          },
        ];
      };
      character_relationship_memory: {
        Row: {
          character_id: string;
          consented: boolean;
          created_at: string;
          durable_preferences: NonNullable<Json>;
          enrollment_id: string;
          id: string;
          last_interaction_at: string | null;
          missions_completed_together: number;
          story_summary: string;
          updated_at: string;
          user_id: string;
        };
        ComputedFields: never;
        Insert: {
          character_id: string;
          consented?: boolean;
          created_at?: string;
          durable_preferences?: NonNullable<Json>;
          enrollment_id: string;
          id?: string;
          last_interaction_at?: string | null;
          missions_completed_together?: number;
          story_summary?: string;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          character_id?: string;
          consented?: boolean;
          created_at?: string;
          durable_preferences?: NonNullable<Json>;
          enrollment_id?: string;
          id?: string;
          last_interaction_at?: string | null;
          missions_completed_together?: number;
          story_summary?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'character_relationship_memory_character_id_fkey';
            columns: ['character_id'];
            isOneToOne: false;
            referencedRelation: 'characters';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'character_relationship_memory_enrollment_id_fkey';
            columns: ['enrollment_id'];
            isOneToOne: false;
            referencedRelation: 'user_course_enrollments';
            referencedColumns: ['id'];
          },
        ];
      };
      character_visual_variants: {
        Row: {
          body: string;
          character_id: string;
          clothing_variant: string | null;
          created_at: string;
          cultural_review_note: string | null;
          expression: string | null;
          id: string;
          review_status: string;
          style_version: string;
          updated_at: string;
          visual_asset_id: string;
        };
        ComputedFields: never;
        Insert: {
          body?: string;
          character_id: string;
          clothing_variant?: string | null;
          created_at?: string;
          cultural_review_note?: string | null;
          expression?: string | null;
          id?: string;
          review_status?: string;
          style_version: string;
          updated_at?: string;
          visual_asset_id: string;
        };
        Update: {
          body?: string;
          character_id?: string;
          clothing_variant?: string | null;
          created_at?: string;
          cultural_review_note?: string | null;
          expression?: string | null;
          id?: string;
          review_status?: string;
          style_version?: string;
          updated_at?: string;
          visual_asset_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'character_visual_variants_character_id_fkey';
            columns: ['character_id'];
            isOneToOne: false;
            referencedRelation: 'characters';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'character_visual_variants_visual_asset_id_fkey';
            columns: ['visual_asset_id'];
            isOneToOne: false;
            referencedRelation: 'visual_assets';
            referencedColumns: ['id'];
          },
        ];
      };
      characters: {
        Row: {
          character_key: string;
          created_at: string;
          home_region: string;
          id: string;
          name: string;
          personality: string;
          portrait_visual_asset_id: string | null;
          regional_option: string | null;
          relationships: NonNullable<Json>;
          role: string;
          safety_rules: string[];
          state: string;
          storyline_facts: string[];
          target_variety_id: string;
          updated_at: string;
          voice_profile: NonNullable<Json>;
        };
        ComputedFields: never;
        Insert: {
          character_key: string;
          created_at?: string;
          home_region: string;
          id?: string;
          name: string;
          personality: string;
          portrait_visual_asset_id?: string | null;
          regional_option?: string | null;
          relationships?: NonNullable<Json>;
          role: string;
          safety_rules?: string[];
          state?: string;
          storyline_facts?: string[];
          target_variety_id: string;
          updated_at?: string;
          voice_profile?: NonNullable<Json>;
        };
        Update: {
          character_key?: string;
          created_at?: string;
          home_region?: string;
          id?: string;
          name?: string;
          personality?: string;
          portrait_visual_asset_id?: string | null;
          regional_option?: string | null;
          relationships?: NonNullable<Json>;
          role?: string;
          safety_rules?: string[];
          state?: string;
          storyline_facts?: string[];
          target_variety_id?: string;
          updated_at?: string;
          voice_profile?: NonNullable<Json>;
        };
        Relationships: [
          {
            foreignKeyName: 'characters_portrait_fkey';
            columns: ['portrait_visual_asset_id'];
            isOneToOne: false;
            referencedRelation: 'visual_assets';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'characters_target_variety_id_fkey';
            columns: ['target_variety_id'];
            isOneToOne: false;
            referencedRelation: 'language_varieties';
            referencedColumns: ['id'];
          },
        ];
      };
      communicative_intents: {
        Row: {
          created_at: string;
          description: string;
          id: string;
          intent_key: string;
          polarity: string;
          politeness: string;
          response_constraints: NonNullable<Json>;
          skill_keys: string[];
          social_meaning: string | null;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          description: string;
          id?: string;
          intent_key: string;
          polarity?: string;
          politeness?: string;
          response_constraints?: NonNullable<Json>;
          skill_keys?: string[];
          social_meaning?: string | null;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          description?: string;
          id?: string;
          intent_key?: string;
          polarity?: string;
          politeness?: string;
          response_constraints?: NonNullable<Json>;
          skill_keys?: string[];
          social_meaning?: string | null;
          updated_at?: string;
        };
        Relationships: [];
      };
      content_revisions: {
        Row: {
          created_at: string;
          diff: NonNullable<Json>;
          editor_id: string;
          entity_id: string;
          entity_table: string;
          id: string;
          note: string | null;
          revision: number;
          snapshot: Json | null;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          diff?: NonNullable<Json>;
          editor_id: string;
          entity_id: string;
          entity_table: string;
          id?: string;
          note?: string | null;
          revision: number;
          snapshot?: Json | null;
        };
        Update: {
          created_at?: string;
          diff?: NonNullable<Json>;
          editor_id?: string;
          entity_id?: string;
          entity_table?: string;
          id?: string;
          note?: string | null;
          revision?: number;
          snapshot?: Json | null;
        };
        Relationships: [];
      };
      content_rights: {
        Row: {
          ai_processing_permitted: boolean;
          alterations_permitted: boolean;
          attribution_required: boolean;
          attribution_text: string | null;
          authors: string[];
          commercial_redistribution: boolean;
          created_at: string;
          evidence_asset_id: string | null;
          expires_at: string | null;
          id: string;
          license_id: string;
          license_version: string | null;
          origin_url: string | null;
          permission_grant: string;
          reviewed_at: string | null;
          reviewer_id: string | null;
          revoked_at: string | null;
          speakers: string[];
          updated_at: string;
          verified: boolean;
          voice_rights: string;
        };
        ComputedFields: never;
        Insert: {
          ai_processing_permitted?: boolean;
          alterations_permitted?: boolean;
          attribution_required?: boolean;
          attribution_text?: string | null;
          authors?: string[];
          commercial_redistribution?: boolean;
          created_at?: string;
          evidence_asset_id?: string | null;
          expires_at?: string | null;
          id?: string;
          license_id: string;
          license_version?: string | null;
          origin_url?: string | null;
          permission_grant: string;
          reviewed_at?: string | null;
          reviewer_id?: string | null;
          revoked_at?: string | null;
          speakers?: string[];
          updated_at?: string;
          verified?: boolean;
          voice_rights?: string;
        };
        Update: {
          ai_processing_permitted?: boolean;
          alterations_permitted?: boolean;
          attribution_required?: boolean;
          attribution_text?: string | null;
          authors?: string[];
          commercial_redistribution?: boolean;
          created_at?: string;
          evidence_asset_id?: string | null;
          expires_at?: string | null;
          id?: string;
          license_id?: string;
          license_version?: string | null;
          origin_url?: string | null;
          permission_grant?: string;
          reviewed_at?: string | null;
          reviewer_id?: string | null;
          revoked_at?: string | null;
          speakers?: string[];
          updated_at?: string;
          verified?: boolean;
          voice_rights?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'content_rights_evidence_asset_fkey';
            columns: ['evidence_asset_id'];
            isOneToOne: false;
            referencedRelation: 'media_assets';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'content_rights_evidence_asset_fkey';
            columns: ['evidence_asset_id'];
            isOneToOne: false;
            referencedRelation: 'media_assets_staff';
            referencedColumns: ['id'];
          },
        ];
      };
      conversation_sessions: {
        Row: {
          character_id: string;
          created_at: string;
          ended_at: string | null;
          enrollment_id: string;
          id: string;
          last_seq: number;
          mission_id: string | null;
          mode: string;
          objectives_completed: string[];
          pipeline: string;
          revision: number;
          rubric_outcomes: Json | null;
          scenario_id: string | null;
          scope: Json | null;
          source_language_code: string;
          speech_retention: string;
          started_at: string;
          state: string;
          summary: string | null;
          target_variety_id: string;
          turn_count: number;
          updated_at: string;
          user_id: string;
        };
        ComputedFields: never;
        Insert: {
          character_id: string;
          created_at?: string;
          ended_at?: string | null;
          enrollment_id: string;
          id?: string;
          last_seq?: number;
          mission_id?: string | null;
          mode?: string;
          objectives_completed?: string[];
          pipeline?: string;
          revision?: number;
          rubric_outcomes?: Json | null;
          scenario_id?: string | null;
          scope?: Json | null;
          source_language_code: string;
          speech_retention?: string;
          started_at?: string;
          state?: string;
          summary?: string | null;
          target_variety_id: string;
          turn_count?: number;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          character_id?: string;
          created_at?: string;
          ended_at?: string | null;
          enrollment_id?: string;
          id?: string;
          last_seq?: number;
          mission_id?: string | null;
          mode?: string;
          objectives_completed?: string[];
          pipeline?: string;
          revision?: number;
          rubric_outcomes?: Json | null;
          scenario_id?: string | null;
          scope?: Json | null;
          source_language_code?: string;
          speech_retention?: string;
          started_at?: string;
          state?: string;
          summary?: string | null;
          target_variety_id?: string;
          turn_count?: number;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'conversation_sessions_character_id_fkey';
            columns: ['character_id'];
            isOneToOne: false;
            referencedRelation: 'characters';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'conversation_sessions_enrollment_id_fkey';
            columns: ['enrollment_id'];
            isOneToOne: false;
            referencedRelation: 'user_course_enrollments';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'conversation_sessions_mission_id_fkey';
            columns: ['mission_id'];
            isOneToOne: false;
            referencedRelation: 'missions';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'conversation_sessions_scenario_id_fkey';
            columns: ['scenario_id'];
            isOneToOne: false;
            referencedRelation: 'dialogue_scenarios';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'conversation_sessions_source_language_code_fkey';
            columns: ['source_language_code'];
            isOneToOne: false;
            referencedRelation: 'languages';
            referencedColumns: ['code'];
          },
          {
            foreignKeyName: 'conversation_sessions_target_variety_id_fkey';
            columns: ['target_variety_id'];
            isOneToOne: false;
            referencedRelation: 'language_varieties';
            referencedColumns: ['id'];
          },
        ];
      };
      conversation_turns: {
        Row: {
          audio_asset_id: string | null;
          client_turn_id: string | null;
          command: string | null;
          confidence: number | null;
          created_at: string;
          expires_at: string | null;
          goals: string[];
          hints_used: number;
          id: string;
          latency_ms: number | null;
          occurred_at: string;
          session_id: string;
          speaker: string;
          text: string | null;
          text_hash: string | null;
          turn_index: number;
        };
        ComputedFields: never;
        Insert: {
          audio_asset_id?: string | null;
          client_turn_id?: string | null;
          command?: string | null;
          confidence?: number | null;
          created_at?: string;
          expires_at?: string | null;
          goals?: string[];
          hints_used?: number;
          id?: string;
          latency_ms?: number | null;
          occurred_at?: string;
          session_id: string;
          speaker: string;
          text?: string | null;
          text_hash?: string | null;
          turn_index: number;
        };
        Update: {
          audio_asset_id?: string | null;
          client_turn_id?: string | null;
          command?: string | null;
          confidence?: number | null;
          created_at?: string;
          expires_at?: string | null;
          goals?: string[];
          hints_used?: number;
          id?: string;
          latency_ms?: number | null;
          occurred_at?: string;
          session_id?: string;
          speaker?: string;
          text?: string | null;
          text_hash?: string | null;
          turn_index?: number;
        };
        Relationships: [
          {
            foreignKeyName: 'conversation_turns_audio_asset_id_fkey';
            columns: ['audio_asset_id'];
            isOneToOne: false;
            referencedRelation: 'media_assets';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'conversation_turns_audio_asset_id_fkey';
            columns: ['audio_asset_id'];
            isOneToOne: false;
            referencedRelation: 'media_assets_staff';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'conversation_turns_session_id_fkey';
            columns: ['session_id'];
            isOneToOne: false;
            referencedRelation: 'conversation_sessions';
            referencedColumns: ['id'];
          },
        ];
      };
      course_manifests: {
        Row: {
          checksum: string;
          course_track_id: string;
          created_at: string;
          generated_by_job_id: string | null;
          id: string;
          manifest: NonNullable<Json>;
          published_at: string | null;
          source_language_code: string;
          updated_at: string;
          version: number;
        };
        ComputedFields: never;
        Insert: {
          checksum: string;
          course_track_id: string;
          created_at?: string;
          generated_by_job_id?: string | null;
          id?: string;
          manifest: NonNullable<Json>;
          published_at?: string | null;
          source_language_code: string;
          updated_at?: string;
          version: number;
        };
        Update: {
          checksum?: string;
          course_track_id?: string;
          created_at?: string;
          generated_by_job_id?: string | null;
          id?: string;
          manifest?: NonNullable<Json>;
          published_at?: string | null;
          source_language_code?: string;
          updated_at?: string;
          version?: number;
        };
        Relationships: [
          {
            foreignKeyName: 'course_manifests_course_track_id_fkey';
            columns: ['course_track_id'];
            isOneToOne: false;
            referencedRelation: 'course_tracks';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'course_manifests_generated_by_job_id_fkey';
            columns: ['generated_by_job_id'];
            isOneToOne: false;
            referencedRelation: 'processing_jobs';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'course_manifests_source_language_code_fkey';
            columns: ['source_language_code'];
            isOneToOne: false;
            referencedRelation: 'languages';
            referencedColumns: ['code'];
          },
        ];
      };
      course_source_localizations: {
        Row: {
          course_track_id: string;
          created_at: string;
          editorial_note_key: string | null;
          fallback_source_language_code: string | null;
          id: string;
          metrics: NonNullable<Json>;
          native_reviewed: boolean;
          reviewed_at: string | null;
          reviewer_id: string | null;
          source_language_code: string;
          status: string;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          course_track_id: string;
          created_at?: string;
          editorial_note_key?: string | null;
          fallback_source_language_code?: string | null;
          id?: string;
          metrics?: NonNullable<Json>;
          native_reviewed?: boolean;
          reviewed_at?: string | null;
          reviewer_id?: string | null;
          source_language_code: string;
          status?: string;
          updated_at?: string;
        };
        Update: {
          course_track_id?: string;
          created_at?: string;
          editorial_note_key?: string | null;
          fallback_source_language_code?: string | null;
          id?: string;
          metrics?: NonNullable<Json>;
          native_reviewed?: boolean;
          reviewed_at?: string | null;
          reviewer_id?: string | null;
          source_language_code?: string;
          status?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'course_source_localizations_course_track_id_fkey';
            columns: ['course_track_id'];
            isOneToOne: false;
            referencedRelation: 'course_tracks';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'course_source_localizations_fallback_source_language_code_fkey';
            columns: ['fallback_source_language_code'];
            isOneToOne: false;
            referencedRelation: 'languages';
            referencedColumns: ['code'];
          },
          {
            foreignKeyName: 'course_source_localizations_source_language_code_fkey';
            columns: ['source_language_code'];
            isOneToOne: false;
            referencedRelation: 'languages';
            referencedColumns: ['code'];
          },
        ];
      };
      course_tracks: {
        Row: {
          assumptions: string[];
          automated_scoring_support: string;
          created_at: string;
          default_locale: string;
          default_script_mode: string;
          default_voices: NonNullable<Json>;
          display_name: string;
          id: string;
          language_id: string;
          primary_target_variety_id: string;
          publication_state: string;
          regional_options: NonNullable<Json>;
          script_focus: string | null;
          script_mode_options: string[];
          scripts: NonNullable<Json>;
          shares_assets_with_track_id: string | null;
          sort_order: number;
          teaching_focus: string;
          tonal: boolean;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          assumptions?: string[];
          automated_scoring_support?: string;
          created_at?: string;
          default_locale: string;
          default_script_mode?: string;
          default_voices?: NonNullable<Json>;
          display_name: string;
          id: string;
          language_id: string;
          primary_target_variety_id: string;
          publication_state?: string;
          regional_options?: NonNullable<Json>;
          script_focus?: string | null;
          script_mode_options?: string[];
          scripts: NonNullable<Json>;
          shares_assets_with_track_id?: string | null;
          sort_order: number;
          teaching_focus?: string;
          tonal?: boolean;
          updated_at?: string;
        };
        Update: {
          assumptions?: string[];
          automated_scoring_support?: string;
          created_at?: string;
          default_locale?: string;
          default_script_mode?: string;
          default_voices?: NonNullable<Json>;
          display_name?: string;
          id?: string;
          language_id?: string;
          primary_target_variety_id?: string;
          publication_state?: string;
          regional_options?: NonNullable<Json>;
          script_focus?: string | null;
          script_mode_options?: string[];
          scripts?: NonNullable<Json>;
          shares_assets_with_track_id?: string | null;
          sort_order?: number;
          teaching_focus?: string;
          tonal?: boolean;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'course_tracks_language_id_fkey';
            columns: ['language_id'];
            isOneToOne: false;
            referencedRelation: 'languages';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'course_tracks_primary_target_variety_id_fkey';
            columns: ['primary_target_variety_id'];
            isOneToOne: false;
            referencedRelation: 'language_varieties';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'course_tracks_shares_assets_with_track_id_fkey';
            columns: ['shares_assets_with_track_id'];
            isOneToOne: false;
            referencedRelation: 'course_tracks';
            referencedColumns: ['id'];
          },
        ];
      };
      daily_learning_metrics: {
        Row: {
          conversation_turns: number;
          created_at: string;
          enrollment_id: string;
          id: string;
          metric_date: string;
          minutes_active: number;
          missions_completed: number;
          missions_completed_without_hints: number;
          review_recall_pct: number | null;
          reviews_completed: number;
          reviews_due: number;
          speaking_seconds: number;
          updated_at: string;
          user_id: string;
          xp_earned: number;
        };
        ComputedFields: never;
        Insert: {
          conversation_turns?: number;
          created_at?: string;
          enrollment_id: string;
          id?: string;
          metric_date: string;
          minutes_active?: number;
          missions_completed?: number;
          missions_completed_without_hints?: number;
          review_recall_pct?: number | null;
          reviews_completed?: number;
          reviews_due?: number;
          speaking_seconds?: number;
          updated_at?: string;
          user_id: string;
          xp_earned?: number;
        };
        Update: {
          conversation_turns?: number;
          created_at?: string;
          enrollment_id?: string;
          id?: string;
          metric_date?: string;
          minutes_active?: number;
          missions_completed?: number;
          missions_completed_without_hints?: number;
          review_recall_pct?: number | null;
          reviews_completed?: number;
          reviews_due?: number;
          speaking_seconds?: number;
          updated_at?: string;
          user_id?: string;
          xp_earned?: number;
        };
        Relationships: [
          {
            foreignKeyName: 'daily_learning_metrics_enrollment_id_fkey';
            columns: ['enrollment_id'];
            isOneToOne: false;
            referencedRelation: 'user_course_enrollments';
            referencedColumns: ['id'];
          },
        ];
      };
      device_sync_events: {
        Row: {
          applied_at: string | null;
          client_event_id: string;
          client_occurred_at: string;
          clock_skew_ms: number | null;
          created_at: string;
          device_id: string;
          id: string;
          payload: NonNullable<Json>;
          payload_type: string;
          rejection_reason: string | null;
          resolution: string;
          revision: number;
          user_id: string;
        };
        ComputedFields: never;
        Insert: {
          applied_at?: string | null;
          client_event_id: string;
          client_occurred_at: string;
          clock_skew_ms?: number | null;
          created_at?: string;
          device_id: string;
          id?: string;
          payload?: NonNullable<Json>;
          payload_type: string;
          rejection_reason?: string | null;
          resolution: string;
          revision?: number;
          user_id: string;
        };
        Update: {
          applied_at?: string | null;
          client_event_id?: string;
          client_occurred_at?: string;
          clock_skew_ms?: number | null;
          created_at?: string;
          device_id?: string;
          id?: string;
          payload?: NonNullable<Json>;
          payload_type?: string;
          rejection_reason?: string | null;
          resolution?: string;
          revision?: number;
          user_id?: string;
        };
        Relationships: [];
      };
      dialogue_scenarios: {
        Row: {
          character_id: string;
          created_at: string;
          expected_intent_ids: string[];
          id: string;
          interruption_policy: string;
          learner_role: string;
          max_level: string;
          min_level: string;
          mission_id: string | null;
          safety_rules: string[];
          scene: string;
          scene_facts: string[];
          state: string;
          topic_rules: string[];
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          character_id: string;
          created_at?: string;
          expected_intent_ids?: string[];
          id?: string;
          interruption_policy?: string;
          learner_role: string;
          max_level?: string;
          min_level?: string;
          mission_id?: string | null;
          safety_rules?: string[];
          scene: string;
          scene_facts?: string[];
          state?: string;
          topic_rules?: string[];
          updated_at?: string;
        };
        Update: {
          character_id?: string;
          created_at?: string;
          expected_intent_ids?: string[];
          id?: string;
          interruption_policy?: string;
          learner_role?: string;
          max_level?: string;
          min_level?: string;
          mission_id?: string | null;
          safety_rules?: string[];
          scene?: string;
          scene_facts?: string[];
          state?: string;
          topic_rules?: string[];
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'dialogue_scenarios_character_id_fkey';
            columns: ['character_id'];
            isOneToOne: false;
            referencedRelation: 'characters';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'dialogue_scenarios_mission_id_fkey';
            columns: ['mission_id'];
            isOneToOne: false;
            referencedRelation: 'missions';
            referencedColumns: ['id'];
          },
        ];
      };
      dialogue_variants: {
        Row: {
          created_at: string;
          id: string;
          regional_option: string | null;
          review_status: string;
          reviewer_id: string | null;
          scenario_id: string;
          source_language_code: string | null;
          source_support: Json | null;
          target_variety_id: string;
          turns: NonNullable<Json>;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          id?: string;
          regional_option?: string | null;
          review_status?: string;
          reviewer_id?: string | null;
          scenario_id: string;
          source_language_code?: string | null;
          source_support?: Json | null;
          target_variety_id: string;
          turns?: NonNullable<Json>;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          regional_option?: string | null;
          review_status?: string;
          reviewer_id?: string | null;
          scenario_id?: string;
          source_language_code?: string | null;
          source_support?: Json | null;
          target_variety_id?: string;
          turns?: NonNullable<Json>;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'dialogue_variants_scenario_id_fkey';
            columns: ['scenario_id'];
            isOneToOne: false;
            referencedRelation: 'dialogue_scenarios';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'dialogue_variants_source_language_code_fkey';
            columns: ['source_language_code'];
            isOneToOne: false;
            referencedRelation: 'languages';
            referencedColumns: ['code'];
          },
          {
            foreignKeyName: 'dialogue_variants_target_variety_id_fkey';
            columns: ['target_variety_id'];
            isOneToOne: false;
            referencedRelation: 'language_varieties';
            referencedColumns: ['id'];
          },
        ];
      };
      expression_audio: {
        Row: {
          asset_id: string;
          created_at: string;
          expression_id: string;
          id: string;
          quality_flag: string;
          regional_option: string | null;
          reviewed: boolean;
          speaker_id: string | null;
          speech_rate: string;
          synthetic: boolean;
          updated_at: string;
          voice_id: string;
        };
        ComputedFields: never;
        Insert: {
          asset_id: string;
          created_at?: string;
          expression_id: string;
          id?: string;
          quality_flag?: string;
          regional_option?: string | null;
          reviewed?: boolean;
          speaker_id?: string | null;
          speech_rate?: string;
          synthetic?: boolean;
          updated_at?: string;
          voice_id: string;
        };
        Update: {
          asset_id?: string;
          created_at?: string;
          expression_id?: string;
          id?: string;
          quality_flag?: string;
          regional_option?: string | null;
          reviewed?: boolean;
          speaker_id?: string | null;
          speech_rate?: string;
          synthetic?: boolean;
          updated_at?: string;
          voice_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'expression_audio_asset_id_fkey';
            columns: ['asset_id'];
            isOneToOne: false;
            referencedRelation: 'media_assets';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'expression_audio_asset_id_fkey';
            columns: ['asset_id'];
            isOneToOne: false;
            referencedRelation: 'media_assets_staff';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'expression_audio_expression_id_fkey';
            columns: ['expression_id'];
            isOneToOne: false;
            referencedRelation: 'expressions';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'expression_audio_speaker_fkey';
            columns: ['speaker_id'];
            isOneToOne: false;
            referencedRelation: 'speakers';
            referencedColumns: ['id'];
          },
        ];
      };
      expression_forms: {
        Row: {
          created_at: string;
          expression_id: string;
          id: string;
          ipa: string | null;
          script: string | null;
          text: string;
          tone_markers: string[] | null;
          transliteration_scheme: string | null;
          updated_at: string;
          word_alignment: NonNullable<Json>;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          expression_id: string;
          id?: string;
          ipa?: string | null;
          script?: string | null;
          text: string;
          tone_markers?: string[] | null;
          transliteration_scheme?: string | null;
          updated_at?: string;
          word_alignment?: NonNullable<Json>;
        };
        Update: {
          created_at?: string;
          expression_id?: string;
          id?: string;
          ipa?: string | null;
          script?: string | null;
          text?: string;
          tone_markers?: string[] | null;
          transliteration_scheme?: string | null;
          updated_at?: string;
          word_alignment?: NonNullable<Json>;
        };
        Relationships: [
          {
            foreignKeyName: 'expression_forms_expression_id_fkey';
            columns: ['expression_id'];
            isOneToOne: false;
            referencedRelation: 'expressions';
            referencedColumns: ['id'];
          },
        ];
      };
      expression_translations: {
        Row: {
          context_note: string | null;
          created_at: string;
          expression_id: string;
          id: string;
          literal_gloss: string | null;
          natural_meaning: string;
          qa_state: string;
          reviewer_id: string | null;
          source_language_code: string;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          context_note?: string | null;
          created_at?: string;
          expression_id: string;
          id?: string;
          literal_gloss?: string | null;
          natural_meaning: string;
          qa_state?: string;
          reviewer_id?: string | null;
          source_language_code: string;
          updated_at?: string;
        };
        Update: {
          context_note?: string | null;
          created_at?: string;
          expression_id?: string;
          id?: string;
          literal_gloss?: string | null;
          natural_meaning?: string;
          qa_state?: string;
          reviewer_id?: string | null;
          source_language_code?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'expression_translations_expression_id_fkey';
            columns: ['expression_id'];
            isOneToOne: false;
            referencedRelation: 'expressions';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'expression_translations_source_language_code_fkey';
            columns: ['source_language_code'];
            isOneToOne: false;
            referencedRelation: 'languages';
            referencedColumns: ['code'];
          },
        ];
      };
      expressions: {
        Row: {
          canonical_text: string;
          content_rights_id: string | null;
          created_at: string;
          difficulty: number;
          id: string;
          intent_id: string;
          origin: string;
          phonetic_annotations: NonNullable<Json>;
          register: string;
          reviewed: boolean;
          reviewer_id: string | null;
          scenario_tags: string[];
          script_annotations: NonNullable<Json>;
          state: string;
          target_variety_id: string;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          canonical_text: string;
          content_rights_id?: string | null;
          created_at?: string;
          difficulty?: number;
          id?: string;
          intent_id: string;
          origin?: string;
          phonetic_annotations?: NonNullable<Json>;
          register?: string;
          reviewed?: boolean;
          reviewer_id?: string | null;
          scenario_tags?: string[];
          script_annotations?: NonNullable<Json>;
          state?: string;
          target_variety_id: string;
          updated_at?: string;
        };
        Update: {
          canonical_text?: string;
          content_rights_id?: string | null;
          created_at?: string;
          difficulty?: number;
          id?: string;
          intent_id?: string;
          origin?: string;
          phonetic_annotations?: NonNullable<Json>;
          register?: string;
          reviewed?: boolean;
          reviewer_id?: string | null;
          scenario_tags?: string[];
          script_annotations?: NonNullable<Json>;
          state?: string;
          target_variety_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'expressions_content_rights_id_fkey';
            columns: ['content_rights_id'];
            isOneToOne: false;
            referencedRelation: 'content_rights';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'expressions_intent_id_fkey';
            columns: ['intent_id'];
            isOneToOne: false;
            referencedRelation: 'communicative_intents';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'expressions_target_variety_id_fkey';
            columns: ['target_variety_id'];
            isOneToOne: false;
            referencedRelation: 'language_varieties';
            referencedColumns: ['id'];
          },
        ];
      };
      feedback_reports: {
        Row: {
          category: string;
          course_track_id: string | null;
          created_at: string;
          enrollment_id: string | null;
          entity_id: string | null;
          entity_table: string | null;
          id: string;
          message: string;
          resolved_by: string | null;
          status: string;
          updated_at: string;
          user_id: string | null;
        };
        ComputedFields: never;
        Insert: {
          category: string;
          course_track_id?: string | null;
          created_at?: string;
          enrollment_id?: string | null;
          entity_id?: string | null;
          entity_table?: string | null;
          id?: string;
          message: string;
          resolved_by?: string | null;
          status?: string;
          updated_at?: string;
          user_id?: string | null;
        };
        Update: {
          category?: string;
          course_track_id?: string | null;
          created_at?: string;
          enrollment_id?: string | null;
          entity_id?: string | null;
          entity_table?: string | null;
          id?: string;
          message?: string;
          resolved_by?: string | null;
          status?: string;
          updated_at?: string;
          user_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'feedback_reports_course_track_id_fkey';
            columns: ['course_track_id'];
            isOneToOne: false;
            referencedRelation: 'course_tracks';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'feedback_reports_enrollment_id_fkey';
            columns: ['enrollment_id'];
            isOneToOne: false;
            referencedRelation: 'user_course_enrollments';
            referencedColumns: ['id'];
          },
        ];
      };
      language_varieties: {
        Row: {
          alternative_names: string[];
          bcp47_locale: string | null;
          code_switch_norms: string;
          created_at: string;
          dialect_name: string;
          id: string;
          language_id: string;
          localized_voice_settings: NonNullable<Json>;
          must_not_substitute: string[];
          regional_notes: string;
          tonal: boolean;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          alternative_names?: string[];
          bcp47_locale?: string | null;
          code_switch_norms?: string;
          created_at?: string;
          dialect_name: string;
          id: string;
          language_id: string;
          localized_voice_settings?: NonNullable<Json>;
          must_not_substitute?: string[];
          regional_notes?: string;
          tonal?: boolean;
          updated_at?: string;
        };
        Update: {
          alternative_names?: string[];
          bcp47_locale?: string | null;
          code_switch_norms?: string;
          created_at?: string;
          dialect_name?: string;
          id?: string;
          language_id?: string;
          localized_voice_settings?: NonNullable<Json>;
          must_not_substitute?: string[];
          regional_notes?: string;
          tonal?: boolean;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'language_varieties_language_id_fkey';
            columns: ['language_id'];
            isOneToOne: false;
            referencedRelation: 'languages';
            referencedColumns: ['id'];
          },
        ];
      };
      languages: {
        Row: {
          code: string;
          created_at: string;
          default_script: string;
          english_name: string;
          id: string;
          native_name: string;
          plural_categories: string[];
          rtl: boolean;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          code: string;
          created_at?: string;
          default_script: string;
          english_name: string;
          id: string;
          native_name: string;
          plural_categories?: string[];
          rtl?: boolean;
          updated_at?: string;
        };
        Update: {
          code?: string;
          created_at?: string;
          default_script?: string;
          english_name?: string;
          id?: string;
          native_name?: string;
          plural_categories?: string[];
          rtl?: boolean;
          updated_at?: string;
        };
        Relationships: [];
      };
      learning_observations: {
        Row: {
          asr_version: string | null;
          autonomy: string;
          conversation_session_id: string | null;
          created_at: string;
          enrollment_id: string;
          expression_id: string | null;
          feedback_evidence: Json | null;
          hints_used: number;
          id: string;
          intelligibility: string | null;
          mission_attempt_id: string | null;
          mission_id: string | null;
          observation_type: string;
          observed_at: string;
          outcome: string;
          pronunciation_confidence: string | null;
          pronunciation_mode: string | null;
          scenario_id: string;
          scorer_kind: string;
          scorer_version: string;
          skill_key: string;
          uncertainty: number;
          user_id: string;
          utterance_confidence: number | null;
        };
        ComputedFields: never;
        Insert: {
          asr_version?: string | null;
          autonomy: string;
          conversation_session_id?: string | null;
          created_at?: string;
          enrollment_id: string;
          expression_id?: string | null;
          feedback_evidence?: Json | null;
          hints_used?: number;
          id?: string;
          intelligibility?: string | null;
          mission_attempt_id?: string | null;
          mission_id?: string | null;
          observation_type: string;
          observed_at?: string;
          outcome: string;
          pronunciation_confidence?: string | null;
          pronunciation_mode?: string | null;
          scenario_id: string;
          scorer_kind: string;
          scorer_version: string;
          skill_key: string;
          uncertainty?: number;
          user_id: string;
          utterance_confidence?: number | null;
        };
        Update: {
          asr_version?: string | null;
          autonomy?: string;
          conversation_session_id?: string | null;
          created_at?: string;
          enrollment_id?: string;
          expression_id?: string | null;
          feedback_evidence?: Json | null;
          hints_used?: number;
          id?: string;
          intelligibility?: string | null;
          mission_attempt_id?: string | null;
          mission_id?: string | null;
          observation_type?: string;
          observed_at?: string;
          outcome?: string;
          pronunciation_confidence?: string | null;
          pronunciation_mode?: string | null;
          scenario_id?: string;
          scorer_kind?: string;
          scorer_version?: string;
          skill_key?: string;
          uncertainty?: number;
          user_id?: string;
          utterance_confidence?: number | null;
        };
        Relationships: [
          {
            foreignKeyName: 'learning_observations_attempt_fkey';
            columns: ['mission_attempt_id'];
            isOneToOne: false;
            referencedRelation: 'mission_attempts';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'learning_observations_conversation_session_id_fkey';
            columns: ['conversation_session_id'];
            isOneToOne: false;
            referencedRelation: 'conversation_sessions';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'learning_observations_enrollment_id_fkey';
            columns: ['enrollment_id'];
            isOneToOne: false;
            referencedRelation: 'user_course_enrollments';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'learning_observations_expression_id_fkey';
            columns: ['expression_id'];
            isOneToOne: false;
            referencedRelation: 'expressions';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'learning_observations_mission_id_fkey';
            columns: ['mission_id'];
            isOneToOne: false;
            referencedRelation: 'missions';
            referencedColumns: ['id'];
          },
        ];
      };
      lesson_courses: {
        Row: {
          content_rights_id: string | null;
          course_track_id: string;
          cover_visual_asset_id: string | null;
          created_at: string;
          description_translations: NonNullable<Json>;
          id: string;
          published_revision: number | null;
          sort_order: number;
          state: string;
          title_translations: NonNullable<Json>;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          content_rights_id?: string | null;
          course_track_id: string;
          cover_visual_asset_id?: string | null;
          created_at?: string;
          description_translations?: NonNullable<Json>;
          id?: string;
          published_revision?: number | null;
          sort_order?: number;
          state?: string;
          title_translations?: NonNullable<Json>;
          updated_at?: string;
        };
        Update: {
          content_rights_id?: string | null;
          course_track_id?: string;
          cover_visual_asset_id?: string | null;
          created_at?: string;
          description_translations?: NonNullable<Json>;
          id?: string;
          published_revision?: number | null;
          sort_order?: number;
          state?: string;
          title_translations?: NonNullable<Json>;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'lesson_courses_content_rights_id_fkey';
            columns: ['content_rights_id'];
            isOneToOne: false;
            referencedRelation: 'content_rights';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'lesson_courses_course_track_id_fkey';
            columns: ['course_track_id'];
            isOneToOne: false;
            referencedRelation: 'course_tracks';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'lesson_courses_cover_fkey';
            columns: ['cover_visual_asset_id'];
            isOneToOne: false;
            referencedRelation: 'visual_assets';
            referencedColumns: ['id'];
          },
        ];
      };
      lesson_speakers: {
        Row: {
          created_at: string;
          id: string;
          lesson_id: string;
          role: string;
          speaker_id: string;
          updated_at: string;
          voice_segments: Json | null;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          id?: string;
          lesson_id: string;
          role?: string;
          speaker_id: string;
          updated_at?: string;
          voice_segments?: Json | null;
        };
        Update: {
          created_at?: string;
          id?: string;
          lesson_id?: string;
          role?: string;
          speaker_id?: string;
          updated_at?: string;
          voice_segments?: Json | null;
        };
        Relationships: [
          {
            foreignKeyName: 'lesson_speakers_lesson_id_fkey';
            columns: ['lesson_id'];
            isOneToOne: false;
            referencedRelation: 'audio_lessons';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'lesson_speakers_speaker_id_fkey';
            columns: ['speaker_id'];
            isOneToOne: false;
            referencedRelation: 'speakers';
            referencedColumns: ['id'];
          },
        ];
      };
      lesson_tags: {
        Row: {
          created_at: string;
          id: string;
          lesson_id: string;
          tag: string;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          id?: string;
          lesson_id: string;
          tag: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          lesson_id?: string;
          tag?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'lesson_tags_lesson_id_fkey';
            columns: ['lesson_id'];
            isOneToOne: false;
            referencedRelation: 'audio_lessons';
            referencedColumns: ['id'];
          },
        ];
      };
      lesson_topics: {
        Row: {
          confidence: number | null;
          created_at: string;
          id: string;
          lesson_id: string;
          provenance: string;
          topic_key: string;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          confidence?: number | null;
          created_at?: string;
          id?: string;
          lesson_id: string;
          provenance?: string;
          topic_key: string;
          updated_at?: string;
        };
        Update: {
          confidence?: number | null;
          created_at?: string;
          id?: string;
          lesson_id?: string;
          provenance?: string;
          topic_key?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'lesson_topics_lesson_id_fkey';
            columns: ['lesson_id'];
            isOneToOne: false;
            referencedRelation: 'audio_lessons';
            referencedColumns: ['id'];
          },
        ];
      };
      mascot_animations: {
        Row: {
          animation: string | null;
          created_at: string;
          duration_ms: number | null;
          format: string;
          id: string;
          loop: boolean;
          review_status: string;
          size_variant: string;
          state: string | null;
          static_visual_asset_id: string;
          style_version: string;
          updated_at: string;
          visual_asset_id: string;
        };
        ComputedFields: never;
        Insert: {
          animation?: string | null;
          created_at?: string;
          duration_ms?: number | null;
          format: string;
          id?: string;
          loop?: boolean;
          review_status?: string;
          size_variant?: string;
          state?: string | null;
          static_visual_asset_id: string;
          style_version: string;
          updated_at?: string;
          visual_asset_id: string;
        };
        Update: {
          animation?: string | null;
          created_at?: string;
          duration_ms?: number | null;
          format?: string;
          id?: string;
          loop?: boolean;
          review_status?: string;
          size_variant?: string;
          state?: string | null;
          static_visual_asset_id?: string;
          style_version?: string;
          updated_at?: string;
          visual_asset_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'mascot_animations_static_visual_asset_id_fkey';
            columns: ['static_visual_asset_id'];
            isOneToOne: false;
            referencedRelation: 'visual_assets';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'mascot_animations_visual_asset_id_fkey';
            columns: ['visual_asset_id'];
            isOneToOne: false;
            referencedRelation: 'visual_assets';
            referencedColumns: ['id'];
          },
        ];
      };
      media_assets: {
        Row: {
          bitrate_kbps: number | null;
          bucket: string;
          byte_length: number;
          channels: number | null;
          checksum_sha256: string;
          content_rights_id: string | null;
          created_at: string;
          derivation: string | null;
          disposition: string;
          duration_ms: number | null;
          etag: string | null;
          id: string;
          kind: string;
          legacy_filename: string | null;
          legacy_path: string | null;
          mime_type: string;
          owner_id: string | null;
          sample_rate_hz: number | null;
          source_asset_id: string | null;
          state: string;
          storage_key: string;
          updated_at: string;
          visibility: string;
        };
        ComputedFields: never;
        Insert: {
          bitrate_kbps?: number | null;
          bucket: string;
          byte_length: number;
          channels?: number | null;
          checksum_sha256: string;
          content_rights_id?: string | null;
          created_at?: string;
          derivation?: string | null;
          disposition?: string;
          duration_ms?: number | null;
          etag?: string | null;
          id?: string;
          kind: string;
          legacy_filename?: string | null;
          legacy_path?: string | null;
          mime_type: string;
          owner_id?: string | null;
          sample_rate_hz?: number | null;
          source_asset_id?: string | null;
          state?: string;
          storage_key: string;
          updated_at?: string;
          visibility?: string;
        };
        Update: {
          bitrate_kbps?: number | null;
          bucket?: string;
          byte_length?: number;
          channels?: number | null;
          checksum_sha256?: string;
          content_rights_id?: string | null;
          created_at?: string;
          derivation?: string | null;
          disposition?: string;
          duration_ms?: number | null;
          etag?: string | null;
          id?: string;
          kind?: string;
          legacy_filename?: string | null;
          legacy_path?: string | null;
          mime_type?: string;
          owner_id?: string | null;
          sample_rate_hz?: number | null;
          source_asset_id?: string | null;
          state?: string;
          storage_key?: string;
          updated_at?: string;
          visibility?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'media_assets_content_rights_id_fkey';
            columns: ['content_rights_id'];
            isOneToOne: false;
            referencedRelation: 'content_rights';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'media_assets_source_asset_id_fkey';
            columns: ['source_asset_id'];
            isOneToOne: false;
            referencedRelation: 'media_assets';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'media_assets_source_asset_id_fkey';
            columns: ['source_asset_id'];
            isOneToOne: false;
            referencedRelation: 'media_assets_staff';
            referencedColumns: ['id'];
          },
        ];
      };
      mission_attempts: {
        Row: {
          abandoned_at: string | null;
          client_attempt_id: string;
          completed_at: string | null;
          created_at: string;
          current_step_index: number;
          enrollment_id: string;
          evaluation: Json | null;
          id: string;
          mission_id: string;
          mission_revision: number;
          objectives_completed: string[];
          started_at: string;
          step_results: NonNullable<Json>;
          updated_at: string;
          user_id: string;
          xp_awarded: number;
        };
        ComputedFields: never;
        Insert: {
          abandoned_at?: string | null;
          client_attempt_id: string;
          completed_at?: string | null;
          created_at?: string;
          current_step_index?: number;
          enrollment_id: string;
          evaluation?: Json | null;
          id?: string;
          mission_id: string;
          mission_revision?: number;
          objectives_completed?: string[];
          started_at?: string;
          step_results?: NonNullable<Json>;
          updated_at?: string;
          user_id: string;
          xp_awarded?: number;
        };
        Update: {
          abandoned_at?: string | null;
          client_attempt_id?: string;
          completed_at?: string | null;
          created_at?: string;
          current_step_index?: number;
          enrollment_id?: string;
          evaluation?: Json | null;
          id?: string;
          mission_id?: string;
          mission_revision?: number;
          objectives_completed?: string[];
          started_at?: string;
          step_results?: NonNullable<Json>;
          updated_at?: string;
          user_id?: string;
          xp_awarded?: number;
        };
        Relationships: [
          {
            foreignKeyName: 'mission_attempts_enrollment_id_fkey';
            columns: ['enrollment_id'];
            isOneToOne: false;
            referencedRelation: 'user_course_enrollments';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'mission_attempts_mission_id_fkey';
            columns: ['mission_id'];
            isOneToOne: false;
            referencedRelation: 'missions';
            referencedColumns: ['id'];
          },
        ];
      };
      mission_evidence_claims: {
        Row: {
          attempt_id: string;
          claimed_at: string;
          evidence_id: string;
          evidence_kind: string;
          user_id: string;
        };
        ComputedFields: never;
        Insert: {
          attempt_id: string;
          claimed_at?: string;
          evidence_id: string;
          evidence_kind: string;
          user_id: string;
        };
        Update: {
          attempt_id?: string;
          claimed_at?: string;
          evidence_id?: string;
          evidence_kind?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'mission_evidence_claims_attempt_id_fkey';
            columns: ['attempt_id'];
            isOneToOne: false;
            referencedRelation: 'mission_attempts';
            referencedColumns: ['id'];
          },
        ];
      };
      mission_graph_edges: {
        Row: {
          branch_condition: Json | null;
          character_memory_change: Json | null;
          created_at: string;
          edge_type: string;
          from_mission_id: string;
          id: string;
          reward: Json | null;
          to_mission_id: string;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          branch_condition?: Json | null;
          character_memory_change?: Json | null;
          created_at?: string;
          edge_type: string;
          from_mission_id: string;
          id?: string;
          reward?: Json | null;
          to_mission_id: string;
          updated_at?: string;
        };
        Update: {
          branch_condition?: Json | null;
          character_memory_change?: Json | null;
          created_at?: string;
          edge_type?: string;
          from_mission_id?: string;
          id?: string;
          reward?: Json | null;
          to_mission_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'mission_graph_edges_from_mission_id_fkey';
            columns: ['from_mission_id'];
            isOneToOne: false;
            referencedRelation: 'missions';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'mission_graph_edges_to_mission_id_fkey';
            columns: ['to_mission_id'];
            isOneToOne: false;
            referencedRelation: 'missions';
            referencedColumns: ['id'];
          },
        ];
      };
      mission_localizations: {
        Row: {
          created_at: string;
          help_text: string | null;
          hints: string[];
          id: string;
          instructions: string;
          mission_id: string;
          qa_state: string;
          reviewer_id: string | null;
          source_language_code: string;
          title: string;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          help_text?: string | null;
          hints?: string[];
          id?: string;
          instructions: string;
          mission_id: string;
          qa_state?: string;
          reviewer_id?: string | null;
          source_language_code: string;
          title: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          help_text?: string | null;
          hints?: string[];
          id?: string;
          instructions?: string;
          mission_id?: string;
          qa_state?: string;
          reviewer_id?: string | null;
          source_language_code?: string;
          title?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'mission_localizations_mission_id_fkey';
            columns: ['mission_id'];
            isOneToOne: false;
            referencedRelation: 'missions';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'mission_localizations_source_language_code_fkey';
            columns: ['source_language_code'];
            isOneToOne: false;
            referencedRelation: 'languages';
            referencedColumns: ['code'];
          },
        ];
      };
      mission_progress: {
        Row: {
          best_attempt_id: string | null;
          completed_without_hints: boolean;
          completions: number;
          created_at: string;
          enrollment_id: string;
          first_completed_at: string | null;
          id: string;
          last_completed_at: string | null;
          mission_id: string;
          revision: number;
          status: string;
          updated_at: string;
          user_id: string;
        };
        ComputedFields: never;
        Insert: {
          best_attempt_id?: string | null;
          completed_without_hints?: boolean;
          completions?: number;
          created_at?: string;
          enrollment_id: string;
          first_completed_at?: string | null;
          id?: string;
          last_completed_at?: string | null;
          mission_id: string;
          revision?: number;
          status?: string;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          best_attempt_id?: string | null;
          completed_without_hints?: boolean;
          completions?: number;
          created_at?: string;
          enrollment_id?: string;
          first_completed_at?: string | null;
          id?: string;
          last_completed_at?: string | null;
          mission_id?: string;
          revision?: number;
          status?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'mission_progress_best_attempt_id_fkey';
            columns: ['best_attempt_id'];
            isOneToOne: false;
            referencedRelation: 'mission_attempts';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'mission_progress_enrollment_id_fkey';
            columns: ['enrollment_id'];
            isOneToOne: false;
            referencedRelation: 'user_course_enrollments';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'mission_progress_mission_id_fkey';
            columns: ['mission_id'];
            isOneToOne: false;
            referencedRelation: 'missions';
            referencedColumns: ['id'];
          },
        ];
      };
      mission_steps: {
        Row: {
          branching: Json | null;
          created_at: string;
          estimated_seconds: number;
          hint_scaffold: string[];
          id: string;
          lesson_type: string | null;
          mission_id: string;
          offline_capable: boolean;
          prompt_asset_ids: string[];
          sort_order: number;
          step_type: string;
          success_conditions: NonNullable<Json>;
          target_expression_ids: string[];
          updated_at: string;
          valid_intent_ids: string[];
          visual_asset_ids: string[];
        };
        ComputedFields: never;
        Insert: {
          branching?: Json | null;
          created_at?: string;
          estimated_seconds?: number;
          hint_scaffold?: string[];
          id?: string;
          lesson_type?: string | null;
          mission_id: string;
          offline_capable?: boolean;
          prompt_asset_ids?: string[];
          sort_order?: number;
          step_type: string;
          success_conditions?: NonNullable<Json>;
          target_expression_ids?: string[];
          updated_at?: string;
          valid_intent_ids?: string[];
          visual_asset_ids?: string[];
        };
        Update: {
          branching?: Json | null;
          created_at?: string;
          estimated_seconds?: number;
          hint_scaffold?: string[];
          id?: string;
          lesson_type?: string | null;
          mission_id?: string;
          offline_capable?: boolean;
          prompt_asset_ids?: string[];
          sort_order?: number;
          step_type?: string;
          success_conditions?: NonNullable<Json>;
          target_expression_ids?: string[];
          updated_at?: string;
          valid_intent_ids?: string[];
          visual_asset_ids?: string[];
        };
        Relationships: [
          {
            foreignKeyName: 'mission_steps_mission_id_fkey';
            columns: ['mission_id'];
            isOneToOne: false;
            referencedRelation: 'missions';
            referencedColumns: ['id'];
          },
        ];
      };
      mission_visual_bindings: {
        Row: {
          created_at: string;
          id: string;
          mission_id: string;
          mission_step_id: string | null;
          role: string;
          semantic_labels: string[];
          sort_order: number;
          updated_at: string;
          variety_specific: boolean;
          visual_asset_id: string;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          id?: string;
          mission_id: string;
          mission_step_id?: string | null;
          role: string;
          semantic_labels?: string[];
          sort_order?: number;
          updated_at?: string;
          variety_specific?: boolean;
          visual_asset_id: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          mission_id?: string;
          mission_step_id?: string | null;
          role?: string;
          semantic_labels?: string[];
          sort_order?: number;
          updated_at?: string;
          variety_specific?: boolean;
          visual_asset_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'mission_visual_bindings_mission_id_fkey';
            columns: ['mission_id'];
            isOneToOne: false;
            referencedRelation: 'missions';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'mission_visual_bindings_mission_step_id_fkey';
            columns: ['mission_step_id'];
            isOneToOne: false;
            referencedRelation: 'mission_steps';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'mission_visual_bindings_visual_asset_id_fkey';
            columns: ['visual_asset_id'];
            isOneToOne: false;
            referencedRelation: 'visual_assets';
            referencedColumns: ['id'];
          },
        ];
      };
      missions: {
        Row: {
          chapter_id: string | null;
          created_at: string;
          difficulty: number;
          goals: NonNullable<Json>;
          id: string;
          level: string;
          mission_type: string;
          narrative_segment: Json | null;
          prerequisite_skill_keys: string[];
          published_revision: number | null;
          recommended_minutes: number;
          scoring_rubric: NonNullable<Json>;
          sort_order: number;
          state: string;
          target_variety_id: string;
          template_key: string | null;
          title_translations: NonNullable<Json>;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          chapter_id?: string | null;
          created_at?: string;
          difficulty?: number;
          goals?: NonNullable<Json>;
          id?: string;
          level?: string;
          mission_type?: string;
          narrative_segment?: Json | null;
          prerequisite_skill_keys?: string[];
          published_revision?: number | null;
          recommended_minutes?: number;
          scoring_rubric?: NonNullable<Json>;
          sort_order?: number;
          state?: string;
          target_variety_id: string;
          template_key?: string | null;
          title_translations?: NonNullable<Json>;
          updated_at?: string;
        };
        Update: {
          chapter_id?: string | null;
          created_at?: string;
          difficulty?: number;
          goals?: NonNullable<Json>;
          id?: string;
          level?: string;
          mission_type?: string;
          narrative_segment?: Json | null;
          prerequisite_skill_keys?: string[];
          published_revision?: number | null;
          recommended_minutes?: number;
          scoring_rubric?: NonNullable<Json>;
          sort_order?: number;
          state?: string;
          target_variety_id?: string;
          template_key?: string | null;
          title_translations?: NonNullable<Json>;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'missions_chapter_id_fkey';
            columns: ['chapter_id'];
            isOneToOne: false;
            referencedRelation: 'chapters';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'missions_target_variety_id_fkey';
            columns: ['target_variety_id'];
            isOneToOne: false;
            referencedRelation: 'language_varieties';
            referencedColumns: ['id'];
          },
        ];
      };
      moderation_incidents: {
        Row: {
          action_taken: string | null;
          created_at: string;
          details: NonNullable<Json>;
          id: string;
          kind: string;
          reviewed_by: string | null;
          session_id: string | null;
          severity: string;
          status: string;
          updated_at: string;
          user_id: string | null;
        };
        ComputedFields: never;
        Insert: {
          action_taken?: string | null;
          created_at?: string;
          details?: NonNullable<Json>;
          id?: string;
          kind: string;
          reviewed_by?: string | null;
          session_id?: string | null;
          severity?: string;
          status?: string;
          updated_at?: string;
          user_id?: string | null;
        };
        Update: {
          action_taken?: string | null;
          created_at?: string;
          details?: NonNullable<Json>;
          id?: string;
          kind?: string;
          reviewed_by?: string | null;
          session_id?: string | null;
          severity?: string;
          status?: string;
          updated_at?: string;
          user_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'moderation_incidents_session_id_fkey';
            columns: ['session_id'];
            isOneToOne: false;
            referencedRelation: 'conversation_sessions';
            referencedColumns: ['id'];
          },
        ];
      };
      notification_deliveries: {
        Row: {
          category: string;
          channel: string;
          created_at: string;
          error: string | null;
          id: string;
          locale: string;
          provider_message_id: string | null;
          sent_at: string | null;
          status: string;
          template_key: string;
          user_id: string;
        };
        ComputedFields: never;
        Insert: {
          category: string;
          channel: string;
          created_at?: string;
          error?: string | null;
          id?: string;
          locale: string;
          provider_message_id?: string | null;
          sent_at?: string | null;
          status?: string;
          template_key: string;
          user_id: string;
        };
        Update: {
          category?: string;
          channel?: string;
          created_at?: string;
          error?: string | null;
          id?: string;
          locale?: string;
          provider_message_id?: string | null;
          sent_at?: string | null;
          status?: string;
          template_key?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      notification_settings: {
        Row: {
          categories: NonNullable<Json>;
          channel: string;
          created_at: string;
          enabled: boolean;
          id: string;
          platform: string | null;
          push_token: string | null;
          quiet_hours: Json | null;
          reminder_time_local: string | null;
          updated_at: string;
          user_id: string;
        };
        ComputedFields: never;
        Insert: {
          categories?: NonNullable<Json>;
          channel: string;
          created_at?: string;
          enabled?: boolean;
          id?: string;
          platform?: string | null;
          push_token?: string | null;
          quiet_hours?: Json | null;
          reminder_time_local?: string | null;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          categories?: NonNullable<Json>;
          channel?: string;
          created_at?: string;
          enabled?: boolean;
          id?: string;
          platform?: string | null;
          push_token?: string | null;
          quiet_hours?: Json | null;
          reminder_time_local?: string | null;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      processing_jobs: {
        Row: {
          attempts: number;
          cost_actual_usd: number | null;
          cost_estimate_usd: number | null;
          created_at: string;
          failure_code: string | null;
          failure_message: string | null;
          finished_at: string | null;
          id: string;
          idempotency_key: string;
          job_type: string;
          locked_by: string | null;
          locked_until: string | null;
          max_attempts: number;
          output: Json | null;
          output_asset_ids: string[];
          params: NonNullable<Json>;
          parent_asset_id: string | null;
          parent_entity_id: string | null;
          parent_entity_table: string | null;
          priority: number;
          progress_pct: number;
          provider: string | null;
          requested_by: string | null;
          started_at: string | null;
          state: string;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          attempts?: number;
          cost_actual_usd?: number | null;
          cost_estimate_usd?: number | null;
          created_at?: string;
          failure_code?: string | null;
          failure_message?: string | null;
          finished_at?: string | null;
          id?: string;
          idempotency_key: string;
          job_type: string;
          locked_by?: string | null;
          locked_until?: string | null;
          max_attempts?: number;
          output?: Json | null;
          output_asset_ids?: string[];
          params?: NonNullable<Json>;
          parent_asset_id?: string | null;
          parent_entity_id?: string | null;
          parent_entity_table?: string | null;
          priority?: number;
          progress_pct?: number;
          provider?: string | null;
          requested_by?: string | null;
          started_at?: string | null;
          state?: string;
          updated_at?: string;
        };
        Update: {
          attempts?: number;
          cost_actual_usd?: number | null;
          cost_estimate_usd?: number | null;
          created_at?: string;
          failure_code?: string | null;
          failure_message?: string | null;
          finished_at?: string | null;
          id?: string;
          idempotency_key?: string;
          job_type?: string;
          locked_by?: string | null;
          locked_until?: string | null;
          max_attempts?: number;
          output?: Json | null;
          output_asset_ids?: string[];
          params?: NonNullable<Json>;
          parent_asset_id?: string | null;
          parent_entity_id?: string | null;
          parent_entity_table?: string | null;
          priority?: number;
          progress_pct?: number;
          provider?: string | null;
          requested_by?: string | null;
          started_at?: string | null;
          state?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'processing_jobs_parent_asset_id_fkey';
            columns: ['parent_asset_id'];
            isOneToOne: false;
            referencedRelation: 'media_assets';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'processing_jobs_parent_asset_id_fkey';
            columns: ['parent_asset_id'];
            isOneToOne: false;
            referencedRelation: 'media_assets_staff';
            referencedColumns: ['id'];
          },
        ];
      };
      profiles: {
        Row: {
          accessibility_options: NonNullable<Json>;
          created_at: string;
          default_source_language_code: string | null;
          deleted_at: string | null;
          display_name: string | null;
          privacy_options: NonNullable<Json>;
          time_zone: string;
          ui_locale: string;
          updated_at: string;
          user_id: string;
        };
        ComputedFields: never;
        Insert: {
          accessibility_options?: NonNullable<Json>;
          created_at?: string;
          default_source_language_code?: string | null;
          deleted_at?: string | null;
          display_name?: string | null;
          privacy_options?: NonNullable<Json>;
          time_zone?: string;
          ui_locale?: string;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          accessibility_options?: NonNullable<Json>;
          created_at?: string;
          default_source_language_code?: string | null;
          deleted_at?: string | null;
          display_name?: string | null;
          privacy_options?: NonNullable<Json>;
          time_zone?: string;
          ui_locale?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'profiles_default_source_language_code_fkey';
            columns: ['default_source_language_code'];
            isOneToOne: false;
            referencedRelation: 'languages';
            referencedColumns: ['code'];
          },
        ];
      };
      publication_events: {
        Row: {
          actor_id: string;
          created_at: string;
          entity_id: string;
          entity_table: string;
          from_state: string | null;
          id: string;
          reason: string | null;
          revision: number;
          rollback_of_event_id: string | null;
          to_state: string;
        };
        ComputedFields: never;
        Insert: {
          actor_id: string;
          created_at?: string;
          entity_id: string;
          entity_table: string;
          from_state?: string | null;
          id?: string;
          reason?: string | null;
          revision: number;
          rollback_of_event_id?: string | null;
          to_state: string;
        };
        Update: {
          actor_id?: string;
          created_at?: string;
          entity_id?: string;
          entity_table?: string;
          from_state?: string | null;
          id?: string;
          reason?: string | null;
          revision?: number;
          rollback_of_event_id?: string | null;
          to_state?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'publication_events_rollback_of_event_id_fkey';
            columns: ['rollback_of_event_id'];
            isOneToOne: false;
            referencedRelation: 'publication_events';
            referencedColumns: ['id'];
          },
        ];
      };
      skill_variants: {
        Row: {
          created_at: string;
          example_expression_ids: string[];
          id: string;
          realization_notes: string;
          review_status: string;
          reviewer_id: string | null;
          reviewer_region: string | null;
          skill_id: string;
          target_variety_id: string;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          example_expression_ids?: string[];
          id?: string;
          realization_notes?: string;
          review_status?: string;
          reviewer_id?: string | null;
          reviewer_region?: string | null;
          skill_id: string;
          target_variety_id: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          example_expression_ids?: string[];
          id?: string;
          realization_notes?: string;
          review_status?: string;
          reviewer_id?: string | null;
          reviewer_region?: string | null;
          skill_id?: string;
          target_variety_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'skill_variants_skill_id_fkey';
            columns: ['skill_id'];
            isOneToOne: false;
            referencedRelation: 'skills';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'skill_variants_target_variety_id_fkey';
            columns: ['target_variety_id'];
            isOneToOne: false;
            referencedRelation: 'language_varieties';
            referencedColumns: ['id'];
          },
        ];
      };
      skills: {
        Row: {
          can_do_statement: string | null;
          cefr_can_do: string | null;
          created_at: string;
          descriptor: string;
          difficulty: number;
          id: string;
          prerequisite_skill_keys: string[];
          skill_key: string;
          target_language_id: string | null;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          can_do_statement?: string | null;
          cefr_can_do?: string | null;
          created_at?: string;
          descriptor: string;
          difficulty?: number;
          id?: string;
          prerequisite_skill_keys?: string[];
          skill_key: string;
          target_language_id?: string | null;
          updated_at?: string;
        };
        Update: {
          can_do_statement?: string | null;
          cefr_can_do?: string | null;
          created_at?: string;
          descriptor?: string;
          difficulty?: number;
          id?: string;
          prerequisite_skill_keys?: string[];
          skill_key?: string;
          target_language_id?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'skills_target_language_id_fkey';
            columns: ['target_language_id'];
            isOneToOne: false;
            referencedRelation: 'languages';
            referencedColumns: ['id'];
          },
        ];
      };
      speakers: {
        Row: {
          consent_state: string;
          content_rights_id: string | null;
          created_at: string;
          display_name: string;
          id: string;
          pseudonymous: boolean;
          region: string | null;
          synthetic: boolean;
          target_variety_id: string | null;
          updated_at: string;
          voice_description: string | null;
        };
        ComputedFields: never;
        Insert: {
          consent_state?: string;
          content_rights_id?: string | null;
          created_at?: string;
          display_name: string;
          id?: string;
          pseudonymous?: boolean;
          region?: string | null;
          synthetic?: boolean;
          target_variety_id?: string | null;
          updated_at?: string;
          voice_description?: string | null;
        };
        Update: {
          consent_state?: string;
          content_rights_id?: string | null;
          created_at?: string;
          display_name?: string;
          id?: string;
          pseudonymous?: boolean;
          region?: string | null;
          synthetic?: boolean;
          target_variety_id?: string | null;
          updated_at?: string;
          voice_description?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'speakers_content_rights_id_fkey';
            columns: ['content_rights_id'];
            isOneToOne: false;
            referencedRelation: 'content_rights';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'speakers_target_variety_id_fkey';
            columns: ['target_variety_id'];
            isOneToOne: false;
            referencedRelation: 'language_varieties';
            referencedColumns: ['id'];
          },
        ];
      };
      story_arcs: {
        Row: {
          character_ids: string[];
          course_track_id: string;
          created_at: string;
          id: string;
          learner_memory_schema: NonNullable<Json>;
          milestones: NonNullable<Json>;
          region: string;
          state: string;
          title_translations: NonNullable<Json>;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          character_ids?: string[];
          course_track_id: string;
          created_at?: string;
          id?: string;
          learner_memory_schema?: NonNullable<Json>;
          milestones?: NonNullable<Json>;
          region: string;
          state?: string;
          title_translations?: NonNullable<Json>;
          updated_at?: string;
        };
        Update: {
          character_ids?: string[];
          course_track_id?: string;
          created_at?: string;
          id?: string;
          learner_memory_schema?: NonNullable<Json>;
          milestones?: NonNullable<Json>;
          region?: string;
          state?: string;
          title_translations?: NonNullable<Json>;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'story_arcs_course_track_id_fkey';
            columns: ['course_track_id'];
            isOneToOne: false;
            referencedRelation: 'course_tracks';
            referencedColumns: ['id'];
          },
        ];
      };
      streak_activity: {
        Row: {
          activity_date: string;
          created_at: string;
          id: string;
          minutes_active: number;
          missions_completed: number;
          reviews_completed: number;
          speaking_seconds: number;
          time_zone: string;
          updated_at: string;
          user_id: string;
        };
        ComputedFields: never;
        Insert: {
          activity_date: string;
          created_at?: string;
          id?: string;
          minutes_active?: number;
          missions_completed?: number;
          reviews_completed?: number;
          speaking_seconds?: number;
          time_zone?: string;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          activity_date?: string;
          created_at?: string;
          id?: string;
          minutes_active?: number;
          missions_completed?: number;
          reviews_completed?: number;
          speaking_seconds?: number;
          time_zone?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      transcript_segments: {
        Row: {
          confidence: number | null;
          created_at: string;
          end_ms: number;
          id: string;
          language_code: string | null;
          reviewed: boolean;
          script: string | null;
          sort_index: number;
          speaker_id: string | null;
          speaker_label: string | null;
          start_ms: number;
          target_variety_id: string | null;
          text: string;
          transcript_id: string;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          confidence?: number | null;
          created_at?: string;
          end_ms: number;
          id?: string;
          language_code?: string | null;
          reviewed?: boolean;
          script?: string | null;
          sort_index: number;
          speaker_id?: string | null;
          speaker_label?: string | null;
          start_ms: number;
          target_variety_id?: string | null;
          text: string;
          transcript_id: string;
          updated_at?: string;
        };
        Update: {
          confidence?: number | null;
          created_at?: string;
          end_ms?: number;
          id?: string;
          language_code?: string | null;
          reviewed?: boolean;
          script?: string | null;
          sort_index?: number;
          speaker_id?: string | null;
          speaker_label?: string | null;
          start_ms?: number;
          target_variety_id?: string | null;
          text?: string;
          transcript_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'transcript_segments_speaker_id_fkey';
            columns: ['speaker_id'];
            isOneToOne: false;
            referencedRelation: 'speakers';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'transcript_segments_target_variety_id_fkey';
            columns: ['target_variety_id'];
            isOneToOne: false;
            referencedRelation: 'language_varieties';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'transcript_segments_transcript_id_fkey';
            columns: ['transcript_id'];
            isOneToOne: false;
            referencedRelation: 'transcripts';
            referencedColumns: ['id'];
          },
        ];
      };
      transcript_translations: {
        Row: {
          created_at: string;
          id: string;
          language_code: string;
          qa_state: string;
          quality_flags: string[];
          reviewer_id: string | null;
          segment_id: string;
          text: string;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          id?: string;
          language_code: string;
          qa_state?: string;
          quality_flags?: string[];
          reviewer_id?: string | null;
          segment_id: string;
          text: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          language_code?: string;
          qa_state?: string;
          quality_flags?: string[];
          reviewer_id?: string | null;
          segment_id?: string;
          text?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'transcript_translations_language_code_fkey';
            columns: ['language_code'];
            isOneToOne: false;
            referencedRelation: 'languages';
            referencedColumns: ['code'];
          },
          {
            foreignKeyName: 'transcript_translations_segment_id_fkey';
            columns: ['segment_id'];
            isOneToOne: false;
            referencedRelation: 'transcript_segments';
            referencedColumns: ['id'];
          },
        ];
      };
      transcript_word_alignments: {
        Row: {
          confidence: number | null;
          created_at: string;
          end_ms: number;
          expression_id: string | null;
          id: string;
          segment_id: string;
          start_ms: number;
          updated_at: string;
          word: string;
          word_index: number;
        };
        ComputedFields: never;
        Insert: {
          confidence?: number | null;
          created_at?: string;
          end_ms: number;
          expression_id?: string | null;
          id?: string;
          segment_id: string;
          start_ms: number;
          updated_at?: string;
          word: string;
          word_index: number;
        };
        Update: {
          confidence?: number | null;
          created_at?: string;
          end_ms?: number;
          expression_id?: string | null;
          id?: string;
          segment_id?: string;
          start_ms?: number;
          updated_at?: string;
          word?: string;
          word_index?: number;
        };
        Relationships: [
          {
            foreignKeyName: 'transcript_word_alignments_expression_id_fkey';
            columns: ['expression_id'];
            isOneToOne: false;
            referencedRelation: 'expressions';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'transcript_word_alignments_segment_id_fkey';
            columns: ['segment_id'];
            isOneToOne: false;
            referencedRelation: 'transcript_segments';
            referencedColumns: ['id'];
          },
        ];
      };
      transcripts: {
        Row: {
          access_rights: string;
          coverage_pct: number;
          created_at: string;
          id: string;
          language_mode: string;
          lesson_id: string;
          manually_uploaded: boolean;
          model: string | null;
          primary_language_code: string;
          provider: string | null;
          qa_state: string;
          revision: number;
          source_asset_id: string | null;
          status: string;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          access_rights?: string;
          coverage_pct?: number;
          created_at?: string;
          id?: string;
          language_mode?: string;
          lesson_id: string;
          manually_uploaded?: boolean;
          model?: string | null;
          primary_language_code: string;
          provider?: string | null;
          qa_state?: string;
          revision?: number;
          source_asset_id?: string | null;
          status?: string;
          updated_at?: string;
        };
        Update: {
          access_rights?: string;
          coverage_pct?: number;
          created_at?: string;
          id?: string;
          language_mode?: string;
          lesson_id?: string;
          manually_uploaded?: boolean;
          model?: string | null;
          primary_language_code?: string;
          provider?: string | null;
          qa_state?: string;
          revision?: number;
          source_asset_id?: string | null;
          status?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'transcripts_lesson_id_fkey';
            columns: ['lesson_id'];
            isOneToOne: false;
            referencedRelation: 'audio_lessons';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'transcripts_source_asset_id_fkey';
            columns: ['source_asset_id'];
            isOneToOne: false;
            referencedRelation: 'media_assets';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'transcripts_source_asset_id_fkey';
            columns: ['source_asset_id'];
            isOneToOne: false;
            referencedRelation: 'media_assets_staff';
            referencedColumns: ['id'];
          },
        ];
      };
      uploads: {
        Row: {
          client_checksum_sha256: string;
          completed_parts: NonNullable<Json>;
          created_at: string;
          declared_byte_length: number;
          declared_mime_type: string;
          draft_asset_id: string | null;
          expires_at: string;
          failure_code: string | null;
          id: string;
          idempotency_key: string;
          multipart_upload_id: string | null;
          original_filename: string;
          original_path: string | null;
          part_count: number;
          part_size_bytes: number;
          status: string;
          storage_key: string;
          updated_at: string;
          user_id: string;
          verified_checksum_sha256: string | null;
        };
        ComputedFields: never;
        Insert: {
          client_checksum_sha256: string;
          completed_parts?: NonNullable<Json>;
          created_at?: string;
          declared_byte_length: number;
          declared_mime_type: string;
          draft_asset_id?: string | null;
          expires_at?: string;
          failure_code?: string | null;
          id?: string;
          idempotency_key: string;
          multipart_upload_id?: string | null;
          original_filename: string;
          original_path?: string | null;
          part_count?: number;
          part_size_bytes: number;
          status?: string;
          storage_key: string;
          updated_at?: string;
          user_id: string;
          verified_checksum_sha256?: string | null;
        };
        Update: {
          client_checksum_sha256?: string;
          completed_parts?: NonNullable<Json>;
          created_at?: string;
          declared_byte_length?: number;
          declared_mime_type?: string;
          draft_asset_id?: string | null;
          expires_at?: string;
          failure_code?: string | null;
          id?: string;
          idempotency_key?: string;
          multipart_upload_id?: string | null;
          original_filename?: string;
          original_path?: string | null;
          part_count?: number;
          part_size_bytes?: number;
          status?: string;
          storage_key?: string;
          updated_at?: string;
          user_id?: string;
          verified_checksum_sha256?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'uploads_draft_asset_id_fkey';
            columns: ['draft_asset_id'];
            isOneToOne: false;
            referencedRelation: 'media_assets';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'uploads_draft_asset_id_fkey';
            columns: ['draft_asset_id'];
            isOneToOne: false;
            referencedRelation: 'media_assets_staff';
            referencedColumns: ['id'];
          },
        ];
      };
      user_achievements: {
        Row: {
          achievement_key: string;
          client_event_id: string;
          created_at: string;
          enrollment_id: string | null;
          evidence: Json | null;
          id: string;
          unlocked_at: string;
          updated_at: string;
          user_id: string;
        };
        ComputedFields: never;
        Insert: {
          achievement_key: string;
          client_event_id: string;
          created_at?: string;
          enrollment_id?: string | null;
          evidence?: Json | null;
          id?: string;
          unlocked_at?: string;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          achievement_key?: string;
          client_event_id?: string;
          created_at?: string;
          enrollment_id?: string | null;
          evidence?: Json | null;
          id?: string;
          unlocked_at?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'user_achievements_enrollment_id_fkey';
            columns: ['enrollment_id'];
            isOneToOne: false;
            referencedRelation: 'user_course_enrollments';
            referencedColumns: ['id'];
          },
        ];
      };
      user_audio_progress: {
        Row: {
          completed: boolean;
          completed_at: string | null;
          created_at: string;
          duration_ms: number | null;
          id: string;
          last_client_event_id: string | null;
          last_device_id: string | null;
          last_occurred_at: string | null;
          lesson_id: string;
          play_count: number;
          position_ms: number;
          revision: number;
          updated_at: string;
          user_id: string;
        };
        ComputedFields: never;
        Insert: {
          completed?: boolean;
          completed_at?: string | null;
          created_at?: string;
          duration_ms?: number | null;
          id?: string;
          last_client_event_id?: string | null;
          last_device_id?: string | null;
          last_occurred_at?: string | null;
          lesson_id: string;
          play_count?: number;
          position_ms?: number;
          revision?: number;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          completed?: boolean;
          completed_at?: string | null;
          created_at?: string;
          duration_ms?: number | null;
          id?: string;
          last_client_event_id?: string | null;
          last_device_id?: string | null;
          last_occurred_at?: string | null;
          lesson_id?: string;
          play_count?: number;
          position_ms?: number;
          revision?: number;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'user_audio_progress_lesson_id_fkey';
            columns: ['lesson_id'];
            isOneToOne: false;
            referencedRelation: 'audio_lessons';
            referencedColumns: ['id'];
          },
        ];
      };
      user_course_enrollments: {
        Row: {
          active_mission_id: string | null;
          added_at: string;
          course_track_id: string;
          created_at: string;
          id: string;
          last_opened_at: string | null;
          learner_level: string;
          preferred_learning_speed: string;
          preferred_target_variant_id: string | null;
          regional_preference: string | null;
          script_mode: string;
          source_language_code: string;
          status: string;
          translation_peek_language_code: string | null;
          updated_at: string;
          user_id: string;
        };
        ComputedFields: never;
        Insert: {
          active_mission_id?: string | null;
          added_at?: string;
          course_track_id: string;
          created_at?: string;
          id?: string;
          last_opened_at?: string | null;
          learner_level?: string;
          preferred_learning_speed?: string;
          preferred_target_variant_id?: string | null;
          regional_preference?: string | null;
          script_mode: string;
          source_language_code: string;
          status?: string;
          translation_peek_language_code?: string | null;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          active_mission_id?: string | null;
          added_at?: string;
          course_track_id?: string;
          created_at?: string;
          id?: string;
          last_opened_at?: string | null;
          learner_level?: string;
          preferred_learning_speed?: string;
          preferred_target_variant_id?: string | null;
          regional_preference?: string | null;
          script_mode?: string;
          source_language_code?: string;
          status?: string;
          translation_peek_language_code?: string | null;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'user_course_enrollments_active_mission_fkey';
            columns: ['active_mission_id'];
            isOneToOne: false;
            referencedRelation: 'missions';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'user_course_enrollments_course_track_id_fkey';
            columns: ['course_track_id'];
            isOneToOne: false;
            referencedRelation: 'course_tracks';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'user_course_enrollments_preferred_target_variant_id_fkey';
            columns: ['preferred_target_variant_id'];
            isOneToOne: false;
            referencedRelation: 'language_varieties';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'user_course_enrollments_source_language_code_fkey';
            columns: ['source_language_code'];
            isOneToOne: false;
            referencedRelation: 'languages';
            referencedColumns: ['code'];
          },
          {
            foreignKeyName: 'user_course_enrollments_translation_peek_language_code_fkey';
            columns: ['translation_peek_language_code'];
            isOneToOne: false;
            referencedRelation: 'languages';
            referencedColumns: ['code'];
          },
        ];
      };
      user_download_manifests: {
        Row: {
          checksum: string;
          created_at: string;
          device_id: string | null;
          downloaded_at: string | null;
          id: string;
          lesson_id: string;
          pack_id: string;
          revoked_at: string | null;
          total_bytes: number;
          updated_at: string;
          user_id: string;
          version: number;
        };
        ComputedFields: never;
        Insert: {
          checksum: string;
          created_at?: string;
          device_id?: string | null;
          downloaded_at?: string | null;
          id?: string;
          lesson_id: string;
          pack_id: string;
          revoked_at?: string | null;
          total_bytes: number;
          updated_at?: string;
          user_id: string;
          version?: number;
        };
        Update: {
          checksum?: string;
          created_at?: string;
          device_id?: string | null;
          downloaded_at?: string | null;
          id?: string;
          lesson_id?: string;
          pack_id?: string;
          revoked_at?: string | null;
          total_bytes?: number;
          updated_at?: string;
          user_id?: string;
          version?: number;
        };
        Relationships: [
          {
            foreignKeyName: 'user_download_manifests_lesson_id_fkey';
            columns: ['lesson_id'];
            isOneToOne: false;
            referencedRelation: 'audio_lessons';
            referencedColumns: ['id'];
          },
        ];
      };
      user_expression_reviews: {
        Row: {
          card_state: string;
          created_at: string;
          difficulty: number;
          elapsed_days: number;
          enrollment_id: string;
          expression_id: string | null;
          id: string;
          lapses: number;
          last_hint_count: number;
          last_rating: string | null;
          last_reviewed_at: string | null;
          next_due_at: string;
          recent_scenario_ids: string[];
          reps: number;
          retrievability: number;
          scheduled_days: number;
          scheduler_version: string;
          skill_key: string | null;
          stability: number;
          updated_at: string;
          user_id: string;
        };
        ComputedFields: never;
        Insert: {
          card_state?: string;
          created_at?: string;
          difficulty?: number;
          elapsed_days?: number;
          enrollment_id: string;
          expression_id?: string | null;
          id?: string;
          lapses?: number;
          last_hint_count?: number;
          last_rating?: string | null;
          last_reviewed_at?: string | null;
          next_due_at?: string;
          recent_scenario_ids?: string[];
          reps?: number;
          retrievability?: number;
          scheduled_days?: number;
          scheduler_version?: string;
          skill_key?: string | null;
          stability?: number;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          card_state?: string;
          created_at?: string;
          difficulty?: number;
          elapsed_days?: number;
          enrollment_id?: string;
          expression_id?: string | null;
          id?: string;
          lapses?: number;
          last_hint_count?: number;
          last_rating?: string | null;
          last_reviewed_at?: string | null;
          next_due_at?: string;
          recent_scenario_ids?: string[];
          reps?: number;
          retrievability?: number;
          scheduled_days?: number;
          scheduler_version?: string;
          skill_key?: string | null;
          stability?: number;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'user_expression_reviews_enrollment_id_fkey';
            columns: ['enrollment_id'];
            isOneToOne: false;
            referencedRelation: 'user_course_enrollments';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'user_expression_reviews_expression_id_fkey';
            columns: ['expression_id'];
            isOneToOne: false;
            referencedRelation: 'expressions';
            referencedColumns: ['id'];
          },
        ];
      };
      user_roles: {
        Row: {
          created_at: string;
          expires_at: string | null;
          granted_by: string | null;
          id: string;
          role: string;
          updated_at: string;
          user_id: string;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          expires_at?: string | null;
          granted_by?: string | null;
          id?: string;
          role: string;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          expires_at?: string | null;
          granted_by?: string | null;
          id?: string;
          role?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      user_skill_mastery: {
        Row: {
          created_at: string;
          due_at: string | null;
          enrollment_id: string;
          evidence_count: number;
          id: string;
          internal_score: number;
          last_practiced_at: string | null;
          mastery_state: string;
          skill_key: string;
          uncertainty: number;
          updated_at: string;
          user_id: string;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          due_at?: string | null;
          enrollment_id: string;
          evidence_count?: number;
          id?: string;
          internal_score?: number;
          last_practiced_at?: string | null;
          mastery_state?: string;
          skill_key: string;
          uncertainty?: number;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          due_at?: string | null;
          enrollment_id?: string;
          evidence_count?: number;
          id?: string;
          internal_score?: number;
          last_practiced_at?: string | null;
          mastery_state?: string;
          skill_key?: string;
          uncertainty?: number;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'user_skill_mastery_enrollment_id_fkey';
            columns: ['enrollment_id'];
            isOneToOne: false;
            referencedRelation: 'user_course_enrollments';
            referencedColumns: ['id'];
          },
        ];
      };
      visual_assets: {
        Row: {
          alt_text_key: string;
          alt_text_translations: NonNullable<Json>;
          byte_length: number;
          content_hash: string;
          created_at: string;
          dimensions: NonNullable<Json>;
          dominant_colors: string[];
          focal_point: Json | null;
          generation_brief: Json | null;
          id: string;
          license_id: string | null;
          locale_neutral: boolean;
          mime_type: string;
          moderation_status: string;
          origin: string;
          prompt_template_id: string | null;
          replaced_by_asset_id: string | null;
          review_status: string;
          source_file_asset_id: string | null;
          storage_key: string;
          style_version: string;
          type: string;
          updated_at: string;
          variants: NonNullable<Json>;
        };
        ComputedFields: never;
        Insert: {
          alt_text_key: string;
          alt_text_translations?: NonNullable<Json>;
          byte_length: number;
          content_hash: string;
          created_at?: string;
          dimensions: NonNullable<Json>;
          dominant_colors?: string[];
          focal_point?: Json | null;
          generation_brief?: Json | null;
          id?: string;
          license_id?: string | null;
          locale_neutral?: boolean;
          mime_type: string;
          moderation_status?: string;
          origin: string;
          prompt_template_id?: string | null;
          replaced_by_asset_id?: string | null;
          review_status?: string;
          source_file_asset_id?: string | null;
          storage_key: string;
          style_version: string;
          type: string;
          updated_at?: string;
          variants?: NonNullable<Json>;
        };
        Update: {
          alt_text_key?: string;
          alt_text_translations?: NonNullable<Json>;
          byte_length?: number;
          content_hash?: string;
          created_at?: string;
          dimensions?: NonNullable<Json>;
          dominant_colors?: string[];
          focal_point?: Json | null;
          generation_brief?: Json | null;
          id?: string;
          license_id?: string | null;
          locale_neutral?: boolean;
          mime_type?: string;
          moderation_status?: string;
          origin?: string;
          prompt_template_id?: string | null;
          replaced_by_asset_id?: string | null;
          review_status?: string;
          source_file_asset_id?: string | null;
          storage_key?: string;
          style_version?: string;
          type?: string;
          updated_at?: string;
          variants?: NonNullable<Json>;
        };
        Relationships: [
          {
            foreignKeyName: 'visual_assets_license_id_fkey';
            columns: ['license_id'];
            isOneToOne: false;
            referencedRelation: 'content_rights';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'visual_assets_replaced_by_asset_id_fkey';
            columns: ['replaced_by_asset_id'];
            isOneToOne: false;
            referencedRelation: 'visual_assets';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'visual_assets_source_file_asset_id_fkey';
            columns: ['source_file_asset_id'];
            isOneToOne: false;
            referencedRelation: 'media_assets';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'visual_assets_source_file_asset_id_fkey';
            columns: ['source_file_asset_id'];
            isOneToOne: false;
            referencedRelation: 'media_assets_staff';
            referencedColumns: ['id'];
          },
        ];
      };
      writing_systems: {
        Row: {
          created_at: string;
          direction: string;
          id: string;
          kind: string;
          name: string;
          renderer_rules: NonNullable<Json>;
          renders_script: string | null;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          direction: string;
          id: string;
          kind: string;
          name: string;
          renderer_rules?: NonNullable<Json>;
          renders_script?: string | null;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          direction?: string;
          id?: string;
          kind?: string;
          name?: string;
          renderer_rules?: NonNullable<Json>;
          renders_script?: string | null;
          updated_at?: string;
        };
        Relationships: [];
      };
      xp_ledger: {
        Row: {
          amount: number;
          created_at: string;
          enrollment_id: string | null;
          id: string;
          idempotency_key: string;
          occurred_at: string;
          reason: string;
          reference_id: string | null;
          reference_table: string | null;
          user_id: string;
        };
        ComputedFields: never;
        Insert: {
          amount: number;
          created_at?: string;
          enrollment_id?: string | null;
          id?: string;
          idempotency_key: string;
          occurred_at?: string;
          reason: string;
          reference_id?: string | null;
          reference_table?: string | null;
          user_id: string;
        };
        Update: {
          amount?: number;
          created_at?: string;
          enrollment_id?: string | null;
          id?: string;
          idempotency_key?: string;
          occurred_at?: string;
          reason?: string;
          reference_id?: string | null;
          reference_table?: string | null;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'xp_ledger_enrollment_id_fkey';
            columns: ['enrollment_id'];
            isOneToOne: false;
            referencedRelation: 'user_course_enrollments';
            referencedColumns: ['id'];
          },
        ];
      };
    };
    Views: {
      course_source_localizations_staff: {
        Row: {
          course_track_id: string | null;
          created_at: string | null;
          editorial_note_key: string | null;
          fallback_source_language_code: string | null;
          id: string | null;
          metrics: Json | null;
          native_reviewed: boolean | null;
          reviewed_at: string | null;
          reviewer_id: string | null;
          source_language_code: string | null;
          status: string | null;
          updated_at: string | null;
        };
        ComputedFields: never;
        Insert: {
          course_track_id?: string | null;
          created_at?: string | null;
          editorial_note_key?: string | null;
          fallback_source_language_code?: string | null;
          id?: string | null;
          metrics?: Json | null;
          native_reviewed?: boolean | null;
          reviewed_at?: string | null;
          reviewer_id?: string | null;
          source_language_code?: string | null;
          status?: string | null;
          updated_at?: string | null;
        };
        Update: {
          course_track_id?: string | null;
          created_at?: string | null;
          editorial_note_key?: string | null;
          fallback_source_language_code?: string | null;
          id?: string | null;
          metrics?: Json | null;
          native_reviewed?: boolean | null;
          reviewed_at?: string | null;
          reviewer_id?: string | null;
          source_language_code?: string | null;
          status?: string | null;
          updated_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'course_source_localizations_course_track_id_fkey';
            columns: ['course_track_id'];
            isOneToOne: false;
            referencedRelation: 'course_tracks';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'course_source_localizations_fallback_source_language_code_fkey';
            columns: ['fallback_source_language_code'];
            isOneToOne: false;
            referencedRelation: 'languages';
            referencedColumns: ['code'];
          },
          {
            foreignKeyName: 'course_source_localizations_source_language_code_fkey';
            columns: ['source_language_code'];
            isOneToOne: false;
            referencedRelation: 'languages';
            referencedColumns: ['code'];
          },
        ];
      };
      media_assets_staff: {
        Row: {
          bitrate_kbps: number | null;
          bucket: string | null;
          byte_length: number | null;
          channels: number | null;
          checksum_sha256: string | null;
          content_rights_id: string | null;
          created_at: string | null;
          derivation: string | null;
          disposition: string | null;
          duration_ms: number | null;
          etag: string | null;
          id: string | null;
          kind: string | null;
          legacy_filename: string | null;
          legacy_path: string | null;
          mime_type: string | null;
          owner_id: string | null;
          sample_rate_hz: number | null;
          source_asset_id: string | null;
          state: string | null;
          storage_key: string | null;
          updated_at: string | null;
          visibility: string | null;
        };
        ComputedFields: never;
        Insert: {
          bitrate_kbps?: number | null;
          bucket?: string | null;
          byte_length?: number | null;
          channels?: number | null;
          checksum_sha256?: string | null;
          content_rights_id?: string | null;
          created_at?: string | null;
          derivation?: string | null;
          disposition?: string | null;
          duration_ms?: number | null;
          etag?: string | null;
          id?: string | null;
          kind?: string | null;
          legacy_filename?: string | null;
          legacy_path?: string | null;
          mime_type?: string | null;
          owner_id?: string | null;
          sample_rate_hz?: number | null;
          source_asset_id?: string | null;
          state?: string | null;
          storage_key?: string | null;
          updated_at?: string | null;
          visibility?: string | null;
        };
        Update: {
          bitrate_kbps?: number | null;
          bucket?: string | null;
          byte_length?: number | null;
          channels?: number | null;
          checksum_sha256?: string | null;
          content_rights_id?: string | null;
          created_at?: string | null;
          derivation?: string | null;
          disposition?: string | null;
          duration_ms?: number | null;
          etag?: string | null;
          id?: string | null;
          kind?: string | null;
          legacy_filename?: string | null;
          legacy_path?: string | null;
          mime_type?: string | null;
          owner_id?: string | null;
          sample_rate_hz?: number | null;
          source_asset_id?: string | null;
          state?: string | null;
          storage_key?: string | null;
          updated_at?: string | null;
          visibility?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'media_assets_content_rights_id_fkey';
            columns: ['content_rights_id'];
            isOneToOne: false;
            referencedRelation: 'content_rights';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'media_assets_source_asset_id_fkey';
            columns: ['source_asset_id'];
            isOneToOne: false;
            referencedRelation: 'media_assets';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'media_assets_source_asset_id_fkey';
            columns: ['source_asset_id'];
            isOneToOne: false;
            referencedRelation: 'media_assets_staff';
            referencedColumns: ['id'];
          },
        ];
      };
    };
    Functions: {
      account_deletion_in_progress: { Args: Record<PropertyKey, never>; Returns: boolean };
      apply_audio_progress: {
        Args: {
          p_client_event_id: string;
          p_clock_skew_ms: number;
          p_completed: boolean;
          p_device_id: string;
          p_duration_ms: number;
          p_lesson_id: string;
          p_occurred_at: string;
          p_position_ms: number;
          p_revision: number;
          p_user_id: string;
        };
        Returns: {
          reason: string;
          resolution: string;
        }[];
      };
      apply_sync_events: {
        Args: { p_client_sent_at?: string; p_events: Json[]; p_user_id?: string };
        Returns: {
          client_event_id: string;
          handled_in_db: boolean;
          reason: string;
          resolution: string;
          xp_credited: number;
        }[];
      };
      attach_append_only: { Args: { p_table: unknown }; Returns: undefined };
      attach_updated_at: { Args: { p_table: unknown }; Returns: undefined };
      award_xp: {
        Args: {
          p_amount: number;
          p_enrollment_id?: string;
          p_idempotency_key: string;
          p_occurred_at?: string;
          p_reason: string;
          p_reference_id?: string;
          p_reference_table?: string;
          p_user_id: string;
        };
        Returns: {
          amount: number;
          applied: boolean;
          ledger_id: string;
          total_xp: number;
        }[];
      };
      claim_processing_job: {
        Args: { p_job_types?: string[]; p_lease_seconds?: number; p_worker_id: string };
        Returns: {
          attempts: number;
          cost_actual_usd: number | null;
          cost_estimate_usd: number | null;
          created_at: string;
          failure_code: string | null;
          failure_message: string | null;
          finished_at: string | null;
          id: string;
          idempotency_key: string;
          job_type: string;
          locked_by: string | null;
          locked_until: string | null;
          max_attempts: number;
          output: Json | null;
          output_asset_ids: string[];
          params: NonNullable<Json>;
          parent_asset_id: string | null;
          parent_entity_id: string | null;
          parent_entity_table: string | null;
          priority: number;
          progress_pct: number;
          provider: string | null;
          requested_by: string | null;
          started_at: string | null;
          state: string;
          updated_at: string;
        }[];
        SetofOptions: {
          from: '*';
          to: 'processing_jobs';
          isOneToOne: false;
          isSetofReturn: true;
        };
      };
      complete_mission_attempt: {
        Args: {
          p_attempt_id: string;
          p_completed_at: string;
          p_current_step_index: number;
          p_enrollment_id: string;
          p_evaluation: Json;
          p_mission_id: string;
          p_objectives_completed: string[];
          p_seen_evaluation?: Json;
          p_step_results: Json;
          p_user_id: string;
        };
        Returns: {
          attempt: Json;
          contested_ids: string[];
          outcome: string;
        }[];
      };
      complete_processing_job: {
        Args: {
          p_cost_actual_usd?: number;
          p_job_id: string;
          p_output?: Json;
          p_output_asset_ids?: string[];
          p_worker_id: string;
        };
        Returns: {
          attempts: number;
          cost_actual_usd: number | null;
          cost_estimate_usd: number | null;
          created_at: string;
          failure_code: string | null;
          failure_message: string | null;
          finished_at: string | null;
          id: string;
          idempotency_key: string;
          job_type: string;
          locked_by: string | null;
          locked_until: string | null;
          max_attempts: number;
          output: Json | null;
          output_asset_ids: string[];
          params: NonNullable<Json>;
          parent_asset_id: string | null;
          parent_entity_id: string | null;
          parent_entity_table: string | null;
          priority: number;
          progress_pct: number;
          provider: string | null;
          requested_by: string | null;
          started_at: string | null;
          state: string;
          updated_at: string;
        };
        SetofOptions: {
          from: '*';
          to: 'processing_jobs';
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      delete_account: {
        Args: { p_delete_opt_in_recordings?: boolean; p_user_id: string };
        Returns: Json;
      };
      enqueue_processing_job: {
        Args: {
          p_idempotency_key: string;
          p_job_type: string;
          p_max_attempts?: number;
          p_params?: Json;
          p_parent_asset_id?: string;
          p_parent_entity_id?: string;
          p_parent_entity_table?: string;
          p_priority?: number;
          p_provider?: string;
          p_requested_by?: string;
        };
        Returns: {
          attempts: number;
          cost_actual_usd: number | null;
          cost_estimate_usd: number | null;
          created_at: string;
          failure_code: string | null;
          failure_message: string | null;
          finished_at: string | null;
          id: string;
          idempotency_key: string;
          job_type: string;
          locked_by: string | null;
          locked_until: string | null;
          max_attempts: number;
          output: Json | null;
          output_asset_ids: string[];
          params: NonNullable<Json>;
          parent_asset_id: string | null;
          parent_entity_id: string | null;
          parent_entity_table: string | null;
          priority: number;
          progress_pct: number;
          provider: string | null;
          requested_by: string | null;
          started_at: string | null;
          state: string;
          updated_at: string;
        };
        SetofOptions: {
          from: '*';
          to: 'processing_jobs';
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      fail_processing_job: {
        Args: {
          p_backoff_seconds?: number;
          p_failure_code: string;
          p_failure_message?: string;
          p_job_id: string;
          p_retry?: boolean;
          p_worker_id: string;
        };
        Returns: {
          attempts: number;
          cost_actual_usd: number | null;
          cost_estimate_usd: number | null;
          created_at: string;
          failure_code: string | null;
          failure_message: string | null;
          finished_at: string | null;
          id: string;
          idempotency_key: string;
          job_type: string;
          locked_by: string | null;
          locked_until: string | null;
          max_attempts: number;
          output: Json | null;
          output_asset_ids: string[];
          params: NonNullable<Json>;
          parent_asset_id: string | null;
          parent_entity_id: string | null;
          parent_entity_table: string | null;
          priority: number;
          progress_pct: number;
          provider: string | null;
          requested_by: string | null;
          started_at: string | null;
          state: string;
          updated_at: string;
        };
        SetofOptions: {
          from: '*';
          to: 'processing_jobs';
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      get_due_reviews: {
        Args: { p_enrollment_id: string; p_limit?: number; p_now?: string };
        Returns: {
          card_state: string;
          created_at: string;
          difficulty: number;
          elapsed_days: number;
          enrollment_id: string;
          expression_id: string | null;
          id: string;
          lapses: number;
          last_hint_count: number;
          last_rating: string | null;
          last_reviewed_at: string | null;
          next_due_at: string;
          recent_scenario_ids: string[];
          reps: number;
          retrievability: number;
          scheduled_days: number;
          scheduler_version: string;
          skill_key: string | null;
          stability: number;
          updated_at: string;
          user_id: string;
        }[];
        SetofOptions: {
          from: '*';
          to: 'user_expression_reviews';
          isOneToOne: false;
          isSetofReturn: true;
        };
      };
      has_any_role: { Args: { p_roles: string[] }; Returns: boolean };
      has_role: { Args: { p_role: string }; Returns: boolean };
      heartbeat_processing_job: {
        Args: {
          p_job_id: string;
          p_lease_seconds?: number;
          p_progress_pct?: number;
          p_worker_id: string;
        };
        Returns: boolean;
      };
      is_admin: { Args: Record<PropertyKey, never>; Returns: boolean };
      is_content_editor: { Args: Record<PropertyKey, never>; Returns: boolean };
      is_language_reviewer: { Args: Record<PropertyKey, never>; Returns: boolean };
      is_staff: { Args: Record<PropertyKey, never>; Returns: boolean };
      is_support: { Args: Record<PropertyKey, never>; Returns: boolean };
      mark_sync_events_applied: {
        Args: { p_client_event_ids: string[]; p_user_id?: string };
        Returns: number;
      };
      normalize_source_language_code: { Args: { p_value: string }; Returns: string };
      object_key_scope: { Args: { p_key: string }; Returns: string };
      owns_media_asset: { Args: { p_asset_id: string }; Returns: boolean };
      purge_test_user: { Args: { p_user_id: string }; Returns: Json };
      reorder_audio_chapters: {
        Args: { p_collection_id: string; p_ordered_ids: string[] };
        Returns: {
          id: string;
          sort_order: number;
        }[];
      };
      reorder_audio_lessons: {
        Args: { p_chapter_id: string; p_ordered_ids: string[] };
        Returns: {
          id: string;
          sort_order: number;
        }[];
      };
      requeue_expired_jobs: {
        Args: { p_limit?: number };
        Returns: {
          job_id: string;
          new_state: string;
        }[];
      };
      revoke_content_rights: {
        Args: { p_actor_id?: string; p_note?: string; p_reason?: string; p_rights_id: string };
        Returns: {
          entity_id: string;
          entity_table: string;
          new_state: string;
          previous_state: string;
        }[];
      };
      set_enrollment_source_language: {
        Args: { p_enrollment_id: string; p_source_language_code: string };
        Returns: {
          active_mission_id: string | null;
          added_at: string;
          course_track_id: string;
          created_at: string;
          id: string;
          last_opened_at: string | null;
          learner_level: string;
          preferred_learning_speed: string;
          preferred_target_variant_id: string | null;
          regional_preference: string | null;
          script_mode: string;
          source_language_code: string;
          status: string;
          translation_peek_language_code: string | null;
          updated_at: string;
          user_id: string;
        };
        SetofOptions: {
          from: '*';
          to: 'user_course_enrollments';
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      user_total_xp: { Args: { p_user_id: string }; Returns: number };
      xp_amount_for_reason: { Args: { p_reason: string }; Returns: number };
      xp_reference_owned: {
        Args: { p_reference_id: string; p_reference_table: string; p_user_id: string };
        Returns: boolean;
      };
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>;

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, 'public'>];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema['Tables'] & DefaultSchema['Views'])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Views'])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Views'])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema['Tables'] & DefaultSchema['Views'])
    ? (DefaultSchema['Tables'] & DefaultSchema['Views'])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema['Tables'] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables']
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables']
    ? DefaultSchema['Tables'][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema['Tables'] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables']
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables']
    ? DefaultSchema['Tables'][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    keyof DefaultSchema['Enums'] | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions['schema']]['Enums']
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions['schema']]['Enums'][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema['Enums']
    ? DefaultSchema['Enums'][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    keyof DefaultSchema['CompositeTypes'] | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions['schema']]['CompositeTypes']
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions['schema']]['CompositeTypes'][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema['CompositeTypes']
    ? DefaultSchema['CompositeTypes'][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  public: {
    Enums: {},
  },
} as const;
