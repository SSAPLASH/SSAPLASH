--
-- PostgreSQL database dump
--

\restrict dO7E1HXFzXuvuyt07fI6wU8QZPtCUjKJCqfJdXXTSig1H1YTwXFEubp76swLLRG

-- Dumped from database version 16.15
-- Dumped by pg_dump version 16.15

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: timescaledb; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS timescaledb WITH SCHEMA public;


--
-- Name: EXTENSION timescaledb; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION timescaledb IS 'Enables scalable inserts and complex queries for time-series data (Community Edition)';


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: audio_uploads; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.audio_uploads (
    id uuid NOT NULL,
    user_id bigint NOT NULL,
    job_id bigint,
    object_key character varying(300) NOT NULL,
    content_type character varying(32) NOT NULL,
    size_bytes bigint NOT NULL,
    sha256 character varying(64) NOT NULL,
    duration_ms integer NOT NULL,
    status character varying(10) NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    retired_at timestamp with time zone,
    CONSTRAINT audio_uploads_check CHECK ((((status)::text = 'ACCEPTED'::text) = (job_id IS NOT NULL))),
    CONSTRAINT audio_uploads_check1 CHECK ((((status)::text = 'RETIRED'::text) = (retired_at IS NOT NULL))),
    CONSTRAINT audio_uploads_check2 CHECK ((expires_at > created_at)),
    CONSTRAINT audio_uploads_content_type_check CHECK (((content_type)::text = ANY ((ARRAY['audio/mpeg'::character varying, 'audio/wav'::character varying, 'audio/mp4'::character varying, 'audio/ogg'::character varying])::text[]))),
    CONSTRAINT audio_uploads_duration_ms_check CHECK (((duration_ms > 0) AND (duration_ms <= 600000))),
    CONSTRAINT audio_uploads_object_key_check CHECK (((object_key)::text ~~ 'source-audio/%'::text)),
    CONSTRAINT audio_uploads_sha256_check CHECK (((sha256)::text ~ '^[0-9a-f]{64}$'::text)),
    CONSTRAINT audio_uploads_size_bytes_check CHECK (((size_bytes > 0) AND (size_bytes <= 52428800))),
    CONSTRAINT audio_uploads_status_check CHECK (((status)::text = ANY ((ARRAY['UPLOADING'::character varying, 'ACCEPTED'::character varying, 'RETIRED'::character varying])::text[])))
);


--
-- Name: chart_features; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.chart_features (
    chart_version_id bigint NOT NULL,
    feature_version character varying(30) NOT NULL,
    avg_notes_per_sec numeric(8,3) NOT NULL,
    peak_notes_2s integer NOT NULL,
    pad_ratio jsonb NOT NULL,
    transition_ratio jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    rhythm_grid jsonb,
    CONSTRAINT chart_features_avg_notes_per_sec_check CHECK ((avg_notes_per_sec >= (0)::numeric)),
    CONSTRAINT chart_features_feature_version_check CHECK ((btrim((feature_version)::text) <> ''::text)),
    CONSTRAINT chart_features_pad_ratio_check CHECK ((jsonb_typeof(pad_ratio) = 'object'::text)),
    CONSTRAINT chart_features_peak_notes_2s_check CHECK ((peak_notes_2s >= 0)),
    CONSTRAINT chart_features_rhythm_grid_check CHECK (((rhythm_grid IS NULL) OR (jsonb_typeof(rhythm_grid) = 'object'::text))),
    CONSTRAINT chart_features_transition_ratio_check CHECK ((jsonb_typeof(transition_ratio) = 'object'::text))
);


--
-- Name: chart_job_attempts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.chart_job_attempts (
    id uuid NOT NULL,
    job_id bigint NOT NULL,
    worker_id character varying(128) NOT NULL,
    claim_request_id uuid NOT NULL,
    lease_expires_at timestamp with time zone NOT NULL,
    heartbeat_seq bigint DEFAULT 0 NOT NULL,
    assigned_files jsonb DEFAULT '[]'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    finished_at timestamp with time zone,
    CONSTRAINT chart_job_attempts_assigned_files_check CHECK ((jsonb_typeof(assigned_files) = 'array'::text)),
    CONSTRAINT chart_job_attempts_check CHECK ((lease_expires_at > created_at)),
    CONSTRAINT chart_job_attempts_check1 CHECK (((finished_at IS NULL) OR (finished_at >= created_at))),
    CONSTRAINT chart_job_attempts_heartbeat_seq_check CHECK ((heartbeat_seq >= 0)),
    CONSTRAINT chart_job_attempts_worker_id_check CHECK ((btrim((worker_id)::text) <> ''::text))
);


--
-- Name: chart_job_results; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.chart_job_results (
    result_id uuid NOT NULL,
    job_id bigint NOT NULL,
    attempt_id uuid NOT NULL,
    stage character varying(12) NOT NULL,
    payload_hash character varying(64) NOT NULL,
    receipt jsonb NOT NULL,
    accepted_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT chart_job_results_payload_hash_check CHECK (((payload_hash)::text ~ '^[0-9a-f]{64}$'::text)),
    CONSTRAINT chart_job_results_receipt_check CHECK ((jsonb_typeof(receipt) = 'object'::text)),
    CONSTRAINT chart_job_results_stage_check CHECK (((stage)::text = ANY ((ARRAY['SEPARATING'::character varying, 'TRANSCRIBING'::character varying])::text[])))
);


--
-- Name: chart_jobs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.chart_jobs (
    id bigint NOT NULL,
    song_id bigint NOT NULL,
    user_id bigint NOT NULL,
    status character varying(12) DEFAULT 'QUEUED'::character varying NOT NULL,
    progress smallint DEFAULT 0 NOT NULL,
    source_key character varying(300),
    drum_stem_key character varying(300),
    separation_model character varying(50),
    transcription_model character varying(50),
    metrics jsonb,
    error_code character varying(50),
    error_message character varying(500),
    revision bigint DEFAULT 0 NOT NULL,
    current_attempt_id uuid,
    resume_stage character varying(12) DEFAULT 'SEPARATING'::character varying NOT NULL,
    next_attempt_at timestamp with time zone DEFAULT now() NOT NULL,
    stage_deadline_at timestamp with time zone,
    separation_retry_count integer DEFAULT 0 NOT NULL,
    transcription_retry_count integer DEFAULT 0 NOT NULL,
    idempotency_key character varying(128) NOT NULL,
    request_hash character varying(64) NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    started_at timestamp with time zone,
    finished_at timestamp with time zone,
    separation_model_version character varying(128),
    queued_at timestamp with time zone DEFAULT now() NOT NULL,
    error_reason character varying(32),
    CONSTRAINT chart_jobs_check CHECK ((((status)::text = ANY ((ARRAY['DONE'::character varying, 'FAILED'::character varying])::text[])) = (finished_at IS NOT NULL))),
    CONSTRAINT chart_jobs_check1 CHECK ((((status)::text <> 'DONE'::text) OR (progress = 100))),
    CONSTRAINT chart_jobs_check2 CHECK ((((status)::text <> ALL ((ARRAY['SEPARATING'::character varying, 'TRANSCRIBING'::character varying])::text[])) OR (current_attempt_id IS NOT NULL))),
    CONSTRAINT chart_jobs_check3 CHECK (((started_at IS NULL) OR (started_at >= created_at))),
    CONSTRAINT chart_jobs_check4 CHECK (((finished_at IS NULL) OR (finished_at >= created_at))),
    CONSTRAINT chart_jobs_error_reason_check CHECK (((error_reason)::text = ANY ((ARRAY['SOURCE_INVALID'::character varying, 'NOT_TRANSCRIBABLE'::character varying, 'GPU_OUT_OF_MEMORY'::character varying, 'INTERNAL_ERROR'::character varying])::text[]))),
    CONSTRAINT chart_jobs_idempotency_key_check CHECK ((btrim((idempotency_key)::text) <> ''::text)),
    CONSTRAINT chart_jobs_metrics_check CHECK ((jsonb_typeof(metrics) = 'object'::text)),
    CONSTRAINT chart_jobs_progress_check CHECK (((progress >= 0) AND (progress <= 100))),
    CONSTRAINT chart_jobs_request_hash_check CHECK (((request_hash)::text ~ '^[0-9a-f]{64}$'::text)),
    CONSTRAINT chart_jobs_resume_stage_check CHECK (((resume_stage)::text = ANY ((ARRAY['SEPARATING'::character varying, 'TRANSCRIBING'::character varying])::text[]))),
    CONSTRAINT chart_jobs_revision_check CHECK ((revision >= 0)),
    CONSTRAINT chart_jobs_separation_retry_count_check CHECK ((separation_retry_count >= 0)),
    CONSTRAINT chart_jobs_status_check CHECK (((status)::text = ANY ((ARRAY['QUEUED'::character varying, 'SEPARATING'::character varying, 'TRANSCRIBING'::character varying, 'DONE'::character varying, 'FAILED'::character varying])::text[]))),
    CONSTRAINT chart_jobs_transcription_retry_count_check CHECK ((transcription_retry_count >= 0))
);


--
-- Name: chart_jobs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.chart_jobs ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.chart_jobs_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: chart_versions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.chart_versions (
    id bigint NOT NULL,
    chart_id bigint NOT NULL,
    version integer NOT NULL,
    schema_version integer DEFAULT 1 NOT NULL,
    notes jsonb NOT NULL,
    timing jsonb NOT NULL,
    notation_status character varying(12) NOT NULL,
    note_count integer NOT NULL,
    generator character varying(20) NOT NULL,
    generator_version character varying(50),
    sheet_pages jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT chart_versions_check CHECK (
CASE
    WHEN (jsonb_typeof(notes) = 'array'::text) THEN (jsonb_array_length(notes) = note_count)
    ELSE false
END),
    CONSTRAINT chart_versions_generator_check CHECK (((generator)::text = ANY ((ARRAY['BUILTIN'::character varying, 'MIDI_RULE'::character varying, 'ADT_MODEL'::character varying, 'MANUAL'::character varying, 'MUSICXML_RULE'::character varying])::text[]))),
    CONSTRAINT chart_versions_notation_status_check CHECK (((notation_status)::text = ANY ((ARRAY['PENDING'::character varying, 'READY'::character varying, 'UNAVAILABLE'::character varying])::text[]))),
    CONSTRAINT chart_versions_note_count_check CHECK ((note_count >= 0)),
    CONSTRAINT chart_versions_schema_version_check CHECK ((schema_version > 0)),
    CONSTRAINT chart_versions_sheet_pages_check CHECK (((sheet_pages IS NULL) OR (jsonb_typeof(sheet_pages) = 'array'::text))),
    CONSTRAINT chart_versions_timing_check CHECK ((jsonb_typeof(timing) = 'object'::text)),
    CONSTRAINT chart_versions_version_check CHECK ((version > 0))
);


--
-- Name: chart_versions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.chart_versions ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.chart_versions_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: chart_worker_files; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.chart_worker_files (
    id uuid NOT NULL,
    job_id bigint NOT NULL,
    attempt_id uuid NOT NULL,
    role character varying(24) NOT NULL,
    object_key character varying(300) NOT NULL,
    content_type character varying(64) NOT NULL,
    size_bytes bigint,
    sha256 character varying(64),
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT chart_worker_files_role_check CHECK (((role)::text = ANY ((ARRAY['STAGING_DRUM'::character varying, 'STAGING_ACCOMPANIMENT'::character varying, 'DRUM_STEM'::character varying, 'ACCOMPANIMENT'::character varying])::text[]))),
    CONSTRAINT chart_worker_files_sha256_check CHECK (((sha256)::text ~ '^[0-9a-f]{64}$'::text)),
    CONSTRAINT chart_worker_files_size_bytes_check CHECK ((size_bytes > 0))
);


--
-- Name: chart_worker_presence; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.chart_worker_presence (
    worker_id character varying(128) NOT NULL,
    last_seen_at timestamp with time zone NOT NULL,
    CONSTRAINT chart_worker_presence_worker_id_check CHECK ((btrim((worker_id)::text) <> ''::text))
);


--
-- Name: charts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.charts (
    id bigint NOT NULL,
    song_id bigint NOT NULL,
    difficulty character varying(6) NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT charts_difficulty_check CHECK (((difficulty)::text = ANY ((ARRAY['EASY'::character varying, 'NORMAL'::character varying, 'HARD'::character varying])::text[])))
);


