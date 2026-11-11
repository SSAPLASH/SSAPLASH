package com.ssafy.airdrum.domain.recommendation.exception;

import org.springframework.http.HttpStatus;
import com.ssafy.airdrum.global.error.ErrorCode;

public enum RecommendationErrorCode implements ErrorCode {
	RECOMMENDATION_NOT_FOUND(HttpStatus.NOT_FOUND, "추천 기록을 찾을 수 없습니다."),
	CANDIDATES_INVALID(HttpStatus.BAD_REQUEST, "추천 후보 형식이 올바르지 않습니다."),
	MODEL_VERSION_NOT_ACCEPTED(HttpStatus.BAD_REQUEST, "허용되지 않은 모델 버전입니다.");
	private final HttpStatus status;
	private final String title;
	RecommendationErrorCode(HttpStatus status, String title) { this.status = status; this.title = title; }
	public String code() { return name(); }
	public HttpStatus status() { return status; }
	public String title() { return title; }
}
