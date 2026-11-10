-- COACH-001 연주 중 LLM 구간 코칭(설계 .claude/plans/COACH-001-연주중-LLM-코칭-설계.md 3.3·3.4절).
-- 연주 중 4·8·16마디 구간이 끝날 때 FE가 구간 사실(facts)을 보내면 GPU 워커가 가져가 안내 칸 문구(title·sub)를 쓴다.
-- 짧게 살다 지워지는 작업이다: 워커 임대 15초·시도 1번, 만들어진 지 5분이 지나면 지운다. 문구는 FE 플레이 로그에만 남는다.
-- facts에는 타격 원본·playId·곡 정보가 없다(FE가 만들고 BE가 모양만 검사한다).
CREATE TABLE live_coach_jobs (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    -- 사용자가 결과를 조회할 때 쓰는 공개 번호. 일련번호를 노출하지 않는다
    public_id uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
    user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    -- FE가 판마다 만드는 임의 번호. 판당 요청 상한에 쓴다(playId가 아니다)
    run_id uuid NOT NULL,
    facts jsonb NOT NULL CHECK (jsonb_typeof(facts) = 'object'),
    status varchar(8) NOT NULL DEFAULT 'QUEUED' CHECK (status IN ('QUEUED', 'RUNNING', 'DONE', 'FAILED')),
    attempt_id uuid,
    worker_id varchar(64),
    claim_request_id uuid,
    lease_expires_at timestamptz,
    title varchar(8),
    sub varchar(16),
    model varchar(37),
    generation_ms integer CHECK (generation_ms IS NULL OR generation_ms >= 0),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CHECK ((status = 'RUNNING') = (attempt_id IS NOT NULL)),
    CHECK ((status = 'DONE') = (title IS NOT NULL))
);

CREATE INDEX idx_live_coach_jobs_queue ON live_coach_jobs (status, id);
CREATE INDEX idx_live_coach_jobs_user ON live_coach_jobs (user_id, created_at);
CREATE INDEX idx_live_coach_jobs_created ON live_coach_jobs (created_at);