--
-- Name: charts_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.charts ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.charts_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: hits; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.hits (
    id bigint NOT NULL,
    play_session_id uuid NOT NULL,
    seq integer NOT NULL,
    t_ms double precision NOT NULL,
    stick_id smallint,
    pad character varying(16) NOT NULL,
    baseline_pad character varying(16),
    predicted_pad character varying(16),
    velocity smallint,
    peak_accel real,
    pitch real,
    yaw real,
    judgement character varying(7),
    matched_note_id character varying(64),
    delta_ms double precision,
    CONSTRAINT hits_check CHECK (((((judgement IS NULL) AND (matched_note_id IS NULL) AND (delta_ms IS NULL) AND (velocity IS NOT NULL)) OR (((judgement)::text = ANY (ARRAY[('PERFECT'::character varying)::text, ('GOOD'::character varying)::text])) AND (matched_note_id IS NOT NULL) AND (delta_ms IS NOT NULL) AND (velocity IS NOT NULL)) OR (((judgement)::text = 'MISS'::text) AND (matched_note_id IS NOT NULL) AND (delta_ms IS NULL) AND (stick_id IS NULL) AND (velocity IS NULL) AND (peak_accel IS NULL) AND (pitch IS NULL) AND (yaw IS NULL) AND (baseline_pad IS NULL) AND (predicted_pad IS NULL))) IS TRUE)),
    CONSTRAINT hits_delta_ms_check CHECK (((delta_ms > '-Infinity'::double precision) AND (delta_ms < 'Infinity'::double precision))),
    CONSTRAINT hits_judgement_check CHECK (((judgement)::text = ANY ((ARRAY['PERFECT'::character varying, 'GOOD'::character varying, 'MISS'::character varying])::text[]))),
    CONSTRAINT hits_matched_note_id_check CHECK ((btrim((matched_note_id)::text) <> ''::text)),
    CONSTRAINT hits_pad_check CHECK ((btrim((pad)::text) <> ''::text)),
    CONSTRAINT hits_peak_accel_check CHECK (((peak_accel > '-Infinity'::real) AND (peak_accel < 'Infinity'::real))),
    CONSTRAINT hits_pitch_check CHECK (((pitch > '-Infinity'::real) AND (pitch < 'Infinity'::real))),
    CONSTRAINT hits_seq_check CHECK ((seq >= 0)),
    CONSTRAINT hits_stick_id_check CHECK ((stick_id = ANY (ARRAY[0, 1]))),
    CONSTRAINT hits_t_ms_check CHECK (((t_ms > '-Infinity'::double precision) AND (t_ms < 'Infinity'::double precision))),
    CONSTRAINT hits_velocity_check CHECK (((velocity >= 0) AND (velocity <= 127))),
    CONSTRAINT hits_yaw_check CHECK (((yaw > '-Infinity'::real) AND (yaw < 'Infinity'::real)))
);


--
-- Name: play_sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.play_sessions (
    id uuid NOT NULL,
    user_id bigint NOT NULL,
    song_id bigint,
    chart_version_id bigint,
    mode character varying(6) NOT NULL,
    input_source character varying(10) NOT NULL,
    kit_preset_id bigint,
    kit_preset_snapshot jsonb,
    calibration jsonb,
    score integer,
    accuracy numeric(5,2),
    max_combo integer,
    judgement_counts jsonb,
    judgement_context jsonb,
    live_coach_events jsonb,
    consent boolean DEFAULT false NOT NULL,
    raw_log_key character varying(300),
    raw_log_status character varying(10) DEFAULT 'PENDING'::character varying NOT NULL,
    client_meta jsonb,
    payload_schema_version integer NOT NULL,
    payload_hash character varying(64) NOT NULL,
    started_at timestamp with time zone NOT NULL,
    ended_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT play_sessions_accuracy_check CHECK (((accuracy >= (0)::numeric) AND (accuracy <= (100)::numeric))),
    CONSTRAINT play_sessions_calibration_check CHECK ((jsonb_typeof(calibration) = 'object'::text)),
    CONSTRAINT play_sessions_check CHECK ((ended_at >= started_at)),
    CONSTRAINT play_sessions_check1 CHECK ((((raw_log_status)::text = 'UPLOADED'::text) = (raw_log_key IS NOT NULL))),
    CONSTRAINT play_sessions_check2 CHECK (((((mode)::text = ANY ((ARRAY['RHYTHM'::character varying, 'SHEET'::character varying])::text[])) AND (song_id IS NOT NULL) AND (chart_version_id IS NOT NULL) AND (judgement_context IS NOT NULL)) OR (((mode)::text = ANY ((ARRAY['FREE'::character varying, 'TEMPO'::character varying])::text[])) AND (song_id IS NULL) AND (chart_version_id IS NULL)))),
    CONSTRAINT play_sessions_client_meta_check CHECK ((jsonb_typeof(client_meta) = 'object'::text)),
    CONSTRAINT play_sessions_input_source_check CHECK (((input_source)::text = ANY ((ARRAY['KEYBOARD'::character varying, 'STICK'::character varying])::text[]))),
    CONSTRAINT play_sessions_judgement_context_check CHECK ((jsonb_typeof(judgement_context) = 'object'::text)),
    CONSTRAINT play_sessions_judgement_counts_check CHECK ((jsonb_typeof(judgement_counts) = 'object'::text)),
    CONSTRAINT play_sessions_kit_preset_snapshot_check CHECK ((jsonb_typeof(kit_preset_snapshot) = 'object'::text)),
    CONSTRAINT play_sessions_live_coach_events_check CHECK ((jsonb_typeof(live_coach_events) = 'array'::text)),
    CONSTRAINT play_sessions_max_combo_check CHECK ((max_combo >= 0)),
    CONSTRAINT play_sessions_mode_check CHECK (((mode)::text = ANY ((ARRAY['RHYTHM'::character varying, 'FREE'::character varying, 'TEMPO'::character varying, 'SHEET'::character varying])::text[]))),
    CONSTRAINT play_sessions_payload_hash_check CHECK (((payload_hash)::text ~ '^[0-9a-f]{64}$'::text)),
    CONSTRAINT play_sessions_payload_schema_version_check CHECK ((payload_schema_version > 0)),
    CONSTRAINT play_sessions_raw_log_key_check CHECK ((btrim((raw_log_key)::text) <> ''::text)),
    CONSTRAINT play_sessions_raw_log_status_check CHECK (((raw_log_status)::text = ANY ((ARRAY['PENDING'::character varying, 'UPLOADED'::character varying])::text[]))),
    CONSTRAINT play_sessions_score_check CHECK ((score >= 0))
);


--
-- Name: songs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.songs (
    id bigint NOT NULL,
    owner_id bigint,
    title character varying(100) NOT NULL,
    artist character varying(100),
    source character varying(10) NOT NULL,
    status character varying(12) DEFAULT 'READY'::character varying NOT NULL,
    bpm numeric(6,2),
    offset_ms integer DEFAULT 0 NOT NULL,
    time_signature character varying(5),
    duration_ms integer,
    license character varying(200),
    accompaniment_key character varying(300),
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone,
    cover_key character varying(300),
    published boolean DEFAULT true NOT NULL,
    song_level character varying(12),
    level_chart_version_id bigint,
    level_rule_version character varying(30),
    level_duration_ms integer,
    level_legacy_fallback boolean DEFAULT false NOT NULL,
    CONSTRAINT songs_accompaniment_source_check CHECK (((accompaniment_key IS NULL) OR ((source)::text = ANY ((ARRAY['AUDIO'::character varying, 'BUILTIN'::character varying, 'MIDI'::character varying])::text[])))),
    CONSTRAINT songs_bpm_check CHECK (((bpm > (0)::numeric) AND (bpm <> 'NaN'::numeric))),
    CONSTRAINT songs_check CHECK ((((source)::text = 'BUILTIN'::text) = (owner_id IS NULL))),
    CONSTRAINT songs_check2 CHECK ((((source)::text <> 'BUILTIN'::text) OR ((license IS NOT NULL) AND (btrim((license)::text) <> ''::text)))),
    CONSTRAINT songs_duration_ms_check CHECK ((duration_ms >= 0)),
    CONSTRAINT songs_level_valid CHECK ((((song_level IS NULL) AND (level_chart_version_id IS NULL) AND (level_rule_version IS NULL) AND (level_duration_ms IS NULL)) OR ((song_level IS NOT NULL) AND ((song_level)::text = ANY ((ARRAY['BEGINNER'::character varying, 'INTERMEDIATE'::character varying, 'ADVANCED'::character varying])::text[])) AND (level_chart_version_id IS NOT NULL) AND (level_rule_version IS NOT NULL) AND (btrim((level_rule_version)::text) <> ''::text) AND (level_duration_ms IS NOT NULL) AND (level_duration_ms > 0)))),
    CONSTRAINT songs_published_builtin_check CHECK ((((source)::text = 'BUILTIN'::text) OR published)),
    CONSTRAINT songs_source_check CHECK (((source)::text = ANY ((ARRAY['BUILTIN'::character varying, 'MIDI'::character varying, 'AUDIO'::character varying, 'MUSICXML'::character varying])::text[]))),
    CONSTRAINT songs_status_check CHECK (((status)::text = ANY ((ARRAY['READY'::character varying, 'PROCESSING'::character varying, 'FAILED'::character varying])::text[])))
);


--
-- Name: users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.users (
    id bigint NOT NULL,
    nickname character varying(30) NOT NULL,
    email character varying(255),
    profile_image_url character varying(500),
    role character varying(10) DEFAULT 'USER'::character varying NOT NULL,
    status character varying(10) DEFAULT 'ACTIVE'::character varying NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    withdrawn_at timestamp with time zone,
    data_consent boolean,
    data_consent_at timestamp with time zone,
    data_consent_version character varying(50),
    terms_version character varying(50),
    terms_agreed_at timestamp with time zone,
    privacy_version character varying(50),
    privacy_agreed_at timestamp with time zone,
    CONSTRAINT ck_users_data_consent CHECK ((((data_consent IS NULL) AND (data_consent_at IS NULL) AND (data_consent_version IS NULL)) OR ((data_consent IS NOT NULL) AND (data_consent_at IS NOT NULL) AND (data_consent_version IS NOT NULL) AND (btrim((data_consent_version)::text) <> ''::text)))),
    CONSTRAINT ck_users_privacy_consent CHECK ((((privacy_version IS NULL) AND (privacy_agreed_at IS NULL)) OR ((privacy_version IS NOT NULL) AND (privacy_agreed_at IS NOT NULL) AND (btrim((privacy_version)::text) <> ''::text)))),
    CONSTRAINT ck_users_role CHECK (((role)::text = ANY ((ARRAY['USER'::character varying, 'ADMIN'::character varying])::text[]))),
    CONSTRAINT ck_users_status CHECK (((status)::text = ANY ((ARRAY['ACTIVE'::character varying, 'WITHDRAWN'::character varying])::text[]))),
    CONSTRAINT ck_users_terms_consent CHECK ((((terms_version IS NULL) AND (terms_agreed_at IS NULL)) OR ((terms_version IS NOT NULL) AND (terms_agreed_at IS NOT NULL) AND (btrim((terms_version)::text) <> ''::text)))),
    CONSTRAINT ck_users_withdrawn_at CHECK ((((status)::text = 'WITHDRAWN'::text) = (withdrawn_at IS NOT NULL)))
);


--
-- Name: TABLE users; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.users IS '회원. 탈퇴해도 행은 지우지 않고 status를 WITHDRAWN으로 바꾸고 개인정보 컬럼을 비운다';


--
-- Name: COLUMN users.email; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.users.email IS '제공자가 준 값. 식별자로 쓰지 않는다';


--
-- Name: COLUMN users.role; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.users.role IS 'USER / ADMIN';


--
-- Name: COLUMN users.status; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.users.status IS 'ACTIVE / WITHDRAWN';


