-- 곡 추천용 공용 곡 메타데이터(255번, 설계 .claude/plans/CHART-001-곡-추천-메타데이터.md).
-- 열·값 목록은 AI 요청 문서 COACH-004(Jira 224)와 같다. 값은 저장소 카탈로그(builtin-songs/catalog.json)의 meta에서
-- 앱 시작 때 넣는다(BuiltinSongSeeder). 이 마이그레이션은 데이터를 넣지 않는다.

CREATE TABLE song_metadata (
    song_id bigint PRIMARY KEY REFERENCES songs(id) ON DELETE CASCADE,
    genre varchar(12) NOT NULL CHECK (genre IN
        ('ROCK','POP','KPOP','BALLAD','JAZZ','FUNK','LATIN','METAL','PUNK','HIPHOP','ELECTRONIC','SOUNDTRACK','PRACTICE','OTHER')),
    sub_genres text[] NOT NULL DEFAULT '{}' CHECK (cardinality(sub_genres) <= 2 AND sub_genres <@ ARRAY
        ['ROCK','POP','KPOP','BALLAD','JAZZ','FUNK','LATIN','METAL','PUNK','HIPHOP','ELECTRONIC','SOUNDTRACK','PRACTICE','OTHER']::text[]),
    mood text[] NOT NULL DEFAULT '{}' CHECK (cardinality(mood) <= 2 AND mood <@ ARRAY
        ['CALM','UPLIFTING','ENERGETIC','DARK','SENTIMENTAL']::text[]),
    energy smallint CHECK (energy BETWEEN 1 AND 5),
    release_year smallint CHECK (release_year BETWEEN 1900 AND 2099),
    language varchar(12) CHECK (language IN ('KO','EN','JA','INSTRUMENTAL','OTHER')),
    drum_style text[] NOT NULL DEFAULT '{}' CHECK (cardinality(drum_style) <= 3 AND drum_style <@ ARRAY
        ['EIGHT_BEAT','SIXTEEN_BEAT','SHUFFLE','HALF_TIME','FOUR_ON_FLOOR','DOUBLE_KICK','SYNCOPATED','FILL_HEAVY','LATIN_PERCUSSION']::text[]),
    source varchar(12) NOT NULL CHECK (source IN ('HUMAN','AUTO','EXTERNAL_DB')),
    source_note varchar(200),
    updated_at timestamptz NOT NULL,
    CONSTRAINT song_metadata_external_note CHECK (source <> 'EXTERNAL_DB' OR (source_note IS NOT NULL AND btrim(source_note) <> ''))
);

-- AI 운영 배치가 읽는 메타데이터 뷰. 열 이름·순서는 AI 로더(schema.FILES["song_meta"])와 같아야 하며,
-- 다른 열이 있으면 배치가 행을 읽지 않고 멈춘다. 여러 값은 ';'로 이은 문자열, 빈 목록은 빈 문자열이다.
-- recommend_songs_v에 있는 곡(공개 공용 곡)만 낸다. 로더가 song_id를 그 뷰의 곡 안에서만 받기 때문이다.
-- 출처(source·source_note)는 내보내지 않는다.
CREATE VIEW recommend_song_meta_v WITH (security_barrier = true) AS
SELECT
    m.song_id,
    m.genre,
    array_to_string(m.sub_genres, ';') AS sub_genres,
    array_to_string(m.mood, ';') AS mood,
    m.energy,
    m.language,
    array_to_string(m.drum_style, ';') AS drum_style,
    m.release_year
FROM song_metadata m
JOIN recommend_songs_v s ON s.song_id = m.song_id;

GRANT SELECT ON recommend_song_meta_v TO recommend_export_reader;
