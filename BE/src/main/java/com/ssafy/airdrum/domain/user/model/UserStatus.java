package com.ssafy.airdrum.domain.user.model;

/** 회원 상태. 탈퇴해도 행은 남고 상태만 WITHDRAWN으로 바뀐다. DB 값은 이름 문자열이다. */
public enum UserStatus {
	ACTIVE,
	WITHDRAWN
}
