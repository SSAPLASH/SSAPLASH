package com.ssafy.airdrum.domain.song.exception;

import org.springframework.http.HttpStatus;

import com.ssafy.airdrum.global.error.ErrorCode;

/** MusicXML 업로드 오류(293번 설계 3-1절). MIDI 업로드({@code MidiErrorCode})와 같은 모양이며 코드는 {@code MUSICXML_} 접두어다. */
public enum MusicXmlErrorCode implements ErrorCode {

	/** 요청 형태·제목 규칙 위반, 빈 파일. */
	INVALID(HttpStatus.BAD_REQUEST, "MusicXML 업로드 요청이 올바르지 않습니다."),
	/** 파일 5 MiB 초과. */
	TOO_LARGE(HttpStatus.PAYLOAD_TOO_LARGE, "MusicXML 파일의 허용 크기를 초과했습니다."),
	/** MusicXML이 아니거나(바이트 검사) AI가 읽을 수 없음(timewise·깨진 파일·길이 초과). detail에 이유 한 줄. */
	UNSUPPORTED(HttpStatus.UNPROCESSABLE_ENTITY, "변환할 수 없는 MusicXML 파일입니다."),
	/** 드럼 파트가 없거나 패드로 바꿀 음표가 없음. */
	NO_DRUM_NOTES(HttpStatus.UNPROCESSABLE_ENTITY, "악보에 변환할 드럼 파트가 없습니다."),
	/** AI 변환 서버 연결 불가·시간 초과·5xx·계약 밖 응답. */
	UNAVAILABLE(HttpStatus.SERVICE_UNAVAILABLE, "악보 변환 서버를 사용할 수 없습니다.");

	private final HttpStatus status;
	private final String title;

	MusicXmlErrorCode(HttpStatus status, String title) {
		this.status = status;
		this.title = title;
	}

	@Override
	public String code() {
		return "MUSICXML_" + name();
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
