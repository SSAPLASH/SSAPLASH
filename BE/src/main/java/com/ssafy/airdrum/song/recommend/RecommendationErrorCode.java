package com.ssafy.airdrum.song.recommend;

import org.springframework.http.HttpStatus;
import com.ssafy.airdrum.common.error.ErrorCode;

public enum RecommendationErrorCode implements ErrorCode {
	RECOMMENDATION_NOT_FOUND(HttpStatus.NOT_FOUND, "추천 기록을 찾을 수 없습니다.");
	private final HttpStatus status;
	private final String title;
	RecommendationErrorCode(HttpStatus status, String title) { this.status = status; this.title = title; }
	public String code() { return name(); }
	public HttpStatus status() { return status; }
	public String title() { return title; }
}
