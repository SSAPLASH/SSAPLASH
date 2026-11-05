-- 곡 추천 R2: 리듬 격자(패드 묶음별로 한 박을 12칸으로 나눈 위치 비율). 추가만 하고 feature_version은 바꾸지 않는다.
-- NULL = 아직 계산하지 않음. 가변 템포·격자 이탈 채보는 {"excluded": "..."}를 저장해 다시 계산하지 않게 한다.
ALTER TABLE chart_features
    ADD COLUMN rhythm_grid jsonb CHECK (rhythm_grid IS NULL OR jsonb_typeof(rhythm_grid) = 'object');
