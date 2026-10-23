-- 실제 V1·V2가 적용된 비어 있는 전용 테스트 스키마에서만 실행한다.
-- 회원 테이블을 대체하지 않고 V1의 필수 컬럼에 맞춰 테스트 회원을 넣는다.
INSERT INTO users (nickname) VALUES ('채보 검증 회원');

INSERT INTO songs (title, source, license, bpm, offset_ms, time_signature, duration_ms)
VALUES ('공용 곡', 'BUILTIN', 'CC0', 120, 250, '4/4', 60000);
INSERT INTO songs (title, source, owner_id, status, accompaniment_key)
VALUES ('개인 음원', 'AUDIO', 1, 'PROCESSING', 'accompaniment/2.wav');
INSERT INTO songs (title, source, owner_id, offset_ms, duration_ms)
VALUES ('개인 MIDI', 'MIDI', 1, -30, 0);

INSERT INTO charts (song_id, difficulty) VALUES (1, 'EASY'), (2, 'EASY'), (3, 'NORMAL');
INSERT INTO chart_versions (chart_id, version, notes, timing, note_count, generator, notation_status, sheet_pages)
VALUES
    (1, 1,
     '[{"noteId":"n0001","timeMs":250,"pad":"SNARE","notation":{"tick":0,"durationTicks":480,"voice":1}}]',
     '{"bpm":120,"offsetMs":250,"timeSignature":"4/4","ppq":480,"tempoMap":[{"tick":0,"bpm":120}]}',
     1, 'BUILTIN', 'READY', '[{"page":1,"imageKey":"sheet/1/1.png","fromTick":0,"toTick":1920}]'),
    (1, 2,
     '[{"noteId":"n0001","timeMs":500,"pad":"SNARE","notation":{"tick":240,"durationTicks":480,"voice":1}}]',
     '{"bpm":120,"offsetMs":250,"timeSignature":"4/4","ppq":480,"tempoMap":[{"tick":0,"bpm":120}]}',
     1, 'MANUAL', 'READY', '[{"page":1,"imageKey":"sheet/2/1.png","fromTick":0,"toTick":1920}]'),
    (2, 1, '[{"noteId":"n0001","timeMs":250,"pad":"SNARE"}]',
     '{"offsetMs":0}', 1, 'ADT_MODEL', 'PENDING', NULL),
    -- 이미지 없이 악보 JSON만 있는 버전도 DB에 저장 가능하다. 렌더링 가능성 판정은 후속 API 범위다.
    (3, 1,
     '[{"noteId":"n0001","timeMs":0,"pad":"KICK","notation":{"tick":0,"durationTicks":480,"voice":1}}]',
     '{"bpm":120,"offsetMs":0,"timeSignature":"4/4","ppq":480,"tempoMap":[{"tick":0,"bpm":120}]}',
     1, 'MIDI_RULE', 'READY', NULL);

-- 각 문장은 별도 하위 트랜잭션에서 실패해야 하며 실패 종류도 검사한다.
DO $verify$
DECLARE
    test_case record;
    rejected integer := 0;
