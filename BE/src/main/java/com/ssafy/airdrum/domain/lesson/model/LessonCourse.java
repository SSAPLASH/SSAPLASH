package com.ssafy.airdrum.domain.lesson.model;

/**
 * 학습 코스(학습 코스 설계 3-1절). 선언 순서가 곧 코스 순서다. 레슨 목록은 이 순서 → 코스 안 순서로 한 줄로 이어지고,
 * 잠금은 그 한 줄에서 계산하므로 앞 코스를 다 통과해야 다음 코스가 열린다.
 */
public enum LessonCourse {
	BEGINNER, INTERMEDIATE
}
