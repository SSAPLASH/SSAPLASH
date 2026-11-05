-- 곡 추천 R1: 채보 버전별 특징. 추천 요청마다 노트 JSON을 읽지 않도록 미리 계산해 둔다.
-- 계산 실패·미계산인 채보는 이 테이블에 행이 없고, 추천 후보에서만 빠진다.
CREATE TABLE chart_features (
    chart_version_id bigint PRIMARY KEY REFERENCES chart_versions(id) ON DELETE CASCADE,
    feature_version varchar(30) NOT NULL CHECK (btrim(feature_version) <> ''),
    avg_notes_per_sec numeric(8,3) NOT NULL CHECK (avg_notes_per_sec >= 0),
    peak_notes_2s integer NOT NULL CHECK (peak_notes_2s >= 0),
    pad_ratio jsonb NOT NULL CHECK (jsonb_typeof(pad_ratio) = 'object'),
    transition_ratio jsonb NOT NULL CHECK (jsonb_typeof(transition_ratio) = 'object'),
    created_at timestamptz NOT NULL DEFAULT now()
);
