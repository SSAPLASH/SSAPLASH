package com.ssafy.airdrum.song.midi;

import org.springframework.http.HttpStatus;

import com.ssafy.airdrum.common.error.ErrorCode;

public enum MidiErrorCode implements ErrorCode {
	INVALID(HttpStatus.BAD_REQUEST, "MIDI 업로드 요청이 올바르지 않습니다."),
	TOO_LARGE(HttpStatus.PAYLOAD_TOO_LARGE, "MIDI 파일의 허용 크기를 초과했습니다."),
	UNSUPPORTED(HttpStatus.UNPROCESSABLE_ENTITY, "변환할 수 없는 MIDI 파일입니다."),
	NO_DRUM_NOTES(HttpStatus.UNPROCESSABLE_ENTITY, "MIDI 파일에 변환할 드럼 노트가 없습니다.");

	private final HttpStatus status;
	private final String title;

	MidiErrorCode(HttpStatus status, String title) {
		this.status = status;
		this.title = title;
	}

	public String code() {
		return "MIDI_" + name();
	}

	public HttpStatus status() {
		return status;
	}

	public String title() {
		return title;
	}

}
