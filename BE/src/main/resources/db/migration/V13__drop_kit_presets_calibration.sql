-- S15P31A307-128: 프리셋은 배치·사운드만 저장한다. 캘리브레이션은 기기·세션 값이라 프리셋에 두지 않는다(공통 명세 미결 #23, 10/22).
-- V11에서 추가한 컬럼을 지운다. 이 컬럼만 참조하는 CHECK(ck_kit_presets_calibration)도 함께 사라진다.
-- FE는 91번(10/23)부터 이 값을 보내지도 읽지도 않아 모든 행이 NULL이다. 되돌리기는 두지 않는다.
ALTER TABLE kit_presets DROP COLUMN calibration;
