-- 연주 중 LLM 구간 코칭 안내 칸의 보조 문구 상한을 16자에서 20자로 늘린다(QA 2026-11-16).
-- 16자로는 "미드탐보다 왼쪽을 쳐요" 같은 구체적인 지시가 들어가지 않았다. 검증 상한은 LiveCoachQueue.MAX_SUB와 같다.
-- 짧게 살다 지워지는 작업 표라 열 크기만 바꾼다. 기존 행은 모두 16자 이하라 그대로 들어간다.
ALTER TABLE live_coach_jobs ALTER COLUMN sub TYPE varchar(20);
