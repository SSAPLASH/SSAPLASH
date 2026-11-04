package com.ssafy.airdrum.user;

import java.time.Clock;
import java.time.Instant;
import java.time.temporal.ChronoUnit;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** 가입 동의 저장(가입 동의 설계 4-1·4-4). 판은 비교·해석하지 않고 저장만 한다. */
@Service
public class SignupConsentService {

	private final UserRepository users;
	private final UserQueryService queries;
	private final Clock clock;

	private final SignupConsentVersions versions;

	public SignupConsentService(UserRepository users, UserQueryService queries, Clock clock,
			SignupConsentVersions versions) {
		this.users = users;
		this.queries = queries;
		this.clock = clock;
		this.versions = versions;
	}

	/**
	 * 세 동의를 저장하고 저장된 뒤의 {@code /me} 본문을 돌려준다. 판이 바뀐 항목만 동의 시각이 바뀐다.
	 *
	 * @param request 검증을 통과한 요청({@code dataConsent.agreed}는 true)
	 * @throws UserNotActiveException ACTIVE 회원 행이 없을 때(탈퇴와 겹친 경우). 아무것도 기록되지 않는다
	 * @throws com.ssafy.airdrum.common.error.BusinessException 허용 판 목록이 설정돼 있고 보낸 판이 그 목록에 없을 때(422). 아무것도 기록되지 않는다
	 */
	@Transactional
	public UserMeResponse save(long userId, SignupConsentRequest request) {
		versions.check(request);
		// PostgreSQL timestamptz 정밀도(마이크로초)에 맞춘다
		Instant now = clock.instant().truncatedTo(ChronoUnit.MICROS);
		var data = request.dataConsent();
		int updated = users.updateSignupConsent(userId, request.termsVersion(), request.privacyVersion(),
				data.agreed(), data.version(), now);
		if (updated == 0) {
			throw new UserNotActiveException(userId);
		}
		return queries.me(userId);
	}

}
