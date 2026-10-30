package com.ssafy.airdrum.chart;

import org.springframework.http.HttpStatus;
import com.ssafy.airdrum.common.error.ErrorCode;

public enum ChartErrorCode implements ErrorCode {
	SONG_NOT_FOUND(HttpStatus.NOT_FOUND, "곡을 찾을 수 없습니다."),
	CHART_NOT_FOUND(HttpStatus.NOT_FOUND, "채보를 찾을 수 없습니다."),
	CHART_VERSION_NOT_FOUND(HttpStatus.NOT_FOUND, "채보 버전을 찾을 수 없습니다."),
	SONG_NOT_READY(HttpStatus.CONFLICT, "아직 플레이할 수 없는 곡입니다."),
	CHART_SCHEMA_UNSUPPORTED(HttpStatus.CONFLICT, "지원하지 않는 채보 형식입니다."),
	CHART_SHEET_TIMING_UNAVAILABLE(HttpStatus.CONFLICT, "악보 페이지의 시간 정보가 준비되지 않았습니다."),
	CHART_ASSET_NOT_FOUND(HttpStatus.NOT_FOUND, "채보 파일을 찾을 수 없습니다."),
	CHART_ASSET_UNAVAILABLE(HttpStatus.SERVICE_UNAVAILABLE, "채보 파일을 일시적으로 제공할 수 없습니다.");
	private final HttpStatus status;
	private final String title;
	ChartErrorCode(HttpStatus status, String title) { this.status = status; this.title = title; }
	public String code() { return name(); }
	public HttpStatus status() { return status; }
	public String title() { return title; }
}
