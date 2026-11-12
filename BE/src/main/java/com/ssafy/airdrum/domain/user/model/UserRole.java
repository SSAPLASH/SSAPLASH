package com.ssafy.airdrum.domain.user.model;

/** 회원 권한. 모니터링 페이지·API는 서버가 ADMIN만 허용한다. DB 값은 이름 문자열이다. */
public enum UserRole {
	USER,
	ADMIN
}
