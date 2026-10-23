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
      application_events: {
        Row: {
          actor_id: string | null
          application_id: string
          created_at: string
          event_type: string
          id: string
          metadata: Json
          reason: string | null
        }
        Insert: {
          actor_id?: string | null
          application_id: string
          created_at?: string
          event_type: string
          id?: string
          metadata?: Json
          reason?: string | null
        }
        Update: {
          actor_id?: string | null
          application_id?: string
          created_at?: string
          event_type?: string
          id?: string
          metadata?: Json
          reason?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "application_events_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "application_events_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "applications"
            referencedColumns: ["id"]
          },
        ]
      }
      applications: {
        Row: {
          close_action: string | null
          closed_at: string | null
          closed_by: string | null
          closed_from_status:
            | Database["public"]["Enums"]["application_status"]
            | null
          closed_reason: string | null
          closure_version: number
          conversation_state: string
          created_at: string
          id: string
          is_primary: boolean
          job_id: string
          last_activity_at: string
          message: string | null
          promoted_at: string | null
          promoted_by: string | null
          promotion_reason: string | null
          queue_position: number
          rejection_reason: string | null
          reopened_at: string | null
          reopened_by: string | null
          status: Database["public"]["Enums"]["application_status"]
          updated_at: string
          user_id: string
          was_primary_before_close: boolean
        }
        Insert: {
          close_action?: string | null
          closed_at?: string | null
          closed_by?: string | null
          closed_from_status?:
            | Database["public"]["Enums"]["application_status"]
            | null
          closed_reason?: string | null
          closure_version?: number
          conversation_state?: string
          created_at?: string
          id?: string
          is_primary?: boolean
          job_id: string
          last_activity_at: string
          message?: string | null
          promoted_at?: string | null
          promoted_by?: string | null
          promotion_reason?: string | null
          queue_position: number
          rejection_reason?: string | null
          reopened_at?: string | null
          reopened_by?: string | null
          status?: Database["public"]["Enums"]["application_status"]
          updated_at?: string
          user_id: string
          was_primary_before_close?: boolean
        }
        Update: {
          close_action?: string | null
          closed_at?: string | null
          closed_by?: string | null
          closed_from_status?:
            | Database["public"]["Enums"]["application_status"]
            | null
          closed_reason?: string | null
          closure_version?: number
          conversation_state?: string
          created_at?: string
          id?: string
          is_primary?: boolean
          job_id?: string
          last_activity_at?: string
          message?: string | null
          promoted_at?: string | null
          promoted_by?: string | null
          promotion_reason?: string | null
          queue_position?: number
          rejection_reason?: string | null
          reopened_at?: string | null
          reopened_by?: string | null
          status?: Database["public"]["Enums"]["application_status"]
          updated_at?: string
          user_id?: string
          was_primary_before_close?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "applications_closed_by_fkey"
            columns: ["closed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "applications_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "applications_promoted_by_fkey"
            columns: ["promoted_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "applications_reopened_by_fkey"
            columns: ["reopened_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "applications_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      conversation_reopen_requests: {
        Row: {
          application_id: string
          closure_version: number
          created_at: string
          id: string
          message: string
          recipient_id: string
          requested_by: string
          resolved_at: string | null
          resolved_by: string | null
          response_reason: string | null
          status: string
        }
        Insert: {
          application_id: string
          closure_version: number
          created_at?: string
          id?: string
          message: string
          recipient_id: string
          requested_by: string
          resolved_at?: string | null
          resolved_by?: string | null
          response_reason?: string | null
          status?: string
        }
        Update: {
          application_id?: string
          closure_version?: number
          created_at?: string
          id?: string
          message?: string
          recipient_id?: string
          requested_by?: string
          resolved_at?: string | null
          resolved_by?: string | null
          response_reason?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "conversation_reopen_requests_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "applications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversation_reopen_requests_recipient_id_fkey"
            columns: ["recipient_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversation_reopen_requests_requested_by_fkey"
            columns: ["requested_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversation_reopen_requests_resolved_by_fkey"
            columns: ["resolved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      guardian_consent_links: {
        Row: {
          child_id: string
          created_at: string
          created_ip_hash: string | null
          created_user_agent_hash: string | null
          expires_at: string
          id: string
          purpose: string
          status: string
          token_encrypted: string | null
          token_hash: string
          updated_at: string
          used_at: string | null
        }
        Insert: {
          child_id: string
          created_at?: string
          created_ip_hash?: string | null
          created_user_agent_hash?: string | null
          expires_at: string
          id?: string
          purpose?: string
          status?: string
          token_encrypted?: string | null
          token_hash: string
          updated_at?: string
          used_at?: string | null
        }
        Update: {
          child_id?: string
          created_at?: string
          created_ip_hash?: string | null
          created_user_agent_hash?: string | null
          expires_at?: string
          id?: string
          purpose?: string
          status?: string
          token_encrypted?: string | null
          token_hash?: string
          updated_at?: string
          used_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "guardian_consent_links_child_id_fkey"
            columns: ["child_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      guardian_consents: {
        Row: {
          affirmations: Json
          approved_at: string
          child_id: string
          consent_scope: string
          created_at: string
          declaration_text: string
          declaration_version: string
          email_verified_at: string | null
          id: string
          ip_hash: string | null
          link_id: string | null
          linked_guardian_id: string | null
          parent_email: string | null
          parent_name: string
          relationship_type: string
          revocation_notice: string | null
          revoked_at: string | null
          risk_flags: Json
          signature_method: string
          signature_name: string
          status: string
          updated_at: string
          user_agent_hash: string | null
        }
        Insert: {
          affirmations?: Json
          approved_at?: string
          child_id: string
          consent_scope?: string
          created_at?: string
          declaration_text: string
          declaration_version: string
          email_verified_at?: string | null
          id?: string
          ip_hash?: string | null
          link_id?: string | null
          linked_guardian_id?: string | null
          parent_email?: string | null
          parent_name: string
          relationship_type: string
          revocation_notice?: string | null
          revoked_at?: string | null
          risk_flags?: Json
          signature_method?: string
          signature_name: string
          status?: string
          updated_at?: string
          user_agent_hash?: string | null
        }
        Update: {
          affirmations?: Json
          approved_at?: string
          child_id?: string
          consent_scope?: string
          created_at?: string
          declaration_text?: string
          declaration_version?: string
          email_verified_at?: string | null
          id?: string
          ip_hash?: string | null
          link_id?: string | null
          linked_guardian_id?: string | null
          parent_email?: string | null
          parent_name?: string
          relationship_type?: string
          revocation_notice?: string | null
          revoked_at?: string | null
          risk_flags?: Json
          signature_method?: string
          signature_name?: string
          status?: string
          updated_at?: string
          user_agent_hash?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "guardian_consents_child_id_fkey"
            columns: ["child_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "guardian_consents_link_id_fkey"
            columns: ["link_id"]
            isOneToOne: false
            referencedRelation: "guardian_consent_links"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "guardian_consents_linked_guardian_id_fkey"
            columns: ["linked_guardian_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      guardian_invitations: {
        Row: {
          basis_consent_link_id: string | null
          child_id: string
          created_at: string | null
          expires_at: string
          id: string
          purpose: string
          redeemed_by: string | null
          status: string
          token: string
          updated_at: string | null
          used_at: string | null
        }
        Insert: {
          basis_consent_link_id?: string | null
          child_id: string
          created_at?: string | null
          expires_at: string
          id?: string
          purpose?: string
          redeemed_by?: string | null
          status?: string
          token: string
          updated_at?: string | null
          used_at?: string | null
        }
        Update: {
          basis_consent_link_id?: string | null
          child_id?: string
          created_at?: string | null
          expires_at?: string
          id?: string
          purpose?: string
          redeemed_by?: string | null
          status?: string
          token?: string
          updated_at?: string | null
          used_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "guardian_invitations_basis_consent_link_id_fkey"
            columns: ["basis_consent_link_id"]
            isOneToOne: false
            referencedRelation: "guardian_consent_links"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "guardian_invitations_child_id_fkey"
            columns: ["child_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "guardian_invitations_redeemed_by_fkey"
            columns: ["redeemed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      guardian_relationships: {
        Row: {
          child_id: string | null
          created_at: string | null
          guardian_id: string | null
          id: string
          status: string | null
        }
        Insert: {
          child_id?: string | null
          created_at?: string | null
          guardian_id?: string | null
          id?: string
          status?: string | null
        }
        Update: {
          child_id?: string | null
          created_at?: string | null
          guardian_id?: string | null
          id?: string
          status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "guardian_relationships_child_id_fkey"
            columns: ["child_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "guardian_relationships_guardian_id_fkey"
            columns: ["guardian_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      job_agreements: {
        Row: {
          application_id: string
          created_at: string
          ends_at: string | null
          id: string
          job_id: string
          note: string | null
          provider_id: string
          seeker_id: string
          starts_at: string
          status: string
          timezone: string
          updated_at: string
        }
        Insert: {
          application_id: string
          created_at?: string
          ends_at?: string | null
          id?: string
          job_id: string
          note?: string | null
          provider_id: string
          seeker_id: string
          starts_at: string
          status?: string
          timezone?: string
          updated_at?: string
        }
        Update: {
          application_id?: string
          created_at?: string
          ends_at?: string | null
          id?: string
          job_id?: string
          note?: string | null
          provider_id?: string
          seeker_id?: string
          starts_at?: string
          status?: string
          timezone?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "job_agreements_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: true
            referencedRelation: "applications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_agreements_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_agreements_provider_id_fkey"
            columns: ["provider_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_agreements_seeker_id_fkey"
            columns: ["seeker_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      job_appointment_requests: {
        Row: {
          id: string
          application_id: string
          appointment_id: string | null
          requested_by: string
          starts_at: string
          ends_at: string | null
          timezone: string
          note: string | null
          appointment_version: string | null
          status: string
          responded_by: string | null
          created_at: string
          responded_at: string | null
        }
        Insert: {
          id?: string
          application_id: string
          appointment_id?: string | null
          requested_by: string
          starts_at: string
          ends_at?: string | null
          timezone?: string
          note?: string | null
          appointment_version?: string | null
          status?: string
          responded_by?: string | null
          created_at?: string
          responded_at?: string | null
        }
        Update: {
          id?: string
          application_id?: string
          appointment_id?: string | null
          requested_by?: string
          starts_at?: string
          ends_at?: string | null
          timezone?: string
          note?: string | null
          appointment_version?: string | null
          status?: string
          responded_by?: string | null
          created_at?: string
          responded_at?: string | null
        }
        Relationships: [
          { foreignKeyName: "job_appointment_requests_application_id_fkey"; columns: ["application_id"]; isOneToOne: false; referencedRelation: "applications"; referencedColumns: ["id"] },
          { foreignKeyName: "job_appointment_requests_appointment_id_fkey"; columns: ["appointment_id"]; isOneToOne: false; referencedRelation: "job_appointments"; referencedColumns: ["id"] },
          { foreignKeyName: "job_appointment_requests_requested_by_fkey"; columns: ["requested_by"]; isOneToOne: false; referencedRelation: "profiles"; referencedColumns: ["id"] },
          { foreignKeyName: "job_appointment_requests_responded_by_fkey"; columns: ["responded_by"]; isOneToOne: false; referencedRelation: "profiles"; referencedColumns: ["id"] },
        ]
      }
      job_appointments: {
        Row: {
          created_at: string
          created_by: string | null
          ends_at: string | null
          engagement_id: string
          id: string
          legacy_agreement_id: string | null
          note: string | null
          starts_at: string
          status: string
          timezone: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          ends_at?: string | null
          engagement_id: string
          id?: string
          legacy_agreement_id?: string | null
          note?: string | null
          starts_at: string
          status?: string
          timezone?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          ends_at?: string | null
          engagement_id?: string
          id?: string
          legacy_agreement_id?: string | null
          note?: string | null
          starts_at?: string
          status?: string
          timezone?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "job_appointments_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_appointments_engagement_id_fkey"
            columns: ["engagement_id"]
            isOneToOne: false
            referencedRelation: "job_engagements"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_appointments_legacy_agreement_id_fkey"
            columns: ["legacy_agreement_id"]
            isOneToOne: true
            referencedRelation: "job_agreements"
            referencedColumns: ["id"]
          },
        ]
      }
      job_engagements: {
        Row: {
          application_id: string
          cancelled_at: string | null
          close_reason: string | null
          closed_by: string | null
          completed_at: string | null
          created_at: string
          engagement_type: string
          id: string
          job_id: string
          provider_id: string
          seeker_id: string
          started_at: string
          status: string
          updated_at: string
        }
        Insert: {
          application_id: string
          cancelled_at?: string | null
          close_reason?: string | null
          closed_by?: string | null
          completed_at?: string | null
          created_at?: string
          engagement_type?: string
          id?: string
          job_id: string
          provider_id: string
          seeker_id: string
          started_at?: string
          status?: string
          updated_at?: string
        }
        Update: {
          application_id?: string
          cancelled_at?: string | null
          close_reason?: string | null
          closed_by?: string | null
          completed_at?: string | null
          created_at?: string
          engagement_type?: string
          id?: string
          job_id?: string
          provider_id?: string
          seeker_id?: string
          started_at?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "job_engagements_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: true
            referencedRelation: "applications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_engagements_closed_by_fkey"
            columns: ["closed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_engagements_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_engagements_provider_id_fkey"
            columns: ["provider_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_engagements_seeker_id_fkey"
            columns: ["seeker_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      job_private_details: {
        Row: {
          address_full: string | null
          created_at: string | null
          job_id: string
          notes: string | null
          private_lat: number | null
          private_lng: number | null
        }
        Insert: {
          address_full?: string | null
          created_at?: string | null
          job_id: string
          notes?: string | null
          private_lat?: number | null
          private_lng?: number | null
        }
        Update: {
          address_full?: string | null
          created_at?: string | null
          job_id?: string
          notes?: string | null
          private_lat?: number | null
          private_lng?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "job_private_details_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: true
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      jobs: {
        Row: {
          address_reveal_policy: string | null
          category: string | null
          completed_at: string | null
          continuity_preferred: boolean
          created_at: string
          description: string | null
          expires_at: string | null
          filled_at: string | null
          filled_by: string | null
          hiring_mode: Database["public"]["Enums"]["hiring_mode"]
          id: string
          job_kind: string
          market_id: string | null
          max_applicants: number | null
          payment_type: string
          posted_by: string
          public_lat: number | null
          public_lng: number | null
          public_location_label: string | null
          reach: string | null
          recurrence_rule: string | null
          status: Database["public"]["Enums"]["job_status"]
          title: string
          updated_at: string | null
          wage_hourly: number | null
        }
        Insert: {
          address_reveal_policy?: string | null
          category?: string | null
          completed_at?: string | null
          continuity_preferred?: boolean
          created_at?: string
          description?: string | null
          expires_at?: string | null
          filled_at?: string | null
          filled_by?: string | null
          hiring_mode?: Database["public"]["Enums"]["hiring_mode"]
          id?: string
          job_kind?: string
          market_id?: string | null
          max_applicants?: number | null
          payment_type?: string
          posted_by: string
          public_lat?: number | null
          public_lng?: number | null
          public_location_label?: string | null
          reach?: string | null
          recurrence_rule?: string | null
          status: Database["public"]["Enums"]["job_status"]
          title: string
          updated_at?: string | null
          wage_hourly?: number | null
        }
        Update: {
          address_reveal_policy?: string | null
          category?: string | null
          completed_at?: string | null
          continuity_preferred?: boolean
          created_at?: string
          description?: string | null
          expires_at?: string | null
          filled_at?: string | null
          filled_by?: string | null
          hiring_mode?: Database["public"]["Enums"]["hiring_mode"]
          id?: string
          job_kind?: string
          market_id?: string | null
          max_applicants?: number | null
          payment_type?: string
          posted_by?: string
          public_lat?: number | null
          public_lng?: number | null
          public_location_label?: string | null
          reach?: string | null
          recurrence_rule?: string | null
          status?: Database["public"]["Enums"]["job_status"]
          title?: string
          updated_at?: string | null
          wage_hourly?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "jobs_market_id_fkey"
            columns: ["market_id"]
            isOneToOne: false
            referencedRelation: "regions_live"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jobs_posted_by_fkey"
            columns: ["posted_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      messages: {
        Row: {
          application_id: string
          client_nonce: string | null
          content: string
          created_at: string
          deleted_at: string | null
          edited_at: string | null
          id: string
          kind: string
          read_at: string | null
          sender_id: string
        }
        Insert: {
          application_id: string
          client_nonce?: string | null
          content: string
          created_at?: string
          deleted_at?: string | null
          edited_at?: string | null
          id?: string
          kind?: string
          read_at?: string | null
          sender_id: string
        }
        Update: {
          application_id?: string
          client_nonce?: string | null
          content?: string
          created_at?: string
          deleted_at?: string | null
          edited_at?: string | null
          id?: string
          kind?: string
          read_at?: string | null
          sender_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "messages_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "applications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_sender_id_fkey"
            columns: ["sender_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      moderation_actions: {
        Row: {
          action_type: string
          created_at: string
          id: string
          moderator_user_id: string
          notes: string | null
          target_id: string
          target_type: string
        }
        Insert: {
          action_type: string
          created_at?: string
          id?: string
          moderator_user_id: string
          notes?: string | null
          target_id: string
          target_type: string
        }
        Update: {
          action_type?: string
          created_at?: string
          id?: string
          moderator_user_id?: string
          notes?: string | null
          target_id?: string
          target_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "moderation_actions_moderator_user_id_fkey"
            columns: ["moderator_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_preferences: {
        Row: {
          digest_frequency: string
          email_application_updates: boolean
          email_appointments: boolean
          email_enabled: boolean
          email_job_updates: boolean
          email_messages: boolean
          email_waitlist_updates: boolean
          in_app_application_updates: boolean
          in_app_appointments: boolean
          in_app_enabled: boolean
          in_app_messages: boolean
          in_app_waitlist_updates: boolean
          push_enabled: boolean
          sms_enabled: boolean
          quiet_hours_end: string | null
          quiet_hours_start: string | null
          timezone: string
          updated_at: string
          user_id: string
        }
        Insert: {
          digest_frequency?: string
          email_application_updates?: boolean
          email_appointments?: boolean
          email_enabled?: boolean
          email_job_updates?: boolean
          email_messages?: boolean
          email_waitlist_updates?: boolean
          in_app_application_updates?: boolean
          in_app_appointments?: boolean
          in_app_enabled?: boolean
          in_app_messages?: boolean
          in_app_waitlist_updates?: boolean
          push_enabled?: boolean
          sms_enabled?: boolean
          quiet_hours_end?: string | null
          quiet_hours_start?: string | null
          timezone?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          digest_frequency?: string
          email_application_updates?: boolean
          email_appointments?: boolean
          email_enabled?: boolean
          email_job_updates?: boolean
          email_messages?: boolean
          email_waitlist_updates?: boolean
          in_app_application_updates?: boolean
          in_app_appointments?: boolean
          in_app_enabled?: boolean
          in_app_messages?: boolean
          in_app_waitlist_updates?: boolean
          push_enabled?: boolean
          sms_enabled?: boolean
          quiet_hours_end?: string | null
          quiet_hours_start?: string | null
          timezone?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notification_preferences_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          body: string | null
          category: string
          created_at: string
          data: Json | null
          dedupe_key: string | null
          event_key: string
          event_type: string
          id: string
          in_app_visible: boolean
          inserted_at: string
          priority: number
          read_at: string | null
          seen_at: string | null
          title: string
          type: string
          user_id: string
        }
        Insert: {
          body?: string | null
          category?: string
          created_at?: string
          data?: Json | null
          dedupe_key?: string | null
          event_key?: string
          event_type?: string
          id?: string
          in_app_visible?: boolean
          inserted_at?: string
          priority?: number
          read_at?: string | null
          seen_at?: string | null
          title: string
          type: string
          user_id: string
        }
        Update: {
          body?: string | null
          category?: string
          created_at?: string
          data?: Json | null
          dedupe_key?: string | null
          event_key?: string
          event_type?: string
          id?: string
          in_app_visible?: boolean
          inserted_at?: string
          priority?: number
          read_at?: string | null
          seen_at?: string | null
          title?: string
          type?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          account_type: Database["public"]["Enums"]["account_type"]
          availability_note: string | null
          avatar_url: string | null
          bio: string | null
          birthdate: string | null
          city: string | null
          company_contact_email: string | null
          company_message: string | null
          company_name: string | null
          country: string
          created_at: string
          email: string | null
          email_verified_at: string | null
          full_name: string | null
          guardian_id: string | null
          guardian_status: Database["public"]["Enums"]["guardian_status"]
          guardian_verified_at: string | null
          house_number: string | null
          id: string
          interests: string | null
          lat: number | null
          lng: number | null
          market_id: string | null
          mobile_nav_preference: string
          phone_verified_at: string | null
          provider_kind: Database["public"]["Enums"]["provider_kind"] | null
          provider_verification_status: Database["public"]["Enums"]["provider_verification_status"]
          provider_verified_at: string | null
          skills: string | null
          street: string | null
          theme_preference: string
          updated_at: string
          user_type: string | null
          zip: string | null
        }
        Insert: {
          account_type?: Database["public"]["Enums"]["account_type"]
          availability_note?: string | null
          avatar_url?: string | null
          bio?: string | null
          birthdate?: string | null
          city?: string | null
          company_contact_email?: string | null
          company_message?: string | null
          company_name?: string | null
          country?: string
          created_at?: string
          email?: string | null
          email_verified_at?: string | null
          full_name?: string | null
          guardian_id?: string | null
          guardian_status?: Database["public"]["Enums"]["guardian_status"]
          guardian_verified_at?: string | null
          house_number?: string | null
          id: string
          interests?: string | null
          lat?: number | null
          lng?: number | null
          market_id?: string | null
          mobile_nav_preference?: string
          phone_verified_at?: string | null
          provider_kind?: Database["public"]["Enums"]["provider_kind"] | null
          provider_verification_status?: Database["public"]["Enums"]["provider_verification_status"]
          provider_verified_at?: string | null
          skills?: string | null
          street?: string | null
          theme_preference?: string
          updated_at?: string
          user_type?: string | null
          zip?: string | null
        }
        Update: {
          account_type?: Database["public"]["Enums"]["account_type"]
          availability_note?: string | null
          avatar_url?: string | null
          bio?: string | null
          birthdate?: string | null
          city?: string | null
          company_contact_email?: string | null
          company_message?: string | null
          company_name?: string | null
          country?: string
          created_at?: string
          email?: string | null
          email_verified_at?: string | null
          full_name?: string | null
          guardian_id?: string | null
          guardian_status?: Database["public"]["Enums"]["guardian_status"]
          guardian_verified_at?: string | null
          house_number?: string | null
          id?: string
          interests?: string | null
          lat?: number | null
          lng?: number | null
          market_id?: string | null
          mobile_nav_preference?: string
          phone_verified_at?: string | null
          provider_kind?: Database["public"]["Enums"]["provider_kind"] | null
          provider_verification_status?: Database["public"]["Enums"]["provider_verification_status"]
          provider_verified_at?: string | null
          skills?: string | null
          street?: string | null
          theme_preference?: string
          updated_at?: string
          user_type?: string | null
          zip?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "profiles_guardian_id_fkey"
            columns: ["guardian_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "profiles_market_id_fkey"
            columns: ["market_id"]
            isOneToOne: false
            referencedRelation: "regions_live"
            referencedColumns: ["id"]
          },
        ]
      }
      regions_live: {
        Row: {
          brand_prefix: string | null
          city: string
          country: string
          created_at: string
          display_name: string | null
          federal_state: string
          id: string
          is_live: boolean
          openplz_municipality_key: string | null
          postal_code: string | null
        }
        Insert: {
          brand_prefix?: string | null
          city: string
          country?: string
          created_at?: string
          display_name?: string | null
          federal_state: string
          id?: string
          is_live?: boolean
          openplz_municipality_key?: string | null
          postal_code?: string | null
        }
        Update: {
          brand_prefix?: string | null
          city?: string
          country?: string
          created_at?: string
          display_name?: string | null
          federal_state?: string
          id?: string
          is_live?: boolean
          openplz_municipality_key?: string | null
          postal_code?: string | null
        }
        Relationships: []
      }
      reports: {
        Row: {
          application_id: string | null
          created_at: string
          details: string | null
          evidence_captured_at: string
          evidence_snapshot: Json
          id: string
          message_id: string | null
          reason_code: string
          reopen_request_id: string | null
          reported_user_id: string | null
          reporter_user_id: string
          status: string
          target_id: string
          target_type: string
        }
        Insert: {
          application_id?: string | null
          created_at?: string
          details?: string | null
          evidence_captured_at?: string
          evidence_snapshot?: Json
          id?: string
          message_id?: string | null
          reason_code: string
          reopen_request_id?: string | null
          reported_user_id?: string | null
          reporter_user_id: string
          status?: string
          target_id: string
          target_type: string
        }
        Update: {
          application_id?: string | null
          created_at?: string
          details?: string | null
          evidence_captured_at?: string
          evidence_snapshot?: Json
          id?: string
          message_id?: string | null
          reason_code?: string
          reopen_request_id?: string | null
          reported_user_id?: string | null
          reporter_user_id?: string
          status?: string
          target_id?: string
          target_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "reports_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "applications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reports_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reports_reopen_request_id_fkey"
            columns: ["reopen_request_id"]
            isOneToOne: false
            referencedRelation: "conversation_reopen_requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reports_reported_user_id_fkey"
            columns: ["reported_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reports_reporter_user_id_fkey"
            columns: ["reporter_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      security_events: {
        Row: {
          created_at: string
          event_type: string
          id: string
          ip_address: unknown
          user_agent: string | null
          user_id: string | null
        }
        Insert: {
          created_at?: string
          event_type: string
          id?: string
          ip_address: unknown
          user_agent?: string | null
          user_id?: string | null
        }
        Update: {
          created_at?: string
          event_type?: string
          id?: string
          ip_address?: unknown
          user_agent?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "security_events_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      system_roles: {
        Row: {
          created_at: string
          description: string | null
          id: string
          name: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          name: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          name?: string
        }
        Relationships: []
      }
      user_system_roles: {
        Row: {
          created_at: string
          role_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          role_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          role_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_system_roles_role_id_fkey"
            columns: ["role_id"]
            isOneToOne: false
            referencedRelation: "system_roles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_system_roles_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      waitlist: {
        Row: {
          city: string
          country: string | null
          created_at: string
          email: string
          federal_state: string | null
          id: string
          role: string | null
        }
        Insert: {
          city: string
          country?: string | null
          created_at?: string
          email: string
          federal_state?: string | null
          id?: string
          role?: string | null
        }
        Update: {
          city?: string
          country?: string | null
          created_at?: string
          email?: string
          federal_state?: string | null
          id?: string
          role?: string | null
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      _activity_close_application: {
        Args: {
          p_action: string
          p_actor_id: string
          p_application_id: string
          p_reason: string
          p_status: Database["public"]["Enums"]["application_status"]
        }
        Returns: Json
      }
      _activity_rebalance_job: { Args: { p_job_id: string }; Returns: Json }
      _activity_reopen_application: {
        Args: { p_actor_id: string; p_application_id: string }
        Returns: Json
      }
      _rebalance_job_after_application_exit: {
        Args: { p_exiting_user_id: string; p_job_id: string }
        Returns: Json
      }
      calculate_distance: {
        Args: { lat1: number; lat2: number; lon1: number; lon2: number }
        Returns: number
      }
      complete_job_engagement: {
        Args: { p_application_id: string; p_reason?: string }
        Returns: Json
      }
      complete_profile_onboarding: {
        Args: {
          p_account_type: Database["public"]["Enums"]["account_type"]
          p_birthdate: string
          p_city: string
          p_company_contact_email: string | null
          p_company_message: string | null
          p_company_name: string | null
          p_full_name: string
          p_market_id: string | null
          p_provider_kind:
            | Database["public"]["Enums"]["provider_kind"]
            | null
        }
        Returns: Json
      }
      confirm_job_engagement: {
        Args: {
          p_application_id: string
          p_ends_at?: string
          p_note?: string
          p_starts_at: string
          p_timezone?: string
        }
        Returns: Json
      }
      manage_job_appointment: {
        Args: {
          p_application_id: string
          p_action: string
          p_appointment_id?: string | null
          p_starts_at?: string | null
          p_ends_at?: string | null
          p_note?: string | null
          p_request_id?: string | null
        }
        Returns: Json
      }
      create_guardian_invitation: {
        Args: { p_invited_email?: string }
        Returns: Json
      }
      create_job_v2: {
        Args: {
          p_address_full?: string
          p_address_reveal_policy?: string
          p_category: string
          p_continuity_preferred?: boolean
          p_description: string
          p_job_kind?: string
          p_market_id: string
          p_notes?: string
          p_payment_type?: string
          p_private_lat?: number
          p_private_lng?: number
          p_public_lat?: number
          p_public_lng?: number
          p_public_location_label?: string
          p_reach?: string
          p_recurrence_rule?: string
          p_status?: Database["public"]["Enums"]["job_status"]
          p_title: string
          p_wage: number
        }
        Returns: Json
      }
      get_activity_inbox_summaries: {
        Args: never
        Returns: {
          application_id: string
          last_activity_at: string
          last_message_at: string
          last_message_preview: string
          pending_reopen_count: number
          unread_count: number
        }[]
      }
      get_activity_partner_profiles: {
        Args: { p_application_ids: string[] }
        Returns: {
          account_type: Database["public"]["Enums"]["account_type"]
          age_years: number
          application_id: string
          avatar_url: string
          bio: string
          city: string
          company_name: string
          country: string
          created_at: string
          full_name: string
          interests: string
          is_staff: boolean
          profile_id: string
          provider_verification_status: Database["public"]["Enums"]["provider_verification_status"]
          skills: string
        }[]
      }
      get_authorized_job_location: {
        Args: { p_job_id: string }
        Returns: {
          address_full: string
          notes: string
          private_lat: number
          private_lng: number
        }[]
      }
      get_guardian_invitation_info: {
        Args: { token_input: string }
        Returns: Json
      }
      get_my_security_events: {
        Args: { p_limit?: number }
        Returns: {
          created_at: string
          event_type: string
          id: string
          ip_address: unknown
          user_agent: string
        }[]
      }
      get_visible_job_creator_summaries: {
        Args: { p_job_ids: string[] }
        Returns: {
          account_type: Database["public"]["Enums"]["account_type"]
          avatar_url: string
          bio: string
          city: string
          company_name: string
          country: string
          created_at: string
          creator_id: string
          full_name: string
          is_staff: boolean
          job_id: string
          provider_verification_status: Database["public"]["Enums"]["provider_verification_status"]
        }[]
      }
      get_waitlist_job_summaries: {
        Args: { p_job_ids: string[] }
        Returns: {
          conversation_active: boolean
          job_id: string
          my_waitlist_position: number
          next_position: number
          waitlist_count: number
        }[]
      }
      has_system_role: {
        Args: { required_role: string; user_id: string }
        Returns: boolean
      }
      is_activity_job_participant: {
        Args: { p_job_id: string }
        Returns: boolean
      }
      is_admin: { Args: never; Returns: boolean }
      is_application_participant: {
        Args: { p_application_id: string; p_user_id?: string }
        Returns: boolean
      }
      is_staff:
        | { Args: never; Returns: boolean }
        | { Args: { p_uid: string }; Returns: boolean }
      join_launch_waitlist: {
        Args: {
          p_city: string
          p_country: string
          p_email: string
          p_federal_state: string
          p_role: string
        }
        Returns: Json
      }
      mark_all_notifications_read: { Args: never; Returns: Json }
      mark_application_messages_read: {
        Args: { p_application_id: string }
        Returns: Json
      }
      mark_notification_read: {
        Args: { p_notification_id: string }
        Returns: Json
      }
      mark_notifications_seen: {
        Args: { p_notification_ids: string[] }
        Returns: Json
      }
      mark_notifications_read_through: {
        Args: { p_snapshot_at: string }
        Returns: Json
      }
      get_notification_feed: {
        Args: { p_limit?: number; p_before_created_at?: string; p_before_id?: string; p_unread_only?: boolean }
        Returns: Json
      }
      promote_waitlisted_application: {
        Args: { p_application_id: string; p_reason: string }
        Returns: Json
      }
      redeem_guardian_invitation: {
        Args: { token_input: string }
        Returns: Json
      }
      reject_application: {
        Args: { p_application_id: string; p_reason?: string | null }
        Returns: Json
      }
      reopen_application: { Args: { p_application_id: string }; Returns: Json }
      report_activity_item: {
        Args: {
          p_application_id: string
          p_details?: string
          p_message_id?: string
          p_reason_code: string
          p_reopen_request_id?: string
          p_reported_user_id?: string
        }
        Returns: Json
      }
      request_conversation_reopen: {
        Args: { p_application_id: string; p_message: string }
        Returns: Json
      }
      request_provider_verification: {
        Args: {
          p_city: string
          p_house_number: string
          p_lat: number
          p_lng: number
          p_street: string
          p_zip: string
        }
        Returns: Json
      }
      respond_to_conversation_reopen_request: {
        Args: { p_accept: boolean; p_reason?: string; p_request_id: string }
        Returns: Json
      }
      send_application_message: {
        Args: {
          p_application_id: string
          p_client_nonce?: string
          p_content: string
        }
        Returns: Json
      }
      submit_job_application: {
        Args: { p_job_id: string; p_message: string }
        Returns: Json
      }
      update_owned_job_details: {
        Args: {
          p_category: string
          p_continuity_preferred: boolean
          p_description: string
          p_expected_status: Database["public"]["Enums"]["job_status"]
          p_job_id: string
          p_job_kind: string
          p_payment_type: string
          p_reach: string
          p_recurrence_rule: string | null
          p_status: Database["public"]["Enums"]["job_status"]
          p_title: string
          p_wage_hourly: number
        }
        Returns: Json
      }
      withdraw_application: {
        Args: { p_application_id: string; p_reason?: string }
        Returns: Json
      }
    }
    Enums: {
      account_type: "job_seeker" | "job_provider"
      account_type_legacy: "teen" | "parent" | "provider" | "org"
      application_status:
        | "submitted"
        | "withdrawn"
        | "accepted"
        | "rejected"
        | "auto_rejected"
        | "completed"
        | "cancelled"
        | "negotiating"
        | "waitlisted"
      guardian_status: "none" | "pending" | "linked"
      hiring_mode: "open_pool" | "first_come" | "direct_hire"
      job_status:
        | "draft"
        | "open"
        | "closed"
        | "reviewing"
        | "reserved"
        | "filled"
      provider_kind: "private" | "company"
      provider_verification_status: "none" | "pending" | "verified" | "rejected"
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
      account_type: ["job_seeker", "job_provider"],
      account_type_legacy: ["teen", "parent", "provider", "org"],
      application_status: [
        "submitted",
        "withdrawn",
        "accepted",
        "rejected",
        "auto_rejected",
        "completed",
        "cancelled",
        "negotiating",
        "waitlisted",
      ],
      guardian_status: ["none", "pending", "linked"],
      hiring_mode: ["open_pool", "first_come", "direct_hire"],
      job_status: [
        "draft",
        "open",
        "closed",
        "reviewing",
        "reserved",
        "filled",
      ],
      provider_kind: ["private", "company"],
      provider_verification_status: ["none", "pending", "verified", "rejected"],
    },
  },
} as const
