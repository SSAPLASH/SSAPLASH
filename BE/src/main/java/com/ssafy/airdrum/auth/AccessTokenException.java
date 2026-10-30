package com.ssafy.airdrum.auth;

/** access 토큰 검증 실패. 메시지에는 사유 이름만 넣고 토큰 값은 넣지 않는다(설계 문서(88) 3-7). */
public class AccessTokenException extends RuntimeException {

	public enum Reason {
		/** 비었거나 JWT 형식이 아니거나 필수 클레임(숫자 sub, exp)이 없다 */
		MALFORMED,
		/** 서명·알고리즘·발급자가 맞지 않는다 */
		INVALID_SIGNATURE,
		/** exp가 지났다(허용 오차 60초) */
		EXPIRED,
		/** 회원이 없거나 ACTIVE가 아니다 */
		USER_NOT_ACTIVE
	}

	private final Reason reason;

	public AccessTokenException(Reason reason) {
		super(reason.name());
		this.reason = reason;
	}

	public Reason getReason() {
		return reason;
	}

}
