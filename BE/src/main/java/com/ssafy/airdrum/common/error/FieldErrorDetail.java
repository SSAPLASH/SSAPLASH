package com.ssafy.airdrum.common.error;

/**
 * 검증 실패 항목 하나.
 *
 * @param field   요청 본문 필드 경로(예: {@code name}, {@code pads[2].key}) 또는 파라미터 이름
 * @param message 제약 메시지(한국어). 거부된 값은 민감 정보일 수 있어 넣지 않는다
 */
public record FieldErrorDetail(String field, String message) {
}
