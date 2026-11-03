-- 256번 연주 녹음 저장. V6 recordings는 파일 키 중심이라 타격 시퀀스(시각·패드·세기)를 담을 자리가 없었다.
-- 시퀀스는 FE가 재생·MIDI 변환 때 통째로 받으므로 행 테이블 대신 jsonb 배열 한 컬럼에 둔다(설계 U1).
-- V6 이후 recordings에 행을 쓰는 코드가 없었으므로 기존 행이 없다고 보고 새 컬럼을 NOT NULL로 추가한다.
-- 행이 남아 있으면 이 마이그레이션은 NOT NULL 위반으로 실패한다(조용히 기본값을 채우지 않는다).
-- midi_key·audio_key는 오디오 내보내기(REC-003)용으로 남겨 둔다.
ALTER TABLE recordings
    ADD COLUMN client_key uuid NOT NULL,
    ADD COLUMN mode varchar(6) NOT NULL CHECK (mode IN ('RHYTHM', 'FREE', 'TEMPO', 'SHEET')),
    ADD COLUMN input_source varchar(10) NOT NULL CHECK (input_source IN ('KEYBOARD', 'STICK')),
    ADD COLUMN schema_version integer NOT NULL CHECK (schema_version > 0),
    ADD COLUMN started_at timestamptz NOT NULL,
    ADD COLUMN hit_count integer NOT NULL CHECK (hit_count BETWEEN 1 AND 50000),
    ADD COLUMN hits jsonb NOT NULL CHECK (jsonb_typeof(hits) = 'array'),
    ADD COLUMN payload_hash varchar(64) NOT NULL CHECK (payload_hash ~ '^[0-9a-f]{64}$'),
    ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now(),
    ALTER COLUMN duration_ms SET NOT NULL,
    -- jsonb_typeof 검사가 먼저 실패하도록 배열일 때만 길이를 비교한다.
    ADD CHECK (jsonb_typeof(hits) <> 'array' OR jsonb_array_length(hits) = hit_count);

-- 재전송 판별 키. 지운 녹음의 키로 다시 저장하면 새 녹음이 된다.
CREATE UNIQUE INDEX recordings_user_client_key_idx ON recordings (user_id, client_key) WHERE deleted_at IS NULL;
