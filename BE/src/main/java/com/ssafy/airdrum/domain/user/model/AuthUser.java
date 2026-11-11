package com.ssafy.airdrum.domain.user.model;

import java.util.Objects;

/**
 * 인증된 회원. 요청마다 DB에서 ACTIVE를 확인해 만든 값이며, 권한도 토큰이 아니라 DB 값이다(설계 문서(88) 3-7).
 *
 * <p>컨트롤러는 이 타입을 메서드 인자로 선언하면 인증 모듈이 넣어 준다. 클라이언트가 보낸 회원 ID(쿼리·헤더·본문)는
 * 믿지 않고 항상 이 값의 {@code id}로 소유자를 판단한다.
 *
 * @param signupCompleted 이용약관·개인정보 동의를 마쳤는지(가입 동의 설계 3-6). 인증이 같은 조회에서 DB 값으로 채운다.
 *        가입 게이트가 이 값으로 동의 전 회원을 막는다
 */
public record AuthUser(Long id, UserRole role, boolean signupCompleted) {

	public AuthUser {
		Objects.requireNonNull(id, "id");
		Objects.requireNonNull(role, "role");
	}

	/** 가입 완료 회원. 토큰 발급처럼 가입 여부와 무관한 기존 호출을 위해 남긴다. */
	public AuthUser(Long id, UserRole role) {
		this(id, role, true);
	}

}
