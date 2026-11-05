-- 곡 추천 R1: 노출·클릭 기록. 가중치 보정과 R3 평가의 근거이며 회원 탈퇴 때 지운다. 보관 90일.
CREATE TABLE recommendation_items (
    request_id uuid NOT NULL,
    rank integer NOT NULL CHECK (rank >= 1),
    user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    context varchar(12) NOT NULL CHECK (context IN ('SONG_PICKER', 'REPORT')),
    strategy varchar(20) NOT NULL CHECK (btrim(strategy) <> ''),
    song_id bigint NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
    chart_id bigint NOT NULL REFERENCES charts(id) ON DELETE CASCADE,
    score numeric(6,4) NOT NULL,
    reason_codes jsonb NOT NULL CHECK (jsonb_typeof(reason_codes) = 'array'),
    shown_at timestamptz NOT NULL DEFAULT now(),
    clicked_at timestamptz,
    PRIMARY KEY (request_id, rank)
);
CREATE INDEX recommendation_items_user_shown_idx ON recommendation_items (user_id, shown_at DESC);
CREATE INDEX recommendation_items_shown_idx ON recommendation_items (shown_at);
