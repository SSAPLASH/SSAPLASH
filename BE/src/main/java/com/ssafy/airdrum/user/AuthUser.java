package com.ssafy.airdrum.user;

import java.util.Objects;

/**
 * 인증된 회원. 요청마다 DB에서 ACTIVE를 확인해 만든 값이며, 권한도 토큰이 아니라 DB 값이다(설계 문서(88) 3-7).
 *
 * <p>컨트롤러는 이 타입을 메서드 인자로 선언하면 인증 모듈이 넣어 준다. 클라이언트가 보낸 회원 ID(쿼리·헤더·본문)는
 * 믿지 않고 항상 이 값의 {@code id}로 소유자를 판단한다.
 */
public record AuthUser(Long id, UserRole role) {

	public AuthUser {
		Objects.requireNonNull(id, "id");
		Objects.requireNonNull(role, "role");
	}

}
