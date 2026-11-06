-- MusicXML 악보 업로드 곡 등록(293번, 설계 .claude/plans/CHART-001-MusicXML-악보-업로드-곡-등록.md 3-2절).
-- 곡 출처 MUSICXML과 채보 생성기 MUSICXML_RULE을 허용한다. 기존 행·다른 CHECK(반주 키는 AUDIO·BUILTIN·MIDI만)는 그대로다.
-- V2에서 이름 없이 만든 열 CHECK의 PostgreSQL 기본 이름은 {테이블}_{열}_check다(V17의 telemetry_events_clock_offset_ms_check와 같다).
ALTER TABLE songs DROP CONSTRAINT songs_source_check;
ALTER TABLE songs ADD CONSTRAINT songs_source_check
    CHECK (source IN ('BUILTIN', 'MIDI', 'AUDIO', 'MUSICXML'));

ALTER TABLE chart_versions DROP CONSTRAINT chart_versions_generator_check;
ALTER TABLE chart_versions ADD CONSTRAINT chart_versions_generator_check
    CHECK (generator IN ('BUILTIN', 'MIDI_RULE', 'ADT_MODEL', 'MANUAL', 'MUSICXML_RULE'));
