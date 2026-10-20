package com.ssafy.airdrum.user;

/** 로그인하려는 회원이 ACTIVE가 아니다(탈퇴 등). 인증 모듈이 로그인 실패로 바꾼다. */
public class UserNotActiveException extends IllegalStateException {

	private final Long userId;

	public UserNotActiveException(Long userId) {
		super("회원 " + userId + "은(는) 활성 상태가 아닙니다.");
		this.userId = userId;
	}

	public Long getUserId() {
		return userId;
	}

}
