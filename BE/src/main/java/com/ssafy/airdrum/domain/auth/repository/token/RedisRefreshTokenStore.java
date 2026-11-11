package com.ssafy.airdrum.domain.auth.repository.token;

import java.time.Duration;
import java.util.ArrayList;
import java.util.Optional;

import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Component;

/**
 * Redis refresh 토큰 저장소(설계 문서(88) 3-5).
 *
 * <ul>
 * <li>{@code refresh:token:{hash}} → 회원 id, TTL = 토큰 수명. 소비는 {@code GETDEL} 한 번이라 동시 재발급 중 하나만 성공한다.
 * <li>{@code refresh:user:{userId}} → 그 회원의 해시 집합. 탈퇴 때 전부 지우기 위한 색인이며, 발급마다 TTL을 늘린다.
 * 만료된 토큰의 해시가 남아 있어도 없는 키를 지우는 것은 무해하다.
 * </ul>
 */
@Component
@ConditionalOnProperty(name = "auth.refresh-token.store", havingValue = "redis", matchIfMissing = true)
class RedisRefreshTokenStore implements RefreshTokenStore {

	static final String TOKEN_KEY_PREFIX = "refresh:token:";
	static final String USER_KEY_PREFIX = "refresh:user:";

	private final StringRedisTemplate redis;

	RedisRefreshTokenStore(StringRedisTemplate redis) {
		this.redis = redis;
	}

	@Override
	public void save(String tokenHash, long userId, Duration ttl) {
		redis.opsForValue().set(tokenKey(tokenHash), String.valueOf(userId), ttl);
		var userKey = userKey(userId);
		redis.opsForSet().add(userKey, tokenHash);
		redis.expire(userKey, ttl);
	}

	@Override
	public Optional<Long> consume(String tokenHash) {
		var value = redis.opsForValue().getAndDelete(tokenKey(tokenHash));
		if (value == null) {
			return Optional.empty();
		}
		var userId = Long.parseLong(value);
		redis.opsForSet().remove(userKey(userId), tokenHash);
		return Optional.of(userId);
	}

	@Override
	public int revokeAll(long userId) {
		var userKey = userKey(userId);
		var hashes = redis.opsForSet().members(userKey);
		redis.delete(userKey);
		if (hashes == null || hashes.isEmpty()) {
			return 0;
		}
		var keys = new ArrayList<String>(hashes.size());
		for (var hash : hashes) {
			keys.add(tokenKey(hash));
		}
		var deleted = redis.delete(keys);
		return deleted == null ? 0 : deleted.intValue();
	}

	static String tokenKey(String tokenHash) {
		return TOKEN_KEY_PREFIX + tokenHash;
	}

	static String userKey(long userId) {
		return USER_KEY_PREFIX + userId;
	}

}
