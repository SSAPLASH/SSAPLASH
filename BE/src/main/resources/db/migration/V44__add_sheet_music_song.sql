-- 내 악보와 개인 곡 연결(248번, 설계 .claude/plans/CHART-001-악보이미지-보관.md 후속 작업 절). FE 요청 2026-11-06.
-- 10/30 "악보는 곡과 연결하지 않는다"를 바꾼다. song_id가 NULL이면 곡 없는 악보(기존 행 그대로).
-- 곡당 살아 있는 악보는 하나다: 소프트 삭제(deleted_at)된 행은 세지 않아 지우면 자리가 비고, 곡 없는 악보는 제한이 없다.
-- 곡 행은 소프트 삭제라 ON DELETE 동작이 필요 없다. 곡을 지울 때 연결된 악보는 SongManagementService가 같은 트랜잭션에서 소프트 삭제한다.
ALTER TABLE sheet_music ADD COLUMN song_id bigint REFERENCES songs(id);
CREATE UNIQUE INDEX sheet_music_song_live_idx ON sheet_music (song_id) WHERE deleted_at IS NULL AND song_id IS NOT NULL;
