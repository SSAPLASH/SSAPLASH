package com.ssafy.airdrum.user;

import java.sql.Timestamp;
import java.time.Clock;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.Set;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.ssafy.airdrum.common.error.BusinessException;

/**
 * 맞춤 곡 추천 학습 활용 동의 저장·철회. 동의하면 가명 키를 발급하고, 철회하면 같은 트랜잭션에서 키와 후보를 지운다.
 * 응답마다 이력(user_recommendation_consent_history)을 추가한다. 현재 상태 행은 덮어쓰여 지난 동의를 알 수 없기 때문이다.
 * 허용 판 목록의 규칙은 {@link SignupConsentVersions}와 같다(비어 있으면 검사하지 않는다).
 */
@Service
public class RecommendationConsentService {

	public record Consent(boolean agreed, String version, Instant updatedAt) {
	}

	private final JdbcTemplate db;
	private final Clock clock;
	private final Set<String> versions;

	public RecommendationConsentService(JdbcTemplate db, Clock clock,
			@Value("${SIGNUP_CONSENT_RECOMMENDATION_VERSIONS:}") String versions) {
		this.db = db;
		this.clock = clock;
		this.versions = SignupConsentVersions.parse(versions);
	}

	/** 한 번도 응답하지 않았으면 미동의다. */
	@Transactional(readOnly = true)
	public Consent get(long userId) {
		var rows = db.query("SELECT agreed, version, updated_at FROM user_recommendation_consent WHERE user_id = ?",
				(r, n) -> new Consent(r.getBoolean(1), r.getString(2), r.getTimestamp(3).toInstant()), userId);
		return rows.isEmpty() ? new Consent(false, null, null) : rows.getFirst();
	}

	/**
	 * @throws UserNotActiveException ACTIVE 회원이 아닐 때. 아무것도 기록되지 않는다
	 * @throws BusinessException 동의인데 허용 판 목록이 설정돼 있고 보낸 판이 그 목록에 없을 때(422). 철회는 판과 관계없이 받는다
	 */
	@Transactional
	public Consent save(long userId, RecommendationConsentInput input) {
		String version = input.version().strip();
		if (input.agreed() && !versions.isEmpty() && !versions.contains(version)) {
			throw new BusinessException(UserErrorCode.SIGNUP_CONSENT_VERSION_INVALID,
					SignupConsentVersions.DETAIL + " (recommendationConsent.version)");
		}
		Instant now = clock.instant().truncatedTo(ChronoUnit.MICROS);
		int saved = db.update("""
				INSERT INTO user_recommendation_consent(user_id, agreed, version, updated_at)
				SELECT id, ?, ?, ? FROM users WHERE id = ? AND status = 'ACTIVE'
				ON CONFLICT (user_id) DO UPDATE SET agreed = EXCLUDED.agreed, version = EXCLUDED.version, updated_at = EXCLUDED.updated_at
				""", input.agreed(), version, Timestamp.from(now), userId);
		if (saved == 0) {
			throw new UserNotActiveException(userId);
		}
		db.update("INSERT INTO user_recommendation_consent_history(user_id, agreed, version, recorded_at) VALUES (?, ?, ?, ?)",
				userId, input.agreed(), version, Timestamp.from(now));
		if (input.agreed()) {
			db.update("""
					INSERT INTO recommendation_user_keys(user_id, user_key) VALUES (?, replace(gen_random_uuid()::text, '-', ''))
					ON CONFLICT (user_id) DO NOTHING
					""", userId);
		} else {
			db.update("DELETE FROM recommendation_candidates WHERE user_id = ?", userId);
			db.update("DELETE FROM recommendation_user_keys WHERE user_id = ?", userId);
		}
		return new Consent(input.agreed(), version, now);
	}

	/**
	 * 철회했거나 탈퇴한 회원 중 그 시각이 기준보다 오래된 회원의 이력을 지운다. 동의 중인 회원의 이력은 남긴다.
	 * 탈퇴 회원은 현재 상태 행도 함께 지운다. 지운 이력 수를 돌려준다.
	 */
	@Transactional
	public int deleteHistoryBefore(Instant cutoff) {
		var at = Timestamp.from(cutoff);
		int deleted = db.update("""
				DELETE FROM user_recommendation_consent_history h
				USING user_recommendation_consent c, users u
				WHERE c.user_id = h.user_id AND u.id = h.user_id
				  AND (NOT c.agreed OR u.status <> 'ACTIVE')
				  AND GREATEST(c.updated_at, u.withdrawn_at) < ?
				""", at);
		db.update("""
				DELETE FROM user_recommendation_consent c USING users u
				WHERE u.id = c.user_id AND u.status <> 'ACTIVE' AND GREATEST(c.updated_at, u.withdrawn_at) < ?
				""", at);
		return deleted;
	}

}
