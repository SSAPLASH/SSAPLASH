package com.ssafy.airdrum.domain.auth.exception;

/**
 * 로그인 흐름의 예상된 실패. 오류 JSON이 아니라 FE 로그인 페이지 리다이렉트로 바뀐다(설계 문서 4-C).
 * 메시지에 인가 코드·토큰·이메일을 넣지 않는다.
 */
public class OAuth2FlowException extends RuntimeException {

	static final String ACCESS_DENIED = "access_denied";
	public static final String OAUTH_FAILED = "oauth_failed";

	public enum Reason {
		/** 제공자가 {@code error} 파라미터로 돌려보냄 */
		PROVIDER_ERROR,
		/** {@code code} 누락 */
		MISSING_PARAMETER,
		/** state 쿠키·파라미터 누락 또는 불일치 */
		STATE_MISMATCH,
		TOKEN_EXCHANGE_FAILED,
		USER_INFO_FAILED,
		/** 회원이 ACTIVE가 아님 */
		USER_NOT_ACTIVE,
		/** 로그인 성공 처리(세션 발급) 실패 */
		SESSION_ISSUE_FAILED
	}

	private final Reason reason;
	private final String providerError;

	public OAuth2FlowException(Reason reason, String detail) {
		this(reason, detail, null);
	}

	private OAuth2FlowException(Reason reason, String detail, String providerError) {
		super(detail == null ? reason.name() : reason.name() + ": " + detail);
		this.reason = reason;
		this.providerError = providerError;
	}

	/** 제공자가 돌려준 {@code error} 값. 형식 밖의 값은 로그에 그대로 남기지 않도록 잘라 둔다. */
	public static OAuth2FlowException providerError(String error) {
		var value = error.length() > 64 ? error.substring(0, 64) : error;
		return new OAuth2FlowException(Reason.PROVIDER_ERROR, "error=" + value, value);
	}

	public Reason getReason() {
		return reason;
	}

	/** FE에 넘기는 {@code error} 코드. 사용자가 동의를 거부한 경우만 따로 구분한다. */
	public String errorCode() {
		return (reason == Reason.PROVIDER_ERROR && ACCESS_DENIED.equals(providerError)) ? ACCESS_DENIED : OAUTH_FAILED;
	}

}