--
-- Name: coach_export_v; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.coach_export_v WITH (security_barrier='true') AS
 WITH ranked AS (
         SELECT ps.id,
            ps.song_id,
            ps.chart_version_id,
            ps.mode,
            ps.input_source,
            ps.judgement_context,
            ps.payload_schema_version,
            ps.created_at,
            row_number() OVER (PARTITION BY ps.user_id ORDER BY ps.ended_at DESC, ps.id) AS recent_rank
           FROM (public.play_sessions ps
             JOIN public.users u ON ((u.id = ps.user_id)))
          WHERE (ps.consent AND ((ps.mode)::text = ANY ((ARRAY['RHYTHM'::character varying, 'SHEET'::character varying])::text[])) AND (ps.judgement_context IS NOT NULL) AND ((u.role)::text <> 'ADMIN'::text) AND ((u.status)::text = 'ACTIVE'::text) AND (current_setting('app.export_salt'::text) <> ''::text))
        )
 SELECT encode(sha256(convert_to(((r.id)::text || current_setting('app.export_salt'::text)), 'UTF8'::name)), 'hex'::text) AS session_key,
    r.mode,
    r.input_source,
        CASE
            WHEN (s.owner_id IS NULL) THEN r.song_id
            ELSE NULL::bigint
        END AS song_ref,
        CASE
            WHEN (s.owner_id IS NULL) THEN 'PUBLIC'::text
            ELSE 'PRIVATE'::text
        END AS song_origin,
    (((r.judgement_context -> 'timingWindows'::text) ->> 'perfectMs'::text))::double precision AS perfect_ms,
    (((r.judgement_context -> 'timingWindows'::text) ->> 'goodMs'::text))::double precision AS good_ms,
    c.difficulty,
    ((r.created_at AT TIME ZONE 'Asia/Seoul'::text))::date AS played_date,
    r.payload_schema_version,
    h.seq,
    h.t_ms,
    h.stick_id,
    h.pad,
    h.velocity,
    h.peak_accel,
    h.judgement,
    h.matched_note_id,
    h.delta_ms
   FROM ((((ranked r
     JOIN public.songs s ON ((s.id = r.song_id)))
     JOIN public.chart_versions v ON ((v.id = r.chart_version_id)))
     JOIN public.charts c ON ((c.id = v.chart_id)))
     JOIN public.hits h ON ((h.play_session_id = r.id)))
  WHERE (r.recent_rank <= 10);


--
-- Name: coach_narrative_jobs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.coach_narrative_jobs (
    id bigint NOT NULL,
    report_id bigint NOT NULL,
    status character varying(8) DEFAULT 'QUEUED'::character varying NOT NULL,
    attempt_count integer DEFAULT 0 NOT NULL,
    attempt_id uuid,
    worker_id character varying(64),
    claim_request_id uuid,
    lease_expires_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT coach_narrative_jobs_attempt_count_check CHECK (((attempt_count >= 0) AND (attempt_count <= 2))),
    CONSTRAINT coach_narrative_jobs_check CHECK ((((status)::text = 'RUNNING'::text) = (attempt_id IS NOT NULL))),
    CONSTRAINT coach_narrative_jobs_status_check CHECK (((status)::text = ANY ((ARRAY['QUEUED'::character varying, 'RUNNING'::character varying, 'DONE'::character varying, 'FAILED'::character varying])::text[])))
);


--
-- Name: coach_narrative_jobs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.coach_narrative_jobs ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.coach_narrative_jobs_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: file_cleanup_tasks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.file_cleanup_tasks (
    id bigint NOT NULL,
    object_key character varying(300) NOT NULL,
    file_role character varying(30) NOT NULL,
    user_id bigint,
    job_id bigint,
    attempt_id uuid,
    status character varying(10) DEFAULT 'PENDING'::character varying NOT NULL,
    retry_count integer DEFAULT 0 NOT NULL,
    next_attempt_at timestamp with time zone DEFAULT now() NOT NULL,
    last_error character varying(500),
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone,
    midi_original_id uuid,
    midi_job_id bigint,
    midi_attempt_id uuid,
    midi_recheck_until timestamp with time zone,
    CONSTRAINT file_cleanup_midi_reference_check CHECK ((((midi_job_id IS NULL) = (midi_attempt_id IS NULL)) AND (NOT ((midi_original_id IS NOT NULL) AND (midi_job_id IS NOT NULL))) AND (((midi_original_id IS NULL) AND (midi_job_id IS NULL)) OR ((job_id IS NULL) AND (attempt_id IS NULL))) AND (((file_role)::text <> 'MIDI_ORIGINAL'::text) OR (midi_original_id IS NOT NULL)) AND ((midi_original_id IS NULL) OR ((file_role)::text = 'MIDI_ORIGINAL'::text)) AND ((midi_job_id IS NULL) OR ((file_role)::text = 'ACCOMPANIMENT'::text)))),
    CONSTRAINT file_cleanup_tasks_check CHECK (((attempt_id IS NULL) OR (job_id IS NOT NULL))),
    CONSTRAINT file_cleanup_tasks_check1 CHECK ((((status)::text = 'DELETED'::text) = (deleted_at IS NOT NULL))),
    CONSTRAINT file_cleanup_tasks_check2 CHECK (((deleted_at IS NULL) OR (deleted_at >= created_at))),
    CONSTRAINT file_cleanup_tasks_file_role_check CHECK (((file_role)::text = ANY ((ARRAY['SOURCE'::character varying, 'DRUM_STEM'::character varying, 'ACCOMPANIMENT'::character varying, 'SHEET_PAGE'::character varying, 'RAW_LOG'::character varying, 'RECORDING'::character varying, 'STAGING'::character varying, 'COVER'::character varying, 'SHEET_MUSIC'::character varying, 'MIDI_ORIGINAL'::character varying])::text[]))),
    CONSTRAINT file_cleanup_tasks_object_key_check CHECK ((btrim((object_key)::text) <> ''::text)),
    CONSTRAINT file_cleanup_tasks_retry_count_check CHECK ((retry_count >= 0)),
    CONSTRAINT file_cleanup_tasks_status_check CHECK (((status)::text = ANY ((ARRAY['PENDING'::character varying, 'DELETING'::character varying, 'DELETED'::character varying, 'FAILED'::character varying])::text[])))
);


--
-- Name: file_cleanup_tasks_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.file_cleanup_tasks ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.file_cleanup_tasks_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: flyway_schema_history; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.flyway_schema_history (
    installed_rank integer NOT NULL,
    version character varying(50),
    description character varying(200) NOT NULL,
    type character varying(20) NOT NULL,
    script character varying(1000) NOT NULL,
    checksum integer,
    installed_by character varying(100) NOT NULL,
    installed_on timestamp without time zone DEFAULT now() NOT NULL,
    execution_time integer NOT NULL,
    success boolean NOT NULL
);


--
-- Name: hits_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.hits ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.hits_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: kit_presets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.kit_presets (
    id bigint NOT NULL,
    user_id bigint NOT NULL,
    name character varying(50) NOT NULL,
    is_default boolean DEFAULT false NOT NULL,
    layout jsonb NOT NULL,
    sounds jsonb NOT NULL,
    tuning jsonb,
    schema_version integer DEFAULT 1 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT kit_presets_layout_check CHECK ((jsonb_typeof(layout) = 'object'::text)),
    CONSTRAINT kit_presets_name_check CHECK ((btrim((name)::text) <> ''::text)),
    CONSTRAINT kit_presets_schema_version_check CHECK ((schema_version > 0)),
    CONSTRAINT kit_presets_sounds_check CHECK ((jsonb_typeof(sounds) = 'object'::text)),
    CONSTRAINT kit_presets_tuning_check CHECK ((jsonb_typeof(tuning) = 'object'::text))
);


