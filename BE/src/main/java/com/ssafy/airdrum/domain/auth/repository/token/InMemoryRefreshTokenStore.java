package com.ssafy.airdrum.domain.auth.repository.token;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.Optional;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Component;

/**
 * 메모리 refresh 토큰 저장소. 재시작하면 모든 로그인이 풀리고 서버 여러 대가 공유하지 못한다. 테스트·Redis 없는 로컬 전용이다.
 * {@link java.util.Map#remove}가 원자적 소비를 맡는다.
 */
@Component
@ConditionalOnProperty(name = "auth.refresh-token.store", havingValue = "memory")
public class InMemoryRefreshTokenStore implements RefreshTokenStore {

	private static final Logger log = LoggerFactory.getLogger(InMemoryRefreshTokenStore.class);

	private record Entry(long userId, Instant expiresAt) {
	}

	private final ConcurrentHashMap<String, Entry> tokens = new ConcurrentHashMap<>();
	private final ConcurrentHashMap<Long, Set<String>> byUser = new ConcurrentHashMap<>();
	private final Clock clock;

	public InMemoryRefreshTokenStore(Clock clock) {
		this.clock = clock;
		log.warn("refresh 토큰을 메모리에 보관합니다. 재시작하면 모든 로그인이 풀립니다(테스트·로컬 전용).");
	}

	@Override
	public void save(String tokenHash, long userId, Duration ttl) {
		tokens.put(tokenHash, new Entry(userId, clock.instant().plus(ttl)));
		byUser.computeIfAbsent(userId, id -> ConcurrentHashMap.newKeySet()).add(tokenHash);
	}

	@Override
	public Optional<Long> consume(String tokenHash) {
		var entry = tokens.remove(tokenHash);
		if (entry == null) {
			return Optional.empty();
		}
		var hashes = byUser.get(entry.userId());
		if (hashes != null) {
			hashes.remove(tokenHash);
		}
		return clock.instant().isBefore(entry.expiresAt()) ? Optional.of(entry.userId()) : Optional.empty();
	}

	@Override
	public int revokeAll(long userId) {
		var hashes = byUser.remove(userId);
		if (hashes == null) {
			return 0;
		}
		var removed = 0;
		for (var hash : hashes) {
			if (tokens.remove(hash) != null) {
				removed++;
			}
		}
		return removed;
	}

}