BEGIN
    FOR test_case IN
        SELECT * FROM (VALUES
            ('공용 곡 라이선스 누락', $sql$INSERT INTO songs (title, source) VALUES ('invalid', 'BUILTIN')$sql$, '23514'),
            ('공용 곡 빈 라이선스', $sql$INSERT INTO songs (title, source, license) VALUES ('invalid', 'BUILTIN', '   ')$sql$, '23514'),
            ('공용 곡 개인 소유자', $sql$INSERT INTO songs (title, source, license, owner_id) VALUES ('invalid', 'BUILTIN', 'CC0', 1)$sql$, '23514'),
            ('개인 음원 소유자 누락', $sql$INSERT INTO songs (title, source) VALUES ('invalid', 'AUDIO')$sql$, '23514'),
            ('MIDI 소유자 누락', $sql$INSERT INTO songs (title, source) VALUES ('invalid', 'MIDI')$sql$, '23514'),
            ('존재하지 않는 회원', $sql$INSERT INTO songs (title, source, owner_id) VALUES ('invalid', 'AUDIO', 999)$sql$, '23503'),
            ('공용 곡 반주 키', $sql$INSERT INTO songs (title, source, license, accompaniment_key) VALUES ('invalid', 'BUILTIN', 'CC0', 'private/file')$sql$, '23514'),
            ('MIDI 반주 키', $sql$INSERT INTO songs (title, source, owner_id, accompaniment_key) VALUES ('invalid', 'MIDI', 1, 'private/file')$sql$, '23514'),
            ('미지원 출처', $sql$UPDATE songs SET source = 'DRILL' WHERE id = 2$sql$, '23514'),
            ('미지원 곡 상태', $sql$UPDATE songs SET status = 'UNKNOWN' WHERE id = 2$sql$, '23514'),
            ('0 BPM', $sql$UPDATE songs SET bpm = 0 WHERE id = 1$sql$, '23514'),
            ('음수 BPM', $sql$UPDATE songs SET bpm = -1 WHERE id = 1$sql$, '23514'),
            ('NaN BPM', $sql$UPDATE songs SET bpm = 'NaN'::numeric WHERE id = 1$sql$, '23514'),
            ('음수 재생 길이', $sql$UPDATE songs SET duration_ms = -1 WHERE id = 1$sql$, '23514'),
            ('중복 곡 난이도', $sql$INSERT INTO charts (song_id, difficulty) VALUES (1, 'EASY')$sql$, '23505'),
            ('미지원 난이도', $sql$INSERT INTO charts (song_id, difficulty) VALUES (1, 'EXPERT')$sql$, '23514'),
            ('존재하지 않는 곡', $sql$INSERT INTO charts (song_id, difficulty) VALUES (999, 'EASY')$sql$, '23503'),
            ('중복 채보 버전', $sql$INSERT INTO chart_versions (chart_id, version, notes, timing, note_count, generator, notation_status) VALUES (1, 1, '[]', '{}', 0, 'BUILTIN', 'READY')$sql$, '23505'),
            ('0 버전', $sql$UPDATE chart_versions SET version = 0 WHERE id = 1$sql$, '23514'),
            ('0 JSON 스키마 버전', $sql$UPDATE chart_versions SET schema_version = 0 WHERE id = 1$sql$, '23514'),
            ('notes 객체', $sql$UPDATE chart_versions SET notes = '{}' WHERE id = 1$sql$, '23514'),
            ('notes JSON null', $sql$UPDATE chart_versions SET notes = 'null' WHERE id = 1$sql$, '23514'),
            ('notes SQL NULL', $sql$UPDATE chart_versions SET notes = NULL WHERE id = 1$sql$, '23502'),
            ('timing JSON null', $sql$UPDATE chart_versions SET timing = 'null' WHERE id = 1$sql$, '23514'),
            ('timing 배열', $sql$UPDATE chart_versions SET timing = '[]' WHERE id = 1$sql$, '23514'),
            ('노트 수 불일치', $sql$UPDATE chart_versions SET note_count = 2 WHERE id = 1$sql$, '23514'),
            ('음수 노트 수', $sql$UPDATE chart_versions SET note_count = -1 WHERE id = 1$sql$, '23514'),
            ('표기 상태 생략', $sql$INSERT INTO chart_versions (chart_id, version, notes, timing, note_count, generator) VALUES (1, 3, '[]', '{}', 0, 'ADT_MODEL')$sql$, '23502'),
            ('미지원 표기 상태', $sql$UPDATE chart_versions SET notation_status = 'COMPLETE' WHERE id = 1$sql$, '23514'),
            ('미지원 생성기', $sql$UPDATE chart_versions SET generator = 'UNKNOWN' WHERE id = 1$sql$, '23514'),
            ('페이지 객체', $sql$UPDATE chart_versions SET sheet_pages = '{}' WHERE id = 1$sql$, '23514'),
            ('페이지 JSON null', $sql$UPDATE chart_versions SET sheet_pages = 'null' WHERE id = 1$sql$, '23514'),
            ('존재하지 않는 채보', $sql$INSERT INTO chart_versions (chart_id, version, notes, timing, note_count, generator, notation_status) VALUES (999, 1, '[]', '{}', 0, 'BUILTIN', 'READY')$sql$, '23503'),
            ('참조 중인 곡 삭제', $sql$DELETE FROM songs WHERE id = 1$sql$, '23503'),
            ('참조 중인 채보 삭제', $sql$DELETE FROM charts WHERE id = 1$sql$, '23503'),
            ('참조 중인 회원 삭제', $sql$DELETE FROM users WHERE id = 1$sql$, '23503')
        ) AS cases(name, statement, expected_state)
    LOOP
        BEGIN
            EXECUTE test_case.statement;
        EXCEPTION WHEN OTHERS THEN
            IF SQLSTATE <> test_case.expected_state THEN
                RAISE EXCEPTION '%: 예상 SQLSTATE %, 실제 % (%)',
                    test_case.name, test_case.expected_state, SQLSTATE, SQLERRM;
            END IF;
            rejected := rejected + 1;
            CONTINUE;
        END;
        RAISE EXCEPTION '%: 거부해야 할 입력이 성공했습니다', test_case.name;
    END LOOP;
    RAISE NOTICE 'PASS: 제약 위반 %건 모두 예상 SQLSTATE로 거부', rejected;
