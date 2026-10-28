ALTER TABLE reports
    ADD COLUMN analysis_attempt_count integer NOT NULL DEFAULT 0 CHECK (analysis_attempt_count BETWEEN 0 AND 2),
    ADD COLUMN analysis_lease_token uuid,
    ADD COLUMN analysis_lease_until timestamptz,
    ADD COLUMN analysis_next_attempt_at timestamptz,
    ADD CONSTRAINT ck_report_analysis_lease CHECK ((analysis_lease_token IS NULL) = (analysis_lease_until IS NULL));
CREATE INDEX reports_analysis_pending_idx ON reports (analysis_next_attempt_at, id) WHERE analysis_status = 'PENDING';
