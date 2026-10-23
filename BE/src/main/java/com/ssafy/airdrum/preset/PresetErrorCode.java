package com.ssafy.airdrum.preset;

import org.springframework.http.HttpStatus;

import com.ssafy.airdrum.common.error.ErrorCode;

/** 키트 프리셋 오류 코드(설계 문서(90) 3-4). 타인 프리셋도 {@link #PRESET_NOT_FOUND}다. */
public enum PresetErrorCode implements ErrorCode {

	PRESET_NOT_FOUND(HttpStatus.NOT_FOUND, "프리셋을 찾을 수 없습니다."),
	PRESET_NAME_DUPLICATE(HttpStatus.CONFLICT, "같은 이름의 프리셋이 있습니다."),
	PRESET_LIMIT_EXCEEDED(HttpStatus.CONFLICT, "프리셋은 " + KitPresetService.MAX_PRESETS + "개까지 저장할 수 있습니다."),
	/** 미리 검사를 통과했지만 동시 요청으로 DB 제약에 걸렸다. 다시 시도하면 된다. */
	PRESET_CONFLICT(HttpStatus.CONFLICT, "동시에 변경되어 저장하지 못했습니다. 다시 시도해 주세요.");

	private final HttpStatus status;
	private final String title;

	PresetErrorCode(HttpStatus status, String title) {
		this.status = status;
		this.title = title;
	}

	@Override
	public String code() {
		return name();
	}

	@Override
	public HttpStatus status() {
		return status;
	}

	@Override
	public String title() {
		return title;
	}

}
