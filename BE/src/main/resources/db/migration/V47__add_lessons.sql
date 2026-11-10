-- 입문 코스 레슨(331번, 설계 .claude/plans/SETUP-입문-코스.md).
-- lessons: 레슨 순서·종류·설명. 값은 저장소 카탈로그(builtin-songs/catalog.json)의 lesson에서 앱 시작 때 통째로 바꿔 넣는다
-- (BuiltinSongSeeder). 레슨 곡은 공용 곡이고, 이 표에 있으면 곡 목록·추천·비슷한 곡 후보에서 빠진다.
-- lesson_completions: 악보가 흐르지 않는 알아보기(READ) 레슨의 완료 기록. 연주(PLAY) 레슨의 통과는 연주 기록에서 계산한다.

CREATE TABLE lessons (
    song_id bigint PRIMARY KEY REFERENCES songs(id) ON DELETE CASCADE,
    position integer NOT NULL UNIQUE CHECK (position >= 1),
    kind varchar(4) NOT NULL CHECK (kind IN ('READ', 'PLAY')),
    summary text NOT NULL CHECK (char_length(summary) BETWEEN 1 AND 200),
    pads jsonb NOT NULL CHECK (jsonb_typeof(pads) = 'array'),
    guide boolean NOT NULL DEFAULT true,
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE lesson_completions (
    user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    song_id bigint NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
    completed_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, song_id)
);