END;
$verify$;

-- 같은 곡의 다른 난이도는 허용하고, 원곡 수정·소프트 삭제 뒤에도 과거 버전을 보존한다.
INSERT INTO charts (song_id, difficulty) VALUES (1, 'NORMAL'), (1, 'HARD');
INSERT INTO chart_versions (chart_id, version, notes, timing, note_count, generator, notation_status)
SELECT id, 1, '[]', '{}', 0, 'BUILTIN', 'UNAVAILABLE'
FROM charts WHERE song_id = 1 AND difficulty = 'HARD';
UPDATE songs SET bpm = 90, offset_ms = 999, deleted_at = now() WHERE id = 1;

DO $verify$
BEGIN
    IF (SELECT count(*) FROM chart_versions WHERE chart_id = 1) <> 2 THEN
        RAISE EXCEPTION '과거 버전이 보존되지 않았습니다';
    END IF;
    IF (SELECT notes->0->>'timeMs' FROM chart_versions WHERE chart_id = 1 AND version = 1) IS DISTINCT FROM '250'
        OR (SELECT timing->>'offsetMs' FROM chart_versions WHERE chart_id = 1 AND version = 1) IS DISTINCT FROM '250' THEN
        RAISE EXCEPTION '원곡 변경으로 과거 버전의 시간 기준이 바뀌었습니다';
    END IF;
    IF (SELECT notes->0->>'timeMs' FROM chart_versions WHERE chart_id = 1 ORDER BY version DESC LIMIT 1) IS DISTINCT FROM '500' THEN
        RAISE EXCEPTION '최신 버전 조회 결과가 다릅니다';
    END IF;
    IF (SELECT sheet_pages->0->>'imageKey' FROM chart_versions WHERE chart_id = 1 AND version = 2) IS DISTINCT FROM 'sheet/2/1.png'
        OR (SELECT notes->0->'notation'->>'tick' FROM chart_versions WHERE chart_id = 1 AND version = 2) IS DISTINCT FROM '240' THEN
        RAISE EXCEPTION '이미지 매핑·악보 JSON이 보존되지 않았습니다';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM chart_versions WHERE chart_id = 2 AND notation_status = 'PENDING' AND sheet_pages IS NULL)
        OR NOT EXISTS (SELECT 1 FROM chart_versions WHERE chart_id = 3 AND notation_status = 'READY' AND sheet_pages IS NULL) THEN
        RAISE EXCEPTION '이미지가 없는 JSON 버전 저장을 지원하지 않습니다';
    END IF;
    IF (SELECT count(*) FROM songs WHERE owner_id IS NULL AND status = 'READY' AND deleted_at IS NULL) <> 0
        OR (SELECT count(*) FROM songs WHERE owner_id = 1 AND deleted_at IS NULL) <> 2 THEN
        RAISE EXCEPTION '공용 소프트 삭제 또는 개인 곡 조회 조건이 잘못되었습니다';
    END IF;
    IF EXISTS (SELECT 1 FROM songs WHERE created_at IS NULL OR updated_at IS NULL)
        OR EXISTS (SELECT 1 FROM chart_versions WHERE schema_version <> 1) THEN
        RAISE EXCEPTION '기본값 적용이 잘못되었습니다';
    END IF;
END;
$verify$;
SELECT 'PASS: V2 생성·36개 거부 조건·JSON/선택적 이미지·난이도·버전 보존·소프트 삭제' AS result;
