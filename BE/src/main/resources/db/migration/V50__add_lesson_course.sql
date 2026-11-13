-- 학습 코스(설계 .claude/plans/SETUP-학습-코스-중급.md 3-2절). 레슨을 입문·중급 코스로 나눈다.
-- 기존 레슨은 모두 입문 코스다. 순서(position)는 코스 안에서만 겹치지 않는다.
-- 진도(lesson_completions·연주 기록)는 곡 기준이라 바꾸지 않는다.

ALTER TABLE lessons
    ADD COLUMN course varchar(12) NOT NULL DEFAULT 'BEGINNER'
        CONSTRAINT ck_lessons_course CHECK (course IN ('BEGINNER', 'INTERMEDIATE'));

ALTER TABLE lessons DROP CONSTRAINT lessons_position_key;
ALTER TABLE lessons ADD CONSTRAINT uq_lessons_course_position UNIQUE (course, position);
