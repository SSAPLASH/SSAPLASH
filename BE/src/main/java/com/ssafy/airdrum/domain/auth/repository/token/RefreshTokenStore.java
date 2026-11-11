package com.ssafy.airdrum.domain.auth.repository.token;

import java.time.Duration;
import java.util.Optional;

/**
 * refresh 토큰 저장소(설계 문서(88) 3-5). 키는 토큰 원문이 아니라 SHA-256 해시(16진 64자)이고 값은 회원 id다.
 * 구현은 {@code auth.refresh-token.store}로 고른다({@code redis} 기본, {@code memory}는 테스트·로컬 전용).
 */
public interface RefreshTokenStore {

	/** 저장하고 회원별 목록에도 넣는다. */
	void save(String tokenHash, long userId, Duration ttl);

	/** 원자적으로 읽고 지운다. 같은 해시로 동시에 불러도 한 번만 값을 돌려준다. 없거나 만료됐으면 빈 값. */
	Optional<Long> consume(String tokenHash);

	/** 회원의 토큰을 모두 지우고 지운 개수를 돌려준다(탈퇴용). */
	int revokeAll(long userId);

}
