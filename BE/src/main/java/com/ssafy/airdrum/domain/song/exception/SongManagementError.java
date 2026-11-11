package com.ssafy.airdrum.domain.song.exception;

import org.springframework.http.HttpStatus;
import com.ssafy.airdrum.global.error.ErrorCode;

public enum SongManagementError implements ErrorCode {
    SONG_INVALID(HttpStatus.BAD_REQUEST,"곡 정보를 확인하세요."), SONG_FORBIDDEN(HttpStatus.FORBIDDEN,"이 곡을 변경할 수 없습니다."),
    SONG_BUSY(HttpStatus.CONFLICT,"처리 중인 곡은 변경할 수 없습니다."), COVER_INVALID(HttpStatus.BAD_REQUEST,"커버 이미지를 확인하세요."),
    COVER_UNSUPPORTED(HttpStatus.UNSUPPORTED_MEDIA_TYPE,"지원하지 않는 이미지 형식입니다."), COVER_TOO_LARGE(HttpStatus.PAYLOAD_TOO_LARGE,"커버 이미지가 너무 큽니다."),
    COVER_UNAVAILABLE(HttpStatus.SERVICE_UNAVAILABLE,"커버 저장소를 사용할 수 없습니다.");
    private final HttpStatus status; private final String title;
    SongManagementError(HttpStatus status,String title) { this.status=status; this.title=title; }
    public String code() { return name(); } public HttpStatus status() { return status; } public String title() { return title; }
}
