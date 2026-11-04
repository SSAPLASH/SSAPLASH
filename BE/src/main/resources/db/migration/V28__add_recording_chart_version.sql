-- 257번 녹음 보관함(설계 v0.7). 녹음이 플레이와 별개로 채보 버전을 기억한다. 목록의 곡 정보(song)와 상세 timing이
-- 이 버전에서 나오므로 플레이가 나중에 지워져도 남는다. 자유·박자 녹음과 playId 없이 저장한 녹음은 NULL이다.
-- chart_versions는 지우지 않는 데이터라 삭제 규칙은 기본(NO ACTION)으로 둔다.
ALTER TABLE recordings ADD COLUMN chart_version_id bigint REFERENCES chart_versions(id);

-- V27 때 저장돼 플레이에 연결된 녹음은 그 플레이가 고정한 채보 버전으로 채운다.
UPDATE recordings r SET chart_version_id = p.chart_version_id
FROM play_sessions p
WHERE p.id = r.play_session_id AND p.chart_version_id IS NOT NULL;
