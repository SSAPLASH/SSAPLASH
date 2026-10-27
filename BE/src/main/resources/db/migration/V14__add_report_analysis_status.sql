ALTER TABLE reports
    ADD COLUMN analysis_status varchar(20) NOT NULL DEFAULT 'NOT_REQUESTED',
    ADD CONSTRAINT ck_reports_analysis_status
        CHECK (analysis_status IN ('NOT_REQUESTED', 'PENDING', 'DONE', 'FAILED'));

COMMENT ON COLUMN reports.analysis_status IS 'AI 분석 상태: NOT_REQUESTED / PENDING / DONE / FAILED';
