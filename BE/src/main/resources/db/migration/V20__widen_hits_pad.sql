-- hits 패드 3컬럼을 varchar(16)으로 넓힌다. 업로드 패드 HIHAT_PEDAL(11자)이 varchar(10)에 들어가지 않아
-- 페달 타격이 섞인 플레이 업로드가 저장되지 않았다. telemetry_events는 V17에서 같은 폭으로 넓혔다.
-- varchar 길이만 늘리므로 테이블을 다시 쓰지 않는다. V21 뷰가 hits.pad를 참조하므로 뷰보다 먼저 적용한다.
ALTER TABLE hits
    ALTER COLUMN pad TYPE varchar(16),
    ALTER COLUMN baseline_pad TYPE varchar(16),
    ALTER COLUMN predicted_pad TYPE varchar(16);
