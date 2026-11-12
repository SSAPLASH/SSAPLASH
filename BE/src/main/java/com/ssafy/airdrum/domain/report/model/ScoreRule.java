package com.ssafy.airdrum.domain.report.model;

import java.util.Arrays;
import java.util.Optional;

/**
 * 판정 점수 규칙. 이름은 업로드 {@code judgementContext.judgementVersion} 문자열과 같고, 기록마다 저장된다.
 * PERFECT 100 · MISS 0은 모든 버전이 같고 GOOD 점수만 다르다.
 * V2(GOOD 80)는 11/12 팀 결정: 하나도 놓치지 않고 전부 GOOD이면 80%라 입문 코스 통과 기준 70%를 넘는다.
 * V1 기록은 다시 계산하지 않고 그 규칙 그대로 둔다. 업로드 검산(play)과 리포트 패드 정확도(report)가 같이 쓴다.
 */
public enum ScoreRule {
	SCORE_V1(60),
	SCORE_V2(80);

	/** 새로 친 기록이 쓰는 규칙(FE가 보내는 값과 같아야 한다) */
	public static final ScoreRule LATEST = SCORE_V2;
	public static final int PERFECT_POINTS = 100;

	private final int goodPoints;

	ScoreRule(int goodPoints) {
		this.goodPoints = goodPoints;
	}

	public int goodPoints() {
		return goodPoints;
	}

	public long score(long perfect, long good) {
		return perfect * PERFECT_POINTS + good * goodPoints;
	}

	/** 저장·전송된 버전 문자열. 모르는 값이면 비어 있다 */
	public static Optional<ScoreRule> of(String version) {
		return Arrays.stream(values()).filter(r -> r.name().equals(version)).findFirst();
	}
}