--
-- Name: kit_presets_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.kit_presets ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.kit_presets_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: lesson_completions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.lesson_completions (
    user_id bigint NOT NULL,
    song_id bigint NOT NULL,
    completed_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: lessons; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.lessons (
    song_id bigint NOT NULL,
    "position" integer NOT NULL,
    kind character varying(4) NOT NULL,
    summary text NOT NULL,
    pads jsonb NOT NULL,
    guide boolean DEFAULT true NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    course character varying(12) DEFAULT 'BEGINNER'::character varying NOT NULL,
    CONSTRAINT ck_lessons_course CHECK (((course)::text = ANY ((ARRAY['BEGINNER'::character varying, 'INTERMEDIATE'::character varying])::text[]))),
    CONSTRAINT lessons_kind_check CHECK (((kind)::text = ANY ((ARRAY['READ'::character varying, 'PLAY'::character varying])::text[]))),
    CONSTRAINT lessons_pads_check CHECK ((jsonb_typeof(pads) = 'array'::text)),
    CONSTRAINT lessons_position_check CHECK (("position" >= 1)),
    CONSTRAINT lessons_summary_check CHECK (((char_length(summary) >= 1) AND (char_length(summary) <= 200)))
);


--
-- Name: live_coach_jobs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.live_coach_jobs (
    id bigint NOT NULL,
    public_id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id bigint NOT NULL,
    run_id uuid NOT NULL,
    facts jsonb NOT NULL,
    status character varying(8) DEFAULT 'QUEUED'::character varying NOT NULL,
    attempt_id uuid,
    worker_id character varying(64),
    claim_request_id uuid,
    lease_expires_at timestamp with time zone,
    title character varying(8),
    sub character varying(20),
    model character varying(37),
    generation_ms integer,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT live_coach_jobs_check CHECK ((((status)::text = 'RUNNING'::text) = (attempt_id IS NOT NULL))),
    CONSTRAINT live_coach_jobs_check1 CHECK ((((status)::text = 'DONE'::text) = (title IS NOT NULL))),
    CONSTRAINT live_coach_jobs_facts_check CHECK ((jsonb_typeof(facts) = 'object'::text)),
    CONSTRAINT live_coach_jobs_generation_ms_check CHECK (((generation_ms IS NULL) OR (generation_ms >= 0))),
    CONSTRAINT live_coach_jobs_status_check CHECK (((status)::text = ANY ((ARRAY['QUEUED'::character varying, 'RUNNING'::character varying, 'DONE'::character varying, 'FAILED'::character varying])::text[])))
);


--
-- Name: live_coach_jobs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.live_coach_jobs ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.live_coach_jobs_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: midi_accompaniment_attempts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.midi_accompaniment_attempts (
    id uuid NOT NULL,
    job_id bigint NOT NULL,
    created_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL
);


--
-- Name: midi_accompaniment_jobs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.midi_accompaniment_jobs (
    id bigint NOT NULL,
    song_id bigint NOT NULL,
    user_id bigint NOT NULL,
    original_id uuid NOT NULL,
    timing jsonb NOT NULL,
    duration_ms integer NOT NULL,
    status character varying(10) NOT NULL,
    attempt_id uuid,
    attempts integer DEFAULT 0 NOT NULL,
    lease_expires_at timestamp with time zone,
    attempt_deadline_at timestamp with time zone,
    next_attempt_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    error_code character varying(50),
    created_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    finished_at timestamp with time zone,
    CONSTRAINT midi_accompaniment_jobs_attempts_check CHECK (((attempts >= 0) AND (attempts <= 3))),
    CONSTRAINT midi_accompaniment_jobs_check CHECK ((((status)::text = 'RUNNING'::text) = ((attempt_id IS NOT NULL) AND (lease_expires_at IS NOT NULL) AND (attempt_deadline_at IS NOT NULL)))),
    CONSTRAINT midi_accompaniment_jobs_check1 CHECK ((((status)::text = ANY ((ARRAY['DONE'::character varying, 'FAILED'::character varying, 'CANCELLED'::character varying])::text[])) = (finished_at IS NOT NULL))),
    CONSTRAINT midi_accompaniment_jobs_duration_ms_check CHECK (((duration_ms >= 1) AND (duration_ms <= 1800000))),
    CONSTRAINT midi_accompaniment_jobs_status_check CHECK (((status)::text = ANY ((ARRAY['QUEUED'::character varying, 'RUNNING'::character varying, 'DONE'::character varying, 'FAILED'::character varying, 'CANCELLED'::character varying])::text[]))),
    CONSTRAINT midi_accompaniment_jobs_timing_check CHECK ((jsonb_typeof(timing) = 'object'::text))
);


--
-- Name: midi_accompaniment_jobs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.midi_accompaniment_jobs ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.midi_accompaniment_jobs_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: midi_original_uploads; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.midi_original_uploads (
    id uuid NOT NULL,
    user_id bigint NOT NULL,
    reserved_song_id bigint NOT NULL,
    song_id bigint,
    object_key character varying(300) NOT NULL,
    size_bytes integer NOT NULL,
    sha256 character varying(64) NOT NULL,
    status character varying(10) NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    retired_at timestamp with time zone,
    CONSTRAINT midi_original_uploads_check CHECK ((((status)::text = 'ACCEPTED'::text) = (song_id IS NOT NULL))),
    CONSTRAINT midi_original_uploads_check1 CHECK ((((status)::text = 'RETIRED'::text) = (retired_at IS NOT NULL))),
    CONSTRAINT midi_original_uploads_check2 CHECK (((song_id IS NULL) OR (song_id = reserved_song_id))),
    CONSTRAINT midi_original_uploads_object_key_check CHECK (((object_key)::text ~~ 'midi-original/%'::text)),
    CONSTRAINT midi_original_uploads_sha256_check CHECK (((sha256)::text ~ '^[0-9a-f]{64}$'::text)),
    CONSTRAINT midi_original_uploads_size_bytes_check CHECK (((size_bytes >= 1) AND (size_bytes <= 1048576))),
    CONSTRAINT midi_original_uploads_status_check CHECK (((status)::text = ANY ((ARRAY['RECEIVING'::character varying, 'ACCEPTED'::character varying, 'RETIRED'::character varying])::text[])))
);


--
-- Name: play_raw_uploads; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.play_raw_uploads (
    id uuid NOT NULL,
    original_play_id uuid NOT NULL,
    play_session_id uuid,
    object_key character varying(300) NOT NULL,
    payload_hash character varying(64) NOT NULL,
    payload_bytes bigint NOT NULL,
    status character varying(10) NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    retired_at timestamp with time zone,
    CONSTRAINT play_raw_uploads_check CHECK (((play_session_id IS NULL) OR (play_session_id = original_play_id))),
    CONSTRAINT play_raw_uploads_check1 CHECK ((((status)::text = 'RETIRED'::text) = (retired_at IS NOT NULL))),
    CONSTRAINT play_raw_uploads_check2 CHECK ((expires_at > created_at)),
    CONSTRAINT play_raw_uploads_object_key_check CHECK (((object_key)::text ~~ 'play-raw/%'::text)),
    CONSTRAINT play_raw_uploads_payload_bytes_check CHECK (((payload_bytes > 0) AND (payload_bytes <= 67108864))),
    CONSTRAINT play_raw_uploads_payload_hash_check CHECK (((payload_hash)::text ~ '^[0-9a-f]{64}$'::text)),
    CONSTRAINT play_raw_uploads_status_check CHECK (((status)::text = ANY ((ARRAY['UPLOADING'::character varying, 'ACCEPTED'::character varying, 'RETIRED'::character varying])::text[])))
);


--
-- Name: recommend_songs_v; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.recommend_songs_v WITH (security_barrier='true') AS
 SELECT id AS song_id,
    bpm,
    duration_ms,
    song_level,
    true AS public
   FROM public.songs s
  WHERE (((source)::text = 'BUILTIN'::text) AND (owner_id IS NULL) AND ((status)::text = 'READY'::text) AND published AND (deleted_at IS NULL) AND (song_level IS NOT NULL) AND (bpm IS NOT NULL) AND (duration_ms IS NOT NULL));


--
-- Name: recommend_chart_features_v; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.recommend_chart_features_v WITH (security_barrier='true') AS
 SELECT c.id AS chart_id,
    c.song_id,
    c.difficulty,
    f.avg_notes_per_sec,
    f.peak_notes_2s,
    (f.pad_ratio)::text AS pad_ratio,
    (f.transition_ratio)::text AS transition_ratio,
    (COALESCE(f.rhythm_grid, '{"excluded": "NOT_COMPUTED"}'::jsonb))::text AS rhythm_grid
   FROM (((public.recommend_songs_v s
     JOIN public.charts c ON ((c.song_id = s.song_id)))
     JOIN public.chart_versions v ON ((v.id = ( SELECT x.id
           FROM public.chart_versions x
          WHERE (x.chart_id = c.id)
          ORDER BY x.version DESC
         LIMIT 1))))
     JOIN public.chart_features f ON ((f.chart_version_id = v.id)));


--
-- Name: recommendation_user_keys; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.recommendation_user_keys (
    user_id bigint NOT NULL,
    user_key text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT recommendation_user_keys_user_key_check CHECK ((user_key ~ '^[0-9a-f]{32}$'::text))
);


--
-- Name: user_recommendation_consent; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_recommendation_consent (
    user_id bigint NOT NULL,
    agreed boolean NOT NULL,
    version character varying(50) NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    CONSTRAINT user_recommendation_consent_version_check CHECK ((btrim((version)::text) <> ''::text))
);


--
-- Name: recommend_interactions_v; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.recommend_interactions_v WITH (security_barrier='true') AS
 SELECT k.user_key,
    p.song_id,
    v.chart_id,
    p.ended_at AS played_at,
    p.accuracy,
    ((EXTRACT(epoch FROM (p.ended_at - p.started_at)) * (1000)::numeric) >= (0.8 * (s.duration_ms)::numeric)) AS completed,
    p.mode
   FROM ((((((public.play_sessions p
     JOIN public.user_recommendation_consent c ON (((c.user_id = p.user_id) AND c.agreed)))
     JOIN public.users u ON (((u.id = p.user_id) AND ((u.status)::text = 'ACTIVE'::text))))
     JOIN public.recommendation_user_keys k ON ((k.user_id = p.user_id)))
     JOIN public.chart_versions v ON ((v.id = p.chart_version_id)))
     JOIN public.recommend_chart_features_v f ON ((f.chart_id = v.chart_id)))
     JOIN public.recommend_songs_v s ON ((s.song_id = p.song_id)))
  WHERE (((p.mode)::text = ANY ((ARRAY['RHYTHM'::character varying, 'SHEET'::character varying])::text[])) AND p.consent AND (p.accuracy IS NOT NULL));


--
-- Name: song_metadata; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.song_metadata (
    song_id bigint NOT NULL,
    genre character varying(12) NOT NULL,
    sub_genres text[] DEFAULT '{}'::text[] NOT NULL,
    mood text[] DEFAULT '{}'::text[] NOT NULL,
    energy smallint,
    release_year smallint,
    language character varying(12),
    drum_style text[] DEFAULT '{}'::text[] NOT NULL,
    source character varying(12) NOT NULL,
    source_note character varying(200),
    updated_at timestamp with time zone NOT NULL,
    CONSTRAINT song_metadata_drum_style_check CHECK (((cardinality(drum_style) <= 3) AND (drum_style <@ ARRAY['EIGHT_BEAT'::text, 'SIXTEEN_BEAT'::text, 'SHUFFLE'::text, 'HALF_TIME'::text, 'FOUR_ON_FLOOR'::text, 'DOUBLE_KICK'::text, 'SYNCOPATED'::text, 'FILL_HEAVY'::text, 'LATIN_PERCUSSION'::text]))),
    CONSTRAINT song_metadata_energy_check CHECK (((energy >= 1) AND (energy <= 5))),
    CONSTRAINT song_metadata_external_note CHECK ((((source)::text <> 'EXTERNAL_DB'::text) OR ((source_note IS NOT NULL) AND (btrim((source_note)::text) <> ''::text)))),
    CONSTRAINT song_metadata_genre_check CHECK (((genre)::text = ANY ((ARRAY['ROCK'::character varying, 'POP'::character varying, 'KPOP'::character varying, 'BALLAD'::character varying, 'JAZZ'::character varying, 'FUNK'::character varying, 'LATIN'::character varying, 'METAL'::character varying, 'PUNK'::character varying, 'HIPHOP'::character varying, 'ELECTRONIC'::character varying, 'SOUNDTRACK'::character varying, 'PRACTICE'::character varying, 'OTHER'::character varying])::text[]))),
    CONSTRAINT song_metadata_language_check CHECK (((language)::text = ANY ((ARRAY['KO'::character varying, 'EN'::character varying, 'JA'::character varying, 'INSTRUMENTAL'::character varying, 'OTHER'::character varying])::text[]))),
    CONSTRAINT song_metadata_mood_check CHECK (((cardinality(mood) <= 2) AND (mood <@ ARRAY['CALM'::text, 'UPLIFTING'::text, 'ENERGETIC'::text, 'DARK'::text, 'SENTIMENTAL'::text]))),
    CONSTRAINT song_metadata_release_year_check CHECK (((release_year >= 1900) AND (release_year <= 2099))),
    CONSTRAINT song_metadata_source_check CHECK (((source)::text = ANY ((ARRAY['HUMAN'::character varying, 'AUTO'::character varying, 'EXTERNAL_DB'::character varying])::text[]))),
    CONSTRAINT song_metadata_sub_genres_check CHECK (((cardinality(sub_genres) <= 2) AND (sub_genres <@ ARRAY['ROCK'::text, 'POP'::text, 'KPOP'::text, 'BALLAD'::text, 'JAZZ'::text, 'FUNK'::text, 'LATIN'::text, 'METAL'::text, 'PUNK'::text, 'HIPHOP'::text, 'ELECTRONIC'::text, 'SOUNDTRACK'::text, 'PRACTICE'::text, 'OTHER'::text])))
);


--
-- Name: recommend_song_meta_v; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.recommend_song_meta_v WITH (security_barrier='true') AS
 SELECT m.song_id,
    m.genre,
    array_to_string(m.sub_genres, ';'::text) AS sub_genres,
    array_to_string(m.mood, ';'::text) AS mood,
    m.energy,
    m.language,
    array_to_string(m.drum_style, ';'::text) AS drum_style,
    m.release_year
   FROM (public.song_metadata m
     JOIN public.recommend_songs_v s ON ((s.song_id = m.song_id)));


--
-- Name: recommend_users_v; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.recommend_users_v WITH (security_barrier='true') AS
 SELECT k.user_key,
    true AS consent_recommendation,
    c.version AS consent_version
   FROM ((public.user_recommendation_consent c
     JOIN public.users u ON ((u.id = c.user_id)))
     JOIN public.recommendation_user_keys k ON ((k.user_id = c.user_id)))
  WHERE (c.agreed AND ((u.status)::text = 'ACTIVE'::text));


--
-- Name: recommendation_candidates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.recommendation_candidates (
    user_id bigint NOT NULL,
    rank integer NOT NULL,
    song_id bigint NOT NULL,
    model_version character varying(64) NOT NULL,
    batch_id character varying(64) NOT NULL,
    generated_at timestamp with time zone NOT NULL,
    CONSTRAINT recommendation_candidates_batch_id_check CHECK ((btrim((batch_id)::text) <> ''::text)),
    CONSTRAINT recommendation_candidates_model_version_check CHECK ((btrim((model_version)::text) <> ''::text)),
    CONSTRAINT recommendation_candidates_rank_check CHECK (((rank >= 1) AND (rank <= 50)))
);


--
-- Name: recommendation_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.recommendation_items (
    request_id uuid NOT NULL,
    rank integer NOT NULL,
    user_id bigint NOT NULL,
    context character varying(12) NOT NULL,
    strategy character varying(20) NOT NULL,
    song_id bigint NOT NULL,
    chart_id bigint NOT NULL,
    score numeric(6,4) NOT NULL,
    reason_codes jsonb NOT NULL,
    shown_at timestamp with time zone DEFAULT now() NOT NULL,
    clicked_at timestamp with time zone,
    source_song_id bigint,
    CONSTRAINT recommendation_items_context_check CHECK (((context)::text = ANY ((ARRAY['SONG_PICKER'::character varying, 'REPORT'::character varying, 'SIMILAR'::character varying, 'DRILL'::character varying])::text[]))),
    CONSTRAINT recommendation_items_rank_check CHECK ((rank >= 1)),
    CONSTRAINT recommendation_items_reason_codes_check CHECK ((jsonb_typeof(reason_codes) = 'array'::text)),
    CONSTRAINT recommendation_items_strategy_check CHECK ((btrim((strategy)::text) <> ''::text))
);


--
-- Name: recordings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.recordings (
    id bigint NOT NULL,
    user_id bigint NOT NULL,
    play_session_id uuid,
    title character varying(100) NOT NULL,
    midi_key character varying(300),
    audio_key character varying(300),
    duration_ms integer NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone,
    client_key uuid NOT NULL,
    mode character varying(6) NOT NULL,
    input_source character varying(10) NOT NULL,
    schema_version integer NOT NULL,
    started_at timestamp with time zone NOT NULL,
    hit_count integer NOT NULL,
    hits jsonb NOT NULL,
    payload_hash character varying(64) NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    chart_version_id bigint,
    CONSTRAINT recordings_audio_key_check CHECK ((btrim((audio_key)::text) <> ''::text)),
    CONSTRAINT recordings_check CHECK (((jsonb_typeof(hits) <> 'array'::text) OR (jsonb_array_length(hits) = hit_count))),
    CONSTRAINT recordings_duration_ms_check CHECK ((duration_ms >= 0)),
    CONSTRAINT recordings_hit_count_check CHECK (((hit_count >= 1) AND (hit_count <= 50000))),
    CONSTRAINT recordings_hits_check CHECK ((jsonb_typeof(hits) = 'array'::text)),
    CONSTRAINT recordings_input_source_check CHECK (((input_source)::text = ANY ((ARRAY['KEYBOARD'::character varying, 'STICK'::character varying])::text[]))),
    CONSTRAINT recordings_midi_key_check CHECK ((btrim((midi_key)::text) <> ''::text)),
    CONSTRAINT recordings_mode_check CHECK (((mode)::text = ANY ((ARRAY['RHYTHM'::character varying, 'FREE'::character varying, 'TEMPO'::character varying, 'SHEET'::character varying])::text[]))),
    CONSTRAINT recordings_payload_hash_check CHECK (((payload_hash)::text ~ '^[0-9a-f]{64}$'::text)),
    CONSTRAINT recordings_schema_version_check CHECK ((schema_version > 0)),
    CONSTRAINT recordings_title_check CHECK ((btrim((title)::text) <> ''::text))
);


--
-- Name: recordings_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.recordings ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.recordings_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: reports; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.reports (
    id bigint NOT NULL,
    play_session_id uuid NOT NULL,
    timing_histogram jsonb NOT NULL,
    pad_stats jsonb NOT NULL,
    weak_segments jsonb,
    recommended_drills jsonb,
    coach_text text,
    generator_version character varying(50) NOT NULL,
    generated_at timestamp with time zone DEFAULT now() NOT NULL,
    analysis_status character varying(20) DEFAULT 'NOT_REQUESTED'::character varying NOT NULL,
    analysis_attempt_count integer DEFAULT 0 NOT NULL,
    analysis_lease_token uuid,
    analysis_lease_until timestamp with time zone,
    analysis_next_attempt_at timestamp with time zone,
    coach_summary jsonb,
    CONSTRAINT ck_report_analysis_lease CHECK (((analysis_lease_token IS NULL) = (analysis_lease_until IS NULL))),
    CONSTRAINT ck_reports_analysis_status CHECK (((analysis_status)::text = ANY ((ARRAY['NOT_REQUESTED'::character varying, 'PENDING'::character varying, 'DONE'::character varying, 'FAILED'::character varying])::text[]))),
    CONSTRAINT reports_analysis_attempt_count_check CHECK (((analysis_attempt_count >= 0) AND (analysis_attempt_count <= 2))),
    CONSTRAINT reports_coach_summary_check CHECK (((coach_summary IS NULL) OR (jsonb_typeof(coach_summary) = 'object'::text))),
    CONSTRAINT reports_generator_version_check CHECK ((btrim((generator_version)::text) <> ''::text)),
    CONSTRAINT reports_pad_stats_check CHECK ((jsonb_typeof(pad_stats) = ANY (ARRAY['object'::text, 'array'::text]))),
    CONSTRAINT reports_recommended_drills_check CHECK ((jsonb_typeof(recommended_drills) = 'array'::text)),
    CONSTRAINT reports_timing_histogram_check CHECK ((jsonb_typeof(timing_histogram) = ANY (ARRAY['object'::text, 'array'::text]))),
    CONSTRAINT reports_weak_segments_check CHECK ((jsonb_typeof(weak_segments) = 'array'::text))
);


--
-- Name: COLUMN reports.analysis_status; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.reports.analysis_status IS 'AI 분석 상태: NOT_REQUESTED / PENDING / DONE / FAILED';


--
-- Name: reports_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.reports ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.reports_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: sheet_music; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sheet_music (
    id bigint NOT NULL,
    owner_id bigint NOT NULL,
    title character varying(100) NOT NULL,
    source character varying(10) NOT NULL,
    kind character varying(5) NOT NULL,
    page_count integer NOT NULL,
    total_bytes bigint NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone,
    song_id bigint,
    CONSTRAINT sheet_music_check CHECK ((((kind)::text = 'IMAGE'::text) OR (page_count = 1))),
    CONSTRAINT sheet_music_kind_check CHECK (((kind)::text = ANY ((ARRAY['IMAGE'::character varying, 'PDF'::character varying])::text[]))),
    CONSTRAINT sheet_music_page_count_check CHECK (((page_count >= 1) AND (page_count <= 20))),
    CONSTRAINT sheet_music_source_check CHECK (((source)::text = ANY ((ARRAY['RENDERED'::character varying, 'UPLOADED'::character varying])::text[]))),
    CONSTRAINT sheet_music_title_check CHECK ((btrim((title)::text) <> ''::text)),
    CONSTRAINT sheet_music_total_bytes_check CHECK ((total_bytes >= 0))
);


--
-- Name: sheet_music_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.sheet_music ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.sheet_music_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: sheet_music_pages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sheet_music_pages (
    sheet_id bigint NOT NULL,
    page_no integer NOT NULL,
    object_key character varying(300) NOT NULL,
    content_type character varying(30) NOT NULL,
    bytes bigint NOT NULL,
    width integer,
    height integer,
    CONSTRAINT sheet_music_pages_bytes_check CHECK ((bytes > 0)),
    CONSTRAINT sheet_music_pages_content_type_check CHECK (((content_type)::text = ANY ((ARRAY['image/jpeg'::character varying, 'image/png'::character varying, 'image/webp'::character varying, 'application/pdf'::character varying])::text[]))),
    CONSTRAINT sheet_music_pages_height_check CHECK ((height > 0)),
    CONSTRAINT sheet_music_pages_object_key_check CHECK ((btrim((object_key)::text) <> ''::text)),
    CONSTRAINT sheet_music_pages_page_no_check CHECK (((page_no >= 1) AND (page_no <= 20))),
    CONSTRAINT sheet_music_pages_width_check CHECK ((width > 0))
);


--
-- Name: social_accounts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.social_accounts (
    id bigint NOT NULL,
    user_id bigint NOT NULL,
    provider character varying(20) NOT NULL,
    provider_user_id character varying(255) NOT NULL,
    email character varying(255),
    connected_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE social_accounts; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.social_accounts IS '소셜 로그인 연동. 회원 1명이 여러 제공자를 연결할 수 있다';


--
-- Name: COLUMN social_accounts.provider; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.social_accounts.provider IS '제공자 코드. 1단계는 GOOGLE만. 제공자를 늘릴 때 마이그레이션 없이 값만 추가하도록 CHECK를 두지 않는다';


--
-- Name: COLUMN social_accounts.provider_user_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.social_accounts.provider_user_id IS '제공자 측 사용자 식별자. 구글은 ID 토큰의 sub';


--
-- Name: COLUMN social_accounts.email; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.social_accounts.email IS '제공자 응답 원본. users.email과 별도 보관';


--
-- Name: social_accounts_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.social_accounts ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.social_accounts_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: songs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.songs ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.songs_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: telemetry_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.telemetry_events (
    "time" timestamp with time zone NOT NULL,
    session_id uuid NOT NULL,
    user_id bigint,
    mode character varying(6),
    kind character varying(8) NOT NULL,
    stick_id smallint,
    pad character varying(16),
    baseline_pad character varying(16),
    predicted_pad character varying(16),
    judgement character varying(7),
    delta_ms double precision,
    velocity smallint,
    t_sensor bigint,
    t_recv double precision,
    t_judge double precision,
    t_audio double precision,
    clock_offset_ms double precision,
    packet_loss real,
    battery_pct smallint,
    tags jsonb,
    CONSTRAINT ck_telemetry_events_clock_offset_ms CHECK (((clock_offset_ms > '-Infinity'::double precision) AND (clock_offset_ms < 'Infinity'::double precision))),
    CONSTRAINT telemetry_events_battery_pct_check CHECK (((battery_pct >= 0) AND (battery_pct <= 100))),
    CONSTRAINT telemetry_events_delta_ms_check CHECK (((delta_ms > '-Infinity'::double precision) AND (delta_ms < 'Infinity'::double precision))),
    CONSTRAINT telemetry_events_judgement_check CHECK (((judgement)::text = ANY ((ARRAY['PERFECT'::character varying, 'GOOD'::character varying, 'MISS'::character varying])::text[]))),
    CONSTRAINT telemetry_events_kind_check CHECK (((kind)::text = ANY ((ARRAY['HIT'::character varying, 'STATUS'::character varying])::text[]))),
    CONSTRAINT telemetry_events_mode_check CHECK (((mode)::text = ANY ((ARRAY['RHYTHM'::character varying, 'FREE'::character varying, 'TEMPO'::character varying, 'SHEET'::character varying])::text[]))),
    CONSTRAINT telemetry_events_packet_loss_check CHECK (((packet_loss >= (0)::double precision) AND (packet_loss < 'Infinity'::real))),
    CONSTRAINT telemetry_events_stick_id_check CHECK ((stick_id = ANY (ARRAY[0, 1]))),
    CONSTRAINT telemetry_events_t_audio_check CHECK (((t_audio > '-Infinity'::double precision) AND (t_audio < 'Infinity'::double precision))),
    CONSTRAINT telemetry_events_t_judge_check CHECK (((t_judge > '-Infinity'::double precision) AND (t_judge < 'Infinity'::double precision))),
    CONSTRAINT telemetry_events_t_recv_check CHECK (((t_recv > '-Infinity'::double precision) AND (t_recv < 'Infinity'::double precision))),
    CONSTRAINT telemetry_events_t_sensor_check CHECK ((t_sensor >= 0)),
    CONSTRAINT telemetry_events_tags_check CHECK ((jsonb_typeof(tags) = 'object'::text)),
    CONSTRAINT telemetry_events_velocity_check CHECK (((velocity >= 0) AND (velocity <= 127)))
);


--
-- Name: telemetry_session_conditions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.telemetry_session_conditions (
    user_id bigint NOT NULL,
    session_id uuid NOT NULL,
    firmware_0 character varying(64),
    firmware_1 character varying(64),
    dongle_firmware character varying(64),
    link_mask smallint,
    haptic_enable boolean,
    sensor_mount character varying(16),
    app_build character varying(64),
    note character varying(200),
    received_at timestamp with time zone NOT NULL,
    CONSTRAINT telemetry_session_conditions_link_mask_check CHECK (((link_mask >= 0) AND (link_mask <= 15))),
    CONSTRAINT telemetry_session_conditions_sensor_mount_check CHECK (((sensor_mount)::text = ANY ((ARRAY['GRIP_FRONT'::character varying, 'BENCH'::character varying])::text[])))
);


--
-- Name: user_recommendation_consent_history; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_recommendation_consent_history (
    id bigint NOT NULL,
    user_id bigint NOT NULL,
    agreed boolean NOT NULL,
    version character varying(50) NOT NULL,
    recorded_at timestamp with time zone NOT NULL,
    CONSTRAINT user_recommendation_consent_history_version_check CHECK ((btrim((version)::text) <> ''::text))
);


--
-- Name: user_recommendation_consent_history_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.user_recommendation_consent_history ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.user_recommendation_consent_history_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: users_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.users ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.users_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: audio_uploads audio_uploads_object_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audio_uploads
    ADD CONSTRAINT audio_uploads_object_key_key UNIQUE (object_key);


--
-- Name: audio_uploads audio_uploads_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audio_uploads
    ADD CONSTRAINT audio_uploads_pkey PRIMARY KEY (id);


--
-- Name: chart_features chart_features_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chart_features
    ADD CONSTRAINT chart_features_pkey PRIMARY KEY (chart_version_id);


--
-- Name: chart_job_attempts chart_job_attempts_job_id_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chart_job_attempts
    ADD CONSTRAINT chart_job_attempts_job_id_id_key UNIQUE (job_id, id);


--
-- Name: chart_job_attempts chart_job_attempts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chart_job_attempts
    ADD CONSTRAINT chart_job_attempts_pkey PRIMARY KEY (id);


--
-- Name: chart_job_attempts chart_job_attempts_worker_id_claim_request_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chart_job_attempts
    ADD CONSTRAINT chart_job_attempts_worker_id_claim_request_id_key UNIQUE (worker_id, claim_request_id);


--
-- Name: chart_job_results chart_job_results_job_id_stage_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chart_job_results
    ADD CONSTRAINT chart_job_results_job_id_stage_key UNIQUE (job_id, stage);


--
-- Name: chart_job_results chart_job_results_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chart_job_results
    ADD CONSTRAINT chart_job_results_pkey PRIMARY KEY (result_id);


--
-- Name: chart_jobs chart_jobs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chart_jobs
    ADD CONSTRAINT chart_jobs_pkey PRIMARY KEY (id);


--
-- Name: chart_jobs chart_jobs_user_id_idempotency_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chart_jobs
    ADD CONSTRAINT chart_jobs_user_id_idempotency_key_key UNIQUE (user_id, idempotency_key);


--
-- Name: chart_versions chart_versions_chart_id_version_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chart_versions
    ADD CONSTRAINT chart_versions_chart_id_version_key UNIQUE (chart_id, version);


--
-- Name: chart_versions chart_versions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chart_versions
    ADD CONSTRAINT chart_versions_pkey PRIMARY KEY (id);


--
-- Name: chart_worker_files chart_worker_files_object_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chart_worker_files
    ADD CONSTRAINT chart_worker_files_object_key_key UNIQUE (object_key);


--
-- Name: chart_worker_files chart_worker_files_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chart_worker_files
    ADD CONSTRAINT chart_worker_files_pkey PRIMARY KEY (id);


--
-- Name: chart_worker_presence chart_worker_presence_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chart_worker_presence
    ADD CONSTRAINT chart_worker_presence_pkey PRIMARY KEY (worker_id);


--
-- Name: charts charts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.charts
    ADD CONSTRAINT charts_pkey PRIMARY KEY (id);


--
-- Name: charts charts_song_id_difficulty_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.charts
    ADD CONSTRAINT charts_song_id_difficulty_key UNIQUE (song_id, difficulty);


--
-- Name: coach_narrative_jobs coach_narrative_jobs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.coach_narrative_jobs
    ADD CONSTRAINT coach_narrative_jobs_pkey PRIMARY KEY (id);


--
-- Name: coach_narrative_jobs coach_narrative_jobs_report_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.coach_narrative_jobs
    ADD CONSTRAINT coach_narrative_jobs_report_id_key UNIQUE (report_id);


--
-- Name: file_cleanup_tasks file_cleanup_tasks_object_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.file_cleanup_tasks
    ADD CONSTRAINT file_cleanup_tasks_object_key_key UNIQUE (object_key);


--
-- Name: file_cleanup_tasks file_cleanup_tasks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.file_cleanup_tasks
    ADD CONSTRAINT file_cleanup_tasks_pkey PRIMARY KEY (id);


--
-- Name: flyway_schema_history flyway_schema_history_pk; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.flyway_schema_history
    ADD CONSTRAINT flyway_schema_history_pk PRIMARY KEY (installed_rank);


--
-- Name: hits hits_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hits
    ADD CONSTRAINT hits_pkey PRIMARY KEY (id);


--
-- Name: hits hits_play_session_id_seq_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hits
    ADD CONSTRAINT hits_play_session_id_seq_key UNIQUE (play_session_id, seq);


--
-- Name: kit_presets kit_presets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.kit_presets
    ADD CONSTRAINT kit_presets_pkey PRIMARY KEY (id);


--
-- Name: kit_presets kit_presets_user_id_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.kit_presets
    ADD CONSTRAINT kit_presets_user_id_name_key UNIQUE (user_id, name);


--
-- Name: lesson_completions lesson_completions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lesson_completions
    ADD CONSTRAINT lesson_completions_pkey PRIMARY KEY (user_id, song_id);


--
-- Name: lessons lessons_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lessons
    ADD CONSTRAINT lessons_pkey PRIMARY KEY (song_id);


--
-- Name: live_coach_jobs live_coach_jobs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.live_coach_jobs
    ADD CONSTRAINT live_coach_jobs_pkey PRIMARY KEY (id);


--
-- Name: live_coach_jobs live_coach_jobs_public_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.live_coach_jobs
    ADD CONSTRAINT live_coach_jobs_public_id_key UNIQUE (public_id);


--
-- Name: midi_accompaniment_attempts midi_accompaniment_attempts_job_id_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.midi_accompaniment_attempts
    ADD CONSTRAINT midi_accompaniment_attempts_job_id_id_key UNIQUE (job_id, id);


--
-- Name: midi_accompaniment_attempts midi_accompaniment_attempts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.midi_accompaniment_attempts
    ADD CONSTRAINT midi_accompaniment_attempts_pkey PRIMARY KEY (id);


--
-- Name: midi_accompaniment_jobs midi_accompaniment_jobs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.midi_accompaniment_jobs
    ADD CONSTRAINT midi_accompaniment_jobs_pkey PRIMARY KEY (id);


--
-- Name: midi_original_uploads midi_original_uploads_object_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.midi_original_uploads
    ADD CONSTRAINT midi_original_uploads_object_key_key UNIQUE (object_key);


--
-- Name: midi_original_uploads midi_original_uploads_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.midi_original_uploads
    ADD CONSTRAINT midi_original_uploads_pkey PRIMARY KEY (id);


--
-- Name: midi_original_uploads midi_original_uploads_reserved_song_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.midi_original_uploads
    ADD CONSTRAINT midi_original_uploads_reserved_song_id_key UNIQUE (reserved_song_id);


--
-- Name: midi_original_uploads midi_original_uploads_song_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.midi_original_uploads
    ADD CONSTRAINT midi_original_uploads_song_id_key UNIQUE (song_id);


--
-- Name: social_accounts pk_social_accounts; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.social_accounts
    ADD CONSTRAINT pk_social_accounts PRIMARY KEY (id);


--
-- Name: users pk_users; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT pk_users PRIMARY KEY (id);


--
-- Name: play_raw_uploads play_raw_uploads_object_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.play_raw_uploads
    ADD CONSTRAINT play_raw_uploads_object_key_key UNIQUE (object_key);


--
-- Name: play_raw_uploads play_raw_uploads_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.play_raw_uploads
    ADD CONSTRAINT play_raw_uploads_pkey PRIMARY KEY (id);


--
-- Name: play_sessions play_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.play_sessions
    ADD CONSTRAINT play_sessions_pkey PRIMARY KEY (id);


--
-- Name: recommendation_candidates recommendation_candidates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.recommendation_candidates
    ADD CONSTRAINT recommendation_candidates_pkey PRIMARY KEY (user_id, rank);


--
-- Name: recommendation_candidates recommendation_candidates_user_id_song_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.recommendation_candidates
    ADD CONSTRAINT recommendation_candidates_user_id_song_id_key UNIQUE (user_id, song_id);


--
-- Name: recommendation_items recommendation_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.recommendation_items
    ADD CONSTRAINT recommendation_items_pkey PRIMARY KEY (request_id, rank);


--
-- Name: recommendation_user_keys recommendation_user_keys_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.recommendation_user_keys
    ADD CONSTRAINT recommendation_user_keys_pkey PRIMARY KEY (user_id);


--
-- Name: recommendation_user_keys recommendation_user_keys_user_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.recommendation_user_keys
    ADD CONSTRAINT recommendation_user_keys_user_key_key UNIQUE (user_key);


--
-- Name: recordings recordings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.recordings
    ADD CONSTRAINT recordings_pkey PRIMARY KEY (id);


--
-- Name: recordings recordings_play_session_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.recordings
    ADD CONSTRAINT recordings_play_session_id_key UNIQUE (play_session_id);


--
-- Name: reports reports_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reports
    ADD CONSTRAINT reports_pkey PRIMARY KEY (id);


--
-- Name: reports reports_play_session_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reports
    ADD CONSTRAINT reports_play_session_id_key UNIQUE (play_session_id);


--
-- Name: sheet_music_pages sheet_music_pages_object_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sheet_music_pages
    ADD CONSTRAINT sheet_music_pages_object_key_key UNIQUE (object_key);


--
-- Name: sheet_music_pages sheet_music_pages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sheet_music_pages
    ADD CONSTRAINT sheet_music_pages_pkey PRIMARY KEY (sheet_id, page_no);


--
-- Name: sheet_music sheet_music_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sheet_music
    ADD CONSTRAINT sheet_music_pkey PRIMARY KEY (id);


--
-- Name: song_metadata song_metadata_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.song_metadata
    ADD CONSTRAINT song_metadata_pkey PRIMARY KEY (song_id);


--
-- Name: songs songs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.songs
    ADD CONSTRAINT songs_pkey PRIMARY KEY (id);


--
-- Name: telemetry_session_conditions telemetry_session_conditions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.telemetry_session_conditions
    ADD CONSTRAINT telemetry_session_conditions_pkey PRIMARY KEY (user_id, session_id);


--
-- Name: lessons uq_lessons_course_position; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lessons
    ADD CONSTRAINT uq_lessons_course_position UNIQUE (course, "position");


--
-- Name: social_accounts uq_social_accounts_provider_user; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.social_accounts
    ADD CONSTRAINT uq_social_accounts_provider_user UNIQUE (provider, provider_user_id);


--
-- Name: user_recommendation_consent_history user_recommendation_consent_history_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_recommendation_consent_history
    ADD CONSTRAINT user_recommendation_consent_history_pkey PRIMARY KEY (id);


--
-- Name: user_recommendation_consent user_recommendation_consent_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_recommendation_consent
    ADD CONSTRAINT user_recommendation_consent_pkey PRIMARY KEY (user_id);


--
-- Name: audio_uploads_expiry_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX audio_uploads_expiry_idx ON public.audio_uploads USING btree (expires_at, id) WHERE ((status)::text = 'UPLOADING'::text);


--
-- Name: audio_uploads_job_accepted_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX audio_uploads_job_accepted_idx ON public.audio_uploads USING btree (job_id) WHERE ((status)::text = 'ACCEPTED'::text);


--
-- Name: chart_job_attempts_lease_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX chart_job_attempts_lease_idx ON public.chart_job_attempts USING btree (lease_expires_at) WHERE (finished_at IS NULL);


--
-- Name: chart_jobs_deadline_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX chart_jobs_deadline_idx ON public.chart_jobs USING btree (stage_deadline_at) WHERE ((status)::text = ANY ((ARRAY['SEPARATING'::character varying, 'TRANSCRIBING'::character varying])::text[]));


--
-- Name: chart_jobs_queue_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX chart_jobs_queue_idx ON public.chart_jobs USING btree (next_attempt_at, id) WHERE ((status)::text = 'QUEUED'::text);


--
-- Name: chart_jobs_song_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX chart_jobs_song_idx ON public.chart_jobs USING btree (song_id);


--
-- Name: chart_jobs_user_active_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX chart_jobs_user_active_idx ON public.chart_jobs USING btree (user_id) WHERE ((status)::text = ANY ((ARRAY['QUEUED'::character varying, 'SEPARATING'::character varying, 'TRANSCRIBING'::character varying])::text[]));


--
-- Name: chart_worker_files_attempt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX chart_worker_files_attempt_idx ON public.chart_worker_files USING btree (job_id, attempt_id);


--
-- Name: chart_worker_files_staging_role_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX chart_worker_files_staging_role_idx ON public.chart_worker_files USING btree (attempt_id, role) WHERE ((role)::text = ANY ((ARRAY['STAGING_DRUM'::character varying, 'STAGING_ACCOMPANIMENT'::character varying])::text[]));


--
-- Name: file_cleanup_raw_recheck_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX file_cleanup_raw_recheck_idx ON public.file_cleanup_tasks USING btree (next_attempt_at, id) WHERE (((file_role)::text = 'RAW_LOG'::text) AND ((status)::text = 'DELETED'::text));


--
-- Name: file_cleanup_source_recheck_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX file_cleanup_source_recheck_idx ON public.file_cleanup_tasks USING btree (next_attempt_at, id) WHERE (((file_role)::text = 'SOURCE'::text) AND ((status)::text = 'DELETED'::text));


--
-- Name: file_cleanup_tasks_job_attempt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX file_cleanup_tasks_job_attempt_idx ON public.file_cleanup_tasks USING btree (job_id, attempt_id);


--
-- Name: file_cleanup_tasks_retry_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX file_cleanup_tasks_retry_idx ON public.file_cleanup_tasks USING btree (next_attempt_at, id) WHERE ((status)::text = ANY ((ARRAY['PENDING'::character varying, 'FAILED'::character varying, 'DELETING'::character varying])::text[]));


--
-- Name: file_cleanup_tasks_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX file_cleanup_tasks_user_idx ON public.file_cleanup_tasks USING btree (user_id);


--
-- Name: flyway_schema_history_s_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX flyway_schema_history_s_idx ON public.flyway_schema_history USING btree (success);


--
-- Name: hits_session_note_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX hits_session_note_idx ON public.hits USING btree (play_session_id, matched_note_id) WHERE (matched_note_id IS NOT NULL);


--
-- Name: idx_coach_narrative_jobs_queue; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_coach_narrative_jobs_queue ON public.coach_narrative_jobs USING btree (status, id);


--
-- Name: idx_live_coach_jobs_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_live_coach_jobs_created ON public.live_coach_jobs USING btree (created_at);


--
-- Name: idx_live_coach_jobs_queue; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_live_coach_jobs_queue ON public.live_coach_jobs USING btree (status, id);


--
-- Name: idx_live_coach_jobs_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_live_coach_jobs_user ON public.live_coach_jobs USING btree (user_id, created_at);


--
-- Name: ix_social_accounts_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_social_accounts_user_id ON public.social_accounts USING btree (user_id);


--
-- Name: kit_presets_user_default_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX kit_presets_user_default_idx ON public.kit_presets USING btree (user_id) WHERE is_default;


--
-- Name: midi_jobs_active_song_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX midi_jobs_active_song_idx ON public.midi_accompaniment_jobs USING btree (song_id) WHERE ((status)::text = ANY ((ARRAY['QUEUED'::character varying, 'RUNNING'::character varying])::text[]));


--
-- Name: midi_jobs_queue_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX midi_jobs_queue_idx ON public.midi_accompaniment_jobs USING btree (next_attempt_at, id) WHERE ((status)::text = 'QUEUED'::text);


--
-- Name: midi_jobs_song_latest_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX midi_jobs_song_latest_idx ON public.midi_accompaniment_jobs USING btree (song_id, id DESC);


--
-- Name: midi_original_receiving_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX midi_original_receiving_idx ON public.midi_original_uploads USING btree (expires_at) WHERE ((status)::text = 'RECEIVING'::text);


--
-- Name: play_raw_expiry_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX play_raw_expiry_idx ON public.play_raw_uploads USING btree (expires_at, id) WHERE ((status)::text = 'UPLOADING'::text);


--
-- Name: play_raw_one_accepted_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX play_raw_one_accepted_idx ON public.play_raw_uploads USING btree (play_session_id) WHERE (((status)::text = 'ACCEPTED'::text) AND (play_session_id IS NOT NULL));


--
-- Name: play_raw_orphan_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX play_raw_orphan_idx ON public.play_raw_uploads USING btree (id) WHERE ((play_session_id IS NULL) AND ((status)::text <> 'RETIRED'::text));


--
-- Name: play_raw_session_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX play_raw_session_idx ON public.play_raw_uploads USING btree (play_session_id);


--
-- Name: play_sessions_chart_version_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX play_sessions_chart_version_idx ON public.play_sessions USING btree (chart_version_id);


--
-- Name: play_sessions_kit_preset_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX play_sessions_kit_preset_idx ON public.play_sessions USING btree (kit_preset_id);


--
-- Name: play_sessions_song_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX play_sessions_song_idx ON public.play_sessions USING btree (song_id);


--
-- Name: play_sessions_user_ended_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX play_sessions_user_ended_idx ON public.play_sessions USING btree (user_id, ended_at DESC);


--
-- Name: play_sessions_user_song_ended_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX play_sessions_user_song_ended_idx ON public.play_sessions USING btree (user_id, song_id, ended_at DESC);


--
-- Name: recommendation_candidates_song_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX recommendation_candidates_song_idx ON public.recommendation_candidates USING btree (song_id);


--
-- Name: recommendation_items_shown_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX recommendation_items_shown_idx ON public.recommendation_items USING btree (shown_at);


--
-- Name: recommendation_items_user_shown_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX recommendation_items_user_shown_idx ON public.recommendation_items USING btree (user_id, shown_at DESC);


--
-- Name: recordings_user_client_key_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX recordings_user_client_key_idx ON public.recordings USING btree (user_id, client_key) WHERE (deleted_at IS NULL);


--
-- Name: recordings_user_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX recordings_user_created_idx ON public.recordings USING btree (user_id, created_at DESC);


--
-- Name: reports_analysis_pending_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX reports_analysis_pending_idx ON public.reports USING btree (analysis_next_attempt_at, id) WHERE ((analysis_status)::text = 'PENDING'::text);


--
-- Name: sheet_music_owner_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX sheet_music_owner_idx ON public.sheet_music USING btree (owner_id, created_at DESC, id DESC) WHERE (deleted_at IS NULL);


--
-- Name: sheet_music_song_live_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX sheet_music_song_live_idx ON public.sheet_music USING btree (song_id) WHERE ((deleted_at IS NULL) AND (song_id IS NOT NULL));


--
-- Name: songs_cover_key_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX songs_cover_key_idx ON public.songs USING btree (cover_key) WHERE (cover_key IS NOT NULL);


--
-- Name: songs_owner_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX songs_owner_created_at_idx ON public.songs USING btree (owner_id, created_at DESC);


--
-- Name: telemetry_events_session_time_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX telemetry_events_session_time_idx ON public.telemetry_events USING btree (session_id, "time");


--
-- Name: telemetry_events_time_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX telemetry_events_time_idx ON public.telemetry_events USING btree ("time");


--
-- Name: user_recommendation_consent_history_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX user_recommendation_consent_history_user_idx ON public.user_recommendation_consent_history USING btree (user_id, recorded_at);


--
-- Name: audio_uploads audio_uploads_job_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audio_uploads
    ADD CONSTRAINT audio_uploads_job_id_fkey FOREIGN KEY (job_id) REFERENCES public.chart_jobs(id);


--
-- Name: audio_uploads audio_uploads_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audio_uploads
    ADD CONSTRAINT audio_uploads_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: chart_features chart_features_chart_version_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chart_features
    ADD CONSTRAINT chart_features_chart_version_id_fkey FOREIGN KEY (chart_version_id) REFERENCES public.chart_versions(id) ON DELETE CASCADE;


--
-- Name: chart_job_attempts chart_job_attempts_job_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chart_job_attempts
    ADD CONSTRAINT chart_job_attempts_job_id_fkey FOREIGN KEY (job_id) REFERENCES public.chart_jobs(id);


--
-- Name: chart_job_results chart_job_results_job_id_attempt_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chart_job_results
    ADD CONSTRAINT chart_job_results_job_id_attempt_id_fkey FOREIGN KEY (job_id, attempt_id) REFERENCES public.chart_job_attempts(job_id, id);


--
-- Name: chart_job_results chart_job_results_job_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chart_job_results
    ADD CONSTRAINT chart_job_results_job_id_fkey FOREIGN KEY (job_id) REFERENCES public.chart_jobs(id);


--
-- Name: chart_jobs chart_jobs_current_attempt_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chart_jobs
    ADD CONSTRAINT chart_jobs_current_attempt_fk FOREIGN KEY (id, current_attempt_id) REFERENCES public.chart_job_attempts(job_id, id);


--
-- Name: chart_jobs chart_jobs_song_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chart_jobs
    ADD CONSTRAINT chart_jobs_song_id_fkey FOREIGN KEY (song_id) REFERENCES public.songs(id);


--
-- Name: chart_jobs chart_jobs_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chart_jobs
    ADD CONSTRAINT chart_jobs_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: chart_versions chart_versions_chart_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chart_versions
    ADD CONSTRAINT chart_versions_chart_id_fkey FOREIGN KEY (chart_id) REFERENCES public.charts(id) ON DELETE RESTRICT;


--
-- Name: chart_worker_files chart_worker_files_job_id_attempt_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chart_worker_files
    ADD CONSTRAINT chart_worker_files_job_id_attempt_id_fkey FOREIGN KEY (job_id, attempt_id) REFERENCES public.chart_job_attempts(job_id, id);


--
-- Name: chart_worker_files chart_worker_files_job_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chart_worker_files
    ADD CONSTRAINT chart_worker_files_job_id_fkey FOREIGN KEY (job_id) REFERENCES public.chart_jobs(id);


--
-- Name: charts charts_song_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.charts
    ADD CONSTRAINT charts_song_id_fkey FOREIGN KEY (song_id) REFERENCES public.songs(id) ON DELETE RESTRICT;


--
-- Name: coach_narrative_jobs coach_narrative_jobs_report_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.coach_narrative_jobs
    ADD CONSTRAINT coach_narrative_jobs_report_id_fkey FOREIGN KEY (report_id) REFERENCES public.reports(id) ON DELETE CASCADE;


--
-- Name: file_cleanup_tasks file_cleanup_midi_attempt_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.file_cleanup_tasks
    ADD CONSTRAINT file_cleanup_midi_attempt_fk FOREIGN KEY (midi_job_id, midi_attempt_id) REFERENCES public.midi_accompaniment_attempts(job_id, id);


--
-- Name: file_cleanup_tasks file_cleanup_tasks_job_id_attempt_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.file_cleanup_tasks
    ADD CONSTRAINT file_cleanup_tasks_job_id_attempt_id_fkey FOREIGN KEY (job_id, attempt_id) REFERENCES public.chart_job_attempts(job_id, id);


--
-- Name: file_cleanup_tasks file_cleanup_tasks_job_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.file_cleanup_tasks
    ADD CONSTRAINT file_cleanup_tasks_job_id_fkey FOREIGN KEY (job_id) REFERENCES public.chart_jobs(id);


--
-- Name: file_cleanup_tasks file_cleanup_tasks_midi_job_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.file_cleanup_tasks
    ADD CONSTRAINT file_cleanup_tasks_midi_job_id_fkey FOREIGN KEY (midi_job_id) REFERENCES public.midi_accompaniment_jobs(id);


--
-- Name: file_cleanup_tasks file_cleanup_tasks_midi_original_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.file_cleanup_tasks
    ADD CONSTRAINT file_cleanup_tasks_midi_original_id_fkey FOREIGN KEY (midi_original_id) REFERENCES public.midi_original_uploads(id);


--
-- Name: file_cleanup_tasks file_cleanup_tasks_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.file_cleanup_tasks
    ADD CONSTRAINT file_cleanup_tasks_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: social_accounts fk_social_accounts_user_id; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.social_accounts
    ADD CONSTRAINT fk_social_accounts_user_id FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: hits hits_play_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hits
    ADD CONSTRAINT hits_play_session_id_fkey FOREIGN KEY (play_session_id) REFERENCES public.play_sessions(id) ON DELETE CASCADE;


--
-- Name: kit_presets kit_presets_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.kit_presets
    ADD CONSTRAINT kit_presets_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: lesson_completions lesson_completions_song_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lesson_completions
    ADD CONSTRAINT lesson_completions_song_id_fkey FOREIGN KEY (song_id) REFERENCES public.songs(id) ON DELETE CASCADE;


--
-- Name: lesson_completions lesson_completions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lesson_completions
    ADD CONSTRAINT lesson_completions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: lessons lessons_song_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lessons
    ADD CONSTRAINT lessons_song_id_fkey FOREIGN KEY (song_id) REFERENCES public.songs(id) ON DELETE CASCADE;


--
-- Name: live_coach_jobs live_coach_jobs_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.live_coach_jobs
    ADD CONSTRAINT live_coach_jobs_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: midi_accompaniment_attempts midi_accompaniment_attempts_job_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.midi_accompaniment_attempts
    ADD CONSTRAINT midi_accompaniment_attempts_job_id_fkey FOREIGN KEY (job_id) REFERENCES public.midi_accompaniment_jobs(id);


--
-- Name: midi_accompaniment_jobs midi_accompaniment_jobs_original_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.midi_accompaniment_jobs
    ADD CONSTRAINT midi_accompaniment_jobs_original_id_fkey FOREIGN KEY (original_id) REFERENCES public.midi_original_uploads(id);


--
-- Name: midi_accompaniment_jobs midi_accompaniment_jobs_song_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.midi_accompaniment_jobs
    ADD CONSTRAINT midi_accompaniment_jobs_song_id_fkey FOREIGN KEY (song_id) REFERENCES public.songs(id);


--
-- Name: midi_accompaniment_jobs midi_accompaniment_jobs_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.midi_accompaniment_jobs
    ADD CONSTRAINT midi_accompaniment_jobs_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: midi_original_uploads midi_original_uploads_song_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.midi_original_uploads
    ADD CONSTRAINT midi_original_uploads_song_id_fkey FOREIGN KEY (song_id) REFERENCES public.songs(id);


--
-- Name: midi_original_uploads midi_original_uploads_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.midi_original_uploads
    ADD CONSTRAINT midi_original_uploads_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: play_raw_uploads play_raw_uploads_play_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.play_raw_uploads
    ADD CONSTRAINT play_raw_uploads_play_session_id_fkey FOREIGN KEY (play_session_id) REFERENCES public.play_sessions(id) ON DELETE SET NULL;


--
-- Name: play_sessions play_sessions_chart_version_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.play_sessions
    ADD CONSTRAINT play_sessions_chart_version_id_fkey FOREIGN KEY (chart_version_id) REFERENCES public.chart_versions(id);


--
-- Name: play_sessions play_sessions_kit_preset_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.play_sessions
    ADD CONSTRAINT play_sessions_kit_preset_id_fkey FOREIGN KEY (kit_preset_id) REFERENCES public.kit_presets(id) ON DELETE SET NULL;


--
-- Name: play_sessions play_sessions_song_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.play_sessions
    ADD CONSTRAINT play_sessions_song_id_fkey FOREIGN KEY (song_id) REFERENCES public.songs(id);


--
-- Name: play_sessions play_sessions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.play_sessions
    ADD CONSTRAINT play_sessions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: recommendation_candidates recommendation_candidates_song_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.recommendation_candidates
    ADD CONSTRAINT recommendation_candidates_song_id_fkey FOREIGN KEY (song_id) REFERENCES public.songs(id) ON DELETE CASCADE;


--
-- Name: recommendation_candidates recommendation_candidates_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.recommendation_candidates
    ADD CONSTRAINT recommendation_candidates_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: recommendation_items recommendation_items_chart_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.recommendation_items
    ADD CONSTRAINT recommendation_items_chart_id_fkey FOREIGN KEY (chart_id) REFERENCES public.charts(id) ON DELETE CASCADE;


--
-- Name: recommendation_items recommendation_items_song_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.recommendation_items
    ADD CONSTRAINT recommendation_items_song_id_fkey FOREIGN KEY (song_id) REFERENCES public.songs(id) ON DELETE CASCADE;


--
-- Name: recommendation_items recommendation_items_source_song_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.recommendation_items
    ADD CONSTRAINT recommendation_items_source_song_id_fkey FOREIGN KEY (source_song_id) REFERENCES public.songs(id) ON DELETE SET NULL;


--
-- Name: recommendation_items recommendation_items_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.recommendation_items
    ADD CONSTRAINT recommendation_items_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: recommendation_user_keys recommendation_user_keys_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.recommendation_user_keys
    ADD CONSTRAINT recommendation_user_keys_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: recordings recordings_chart_version_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.recordings
    ADD CONSTRAINT recordings_chart_version_id_fkey FOREIGN KEY (chart_version_id) REFERENCES public.chart_versions(id);


--
-- Name: recordings recordings_play_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.recordings
    ADD CONSTRAINT recordings_play_session_id_fkey FOREIGN KEY (play_session_id) REFERENCES public.play_sessions(id) ON DELETE SET NULL;


--
-- Name: recordings recordings_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.recordings
    ADD CONSTRAINT recordings_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: reports reports_play_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reports
    ADD CONSTRAINT reports_play_session_id_fkey FOREIGN KEY (play_session_id) REFERENCES public.play_sessions(id) ON DELETE CASCADE;


--
-- Name: sheet_music sheet_music_owner_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sheet_music
    ADD CONSTRAINT sheet_music_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES public.users(id);


--
-- Name: sheet_music_pages sheet_music_pages_sheet_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sheet_music_pages
    ADD CONSTRAINT sheet_music_pages_sheet_id_fkey FOREIGN KEY (sheet_id) REFERENCES public.sheet_music(id) ON DELETE CASCADE;


--
-- Name: sheet_music sheet_music_song_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sheet_music
    ADD CONSTRAINT sheet_music_song_id_fkey FOREIGN KEY (song_id) REFERENCES public.songs(id);


--
-- Name: song_metadata song_metadata_song_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.song_metadata
    ADD CONSTRAINT song_metadata_song_id_fkey FOREIGN KEY (song_id) REFERENCES public.songs(id) ON DELETE CASCADE;


--
-- Name: songs songs_level_chart_version_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.songs
    ADD CONSTRAINT songs_level_chart_version_id_fkey FOREIGN KEY (level_chart_version_id) REFERENCES public.chart_versions(id) ON DELETE RESTRICT;


--
-- Name: songs songs_owner_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.songs
    ADD CONSTRAINT songs_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES public.users(id);


--
-- Name: user_recommendation_consent_history user_recommendation_consent_history_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_recommendation_consent_history
    ADD CONSTRAINT user_recommendation_consent_history_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: user_recommendation_consent user_recommendation_consent_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_recommendation_consent
    ADD CONSTRAINT user_recommendation_consent_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- PostgreSQL database dump complete
--

\unrestrict dO7E1HXFzXuvuyt07fI6wU8QZPtCUjKJCqfJdXXTSig1H1YTwXFEubp76swLLRG

--
-- PostgreSQL database dump
--

\restrict ITdLiL0r3J2NNV4wG7hiqYrwKAmA3miOKJnLmTQAydmL5o6eUGJVAd9HhGxiRia

-- Dumped from database version 16.15
-- Dumped by pg_dump version 16.15

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Data for Name: flyway_schema_history; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.flyway_schema_history (installed_rank, version, description, type, script, checksum, installed_by, installed_on, execution_time, success) FROM stdin;
1	1	create users social accounts	SQL	V1__create_users_social_accounts.sql	1378667521	app	2026-10-22 07:49:58.122536	54	t
2	2	create songs charts chart versions	SQL	V2__create_songs_charts_chart_versions.sql	32319728	app	2026-10-22 07:49:58.232715	78	t
3	3	create kit presets	SQL	V3__create_kit_presets.sql	-1461775631	app	2026-10-22 07:49:58.342884	29	t
4	4	create chart jobs and cleanup	SQL	V4__create_chart_jobs_and_cleanup.sql	-39725871	app	2026-10-22 07:49:58.391114	141	t
5	5	create play sessions and hits	SQL	V5__create_play_sessions_and_hits.sql	-905477922	app	2026-10-22 07:49:58.562075	71	t
6	6	create reports and recordings	SQL	V6__create_reports_and_recordings.sql	1125417890	app	2026-10-22 07:49:58.65055	46	t
7	7	create telemetry events	SQL	V7__create_telemetry_events.sql	813464099	app	2026-10-22 07:49:58.708283	21	t
8	8	convert telemetry to hypertable	SQL	V8__convert_telemetry_to_hypertable.sql	462014422	app	2026-10-22 07:49:58.741424	19	t
9	9	create play raw uploads	SQL	V9__create_play_raw_uploads.sql	-2019649781	app	2026-10-22 07:49:58.771051	47	t
10	10	seed builtin practice charts	SQL	V10__seed_builtin_practice_charts.sql	-1689822474	app	2026-10-22 07:49:58.831697	19	t
11	11	add kit presets calibration	SQL	V11__add_kit_presets_calibration.sql	-1749995267	app	2026-10-22 07:49:58.868783	4	t
12	12	allow builtin accompaniment	SQL	V12__allow_builtin_accompaniment.sql	-1093873703	app	2026-10-23 02:22:21.166762	18	t
13	13	drop kit presets calibration	SQL	V13__drop_kit_presets_calibration.sql	-1136884323	app	2026-10-27 00:31:33.898355	42	t
14	14	add report analysis status	SQL	V14__add_report_analysis_status.sql	-1289898325	app	2026-10-27 05:59:14.432361	61	t
15	15	create audio uploads	SQL	V15__create_audio_uploads.sql	-1565414714	app	2026-10-28 06:54:16.450076	107	t
16	16	create chart worker files	SQL	V16__create_chart_worker_files.sql	-1523573567	app	2026-10-28 06:54:16.628248	33	t
17	17	widen telemetry pad and clock offset	SQL	V17__widen_telemetry_pad_and_clock_offset.sql	773611533	app	2026-10-28 06:54:16.683514	40	t
18	18	add report analysis dispatch	SQL	V18__add_report_analysis_dispatch.sql	211210042	app	2026-10-28 06:54:16.747768	14	t
19	19	add song cover	SQL	V19__add_song_cover.sql	-1553788398	app	2026-11-02 01:02:17.23945	35	t
20	20	widen hits pad	SQL	V20__widen_hits_pad.sql	-206471366	app	2026-11-02 01:02:17.322145	21	t
21	21	create coach export view	SQL	V21__create_coach_export_view.sql	-1680553694	app	2026-11-02 01:02:17.369062	33	t
22	22	add songs published	SQL	V22__add_songs_published.sql	814289116	app	2026-11-02 01:02:17.448633	7	t
23	23	create sheet music	SQL	V23__create_sheet_music.sql	-2091512461	app	2026-11-02 01:02:17.474456	52	t
24	24	allow mpeg4 and ogg audio	SQL	V24__allow_mpeg4_and_ogg_audio.sql	1038784863	app	2026-11-04 02:08:34.567881	22	t
25	25	add users data consent	SQL	V25__add_users_data_consent.sql	-1763163441	app	2026-11-04 02:08:34.653353	6	t
26	26	add users signup consents	SQL	V26__add_users_signup_consents.sql	-345084840	app	2026-11-04 02:08:34.679115	21	t
27	27	add recording hits	SQL	V27__add_recording_hits.sql	-2071998003	app	2026-11-04 02:08:34.726253	22	t
28	28	add recording chart version	SQL	V28__add_recording_chart_version.sql	-18876280	app	2026-11-04 02:08:34.768953	13	t
29	29	add song level	SQL	V29__add_song_level.sql	1280873917	app	2026-11-04 02:08:34.794079	15	t
30	30	add telemetry retention policy	SQL	V30__add_telemetry_retention_policy.sql	-1729826463	app	2026-11-04 02:08:34.827379	7	t
31	31	midi accompaniment	SQL	V31__midi_accompaniment.sql	-912291007	app	2026-11-04 08:21:53.02862	158	t
32	32	add coach narrative	SQL	V32__add_coach_narrative.sql	-758596773	app	2026-11-04 08:21:53.261918	36	t
33	33	add chart features	SQL	V33__add_chart_features.sql	-1144928106	app	2026-11-05 08:05:22.917359	74	t
34	34	add recommendation items	SQL	V34__add_recommendation_items.sql	1157524357	app	2026-11-05 08:05:23.137455	75	t
35	35	add chart features rhythm grid	SQL	V35__add_chart_features_rhythm_grid.sql	-873845320	app	2026-11-05 08:05:23.26814	11	t
36	36	add recommendation similar	SQL	V36__add_recommendation_similar.sql	1212505314	app	2026-11-05 08:05:23.308848	26	t
37	37	add recommendation r3	SQL	V37__add_recommendation_r3.sql	123643991	app	2026-11-05 08:05:23.375359	83	t
38	38	add song metadata	SQL	V38__add_song_metadata.sql	951212134	app	2026-11-06 08:24:06.240356	60	t
39	39	create telemetry session conditions	SQL	V39__create_telemetry_session_conditions.sql	1242935460	app	2026-11-06 08:24:06.41638	13	t
40	40	add recommendation drill	SQL	V40__add_recommendation_drill.sql	-1435721412	app	2026-11-06 08:24:06.452067	10	t
41	41	exclude withdrawn from coach export	SQL	V41__exclude_withdrawn_from_coach_export.sql	-1028089343	app	2026-11-06 08:24:06.482424	15	t
42	42	recommend interactions consented plays	SQL	V42__recommend_interactions_consented_plays.sql	-1918336640	app	2026-11-06 08:24:06.522848	10	t
43	43	add recommendation consent history	SQL	V43__add_recommendation_consent_history.sql	-1820046839	app	2026-11-06 08:24:06.550664	27	t
44	44	add sheet music song	SQL	V44__add_sheet_music_song.sql	-93463883	app	2026-11-06 08:24:06.591014	13	t
45	45	add recommendation user keys	SQL	V45__add_recommendation_user_keys.sql	-490449592	app	2026-11-06 08:24:06.62627	38	t
46	46	add musicxml source	SQL	V46__add_musicxml_source.sql	-1243111905	app	2026-11-10 08:04:38.672397	41	t
47	47	create live coach jobs	SQL	V47__create_live_coach_jobs.sql	1752987234	app	2026-11-10 08:04:38.763031	56	t
48	48	add lessons	SQL	V48__add_lessons.sql	1078263721	app	2026-11-11 02:10:05.138994	48	t
49	49	add chart job failure reason	SQL	V49__add_chart_job_failure_reason.sql	-25692011	app	2026-11-12 05:05:07.690358	34	t
50	50	add lesson course	SQL	V50__add_lesson_course.sql	19790305	app	2026-11-13 04:00:00.46321	33	t
51	51	create chart worker presence	SQL	V51__create_chart_worker_presence.sql	-1942233187	app	2026-11-15 13:06:00.531081	31	t
52	52	widen live coach sub	SQL	V52__widen_live_coach_sub.sql	1572252286	app	2026-11-17 06:19:24.726309	56	t
\.


--
-- PostgreSQL database dump complete
--

\unrestrict ITdLiL0r3J2NNV4wG7hiqYrwKAmA3miOKJnLmTQAydmL5o6eUGJVAd9HhGxiRia

