package com.ssafy.airdrum.user;

import java.time.Clock;
import java.time.Instant;
import java.time.temporal.ChronoUnit;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** 회원 계정의 데이터 활용 동의 저장(설계 4-4). */
@Service
public class DataConsentService {

	private final UserRepository users;
	private final Clock clock;

	public DataConsentService(UserRepository users, Clock clock) {
		this.users = users;
		this.clock = clock;
	}

	/**
	 * 동의 값을 저장하고 저장된 현재 상태를 돌려준다. 같은 값이면 시각은 바뀌지 않는다.
	 *
	 * @throws UserNotActiveException ACTIVE 회원 행이 없을 때(탈퇴와 겹친 경우). 값은 기록되지 않는다
	 */
	@Transactional
	public DataConsentResponse save(long userId, boolean agreed) {
		// PostgreSQL timestamptz 정밀도(마이크로초)에 맞춘다
		Instant now = clock.instant().truncatedTo(ChronoUnit.MICROS);
		if (users.updateDataConsent(userId, agreed, now) == 0) {
			throw new UserNotActiveException(userId);
		}
		var user = users.findById(userId)
				.orElseThrow(() -> new IllegalStateException("회원 " + userId + "의 행이 없습니다."));
		return new DataConsentResponse(user.getDataConsent(), user.getDataConsentAt());
	}

}
