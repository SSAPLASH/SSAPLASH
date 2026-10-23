-- S15P31A307-90: 프리셋에 센서 캘리브레이션을 함께 저장한다(배치·캘리브레이션·사운드). 캘리브레이션 전이면 NULL.
-- 내용(패드별 앵커 등)은 FE 형식이며 BE는 해석하지 않는다. 형식 버전은 schema_version을 함께 쓴다.
ALTER TABLE kit_presets
    ADD COLUMN calibration jsonb,
    ADD CONSTRAINT ck_kit_presets_calibration CHECK (jsonb_typeof(calibration) = 'object');
