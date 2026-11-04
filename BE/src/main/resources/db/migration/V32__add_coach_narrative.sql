-- COACH-003 후속: 리포트 종합 총평 저장과 LLM 총평 작업 큐 (AI/docs/coach-narrative.md)
-- coach_summary: AI가 약점 분석 응답에 붙이는 summary(level·text·focusPattern·strengthPad·source). 기존 리포트는 NULL.
ALTER TABLE reports ADD COLUMN coach_summary jsonb
    CHECK (coach_summary IS NULL OR jsonb_typeof(coach_summary) = 'object');

-- 규칙 총평을 GPU 서버의 로컬 모델이 쓴 문장으로 덮어쓰는 작업. 리포트 하나에 작업 하나(UNIQUE).
-- 워커가 claim으로 가져가 result로 제출한다. 임대가 끝나면 다시 대기열로 돌아가고 시도는 최대 2번이다.
CREATE TABLE coach_narrative_jobs (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    report_id bigint NOT NULL UNIQUE REFERENCES reports(id) ON DELETE CASCADE,
    status varchar(8) NOT NULL DEFAULT 'QUEUED' CHECK (status IN ('QUEUED', 'RUNNING', 'DONE', 'FAILED')),
    attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count BETWEEN 0 AND 2),
    attempt_id uuid,
    worker_id varchar(64),
    claim_request_id uuid,
    lease_expires_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CHECK ((status = 'RUNNING') = (attempt_id IS NOT NULL))
);

CREATE INDEX idx_coach_narrative_jobs_queue ON coach_narrative_jobs (status, id);
