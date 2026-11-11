package com.ssafy.airdrum.domain.withdrawal.scheduler;

import java.sql.Timestamp;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Optional;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.dao.DataAccessException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import com.ssafy.airdrum.domain.auth.service.token.RefreshTokenService;

/**
 * 가입 동의 없이 떠난 신규 계정 정리(가입 동의 설계 4-6). 소셜 인증만 하고 동의하지 않은 채 일정 기간(기본 7일)이 지난
 * 회원 행을 지우고 refresh 토큰을 폐기한다.
 *
 * <p>대상은 V26 적용 뒤 생성되고 이용약관·개인정보 동의가 모두 없는 ACTIVE 회원이다. V26 이전 회원(기존 회원)은 약관을 처음
 * 도입하며 동의 전으로 시작했을 뿐이라 지우지 않는다. 기준 시각은 {@code flyway_schema_history}의 V26 적용 시각을 처음 실행할 때
 * 한 번 읽는다. 소셜 연동·프리셋·녹음은 FK CASCADE로 함께 지워지고, 동의 전 회원은 곡·플레이를 만들 수 없다(가입 게이트).
 *
 * <p>refresh 토큰 폐기({@code auth})가 필요해 {@code user}에 두지 않는다(순환 의존 방지, {@link WithdrawalService}와 같은 이유).
 */
@Component
public class PendingSignupCleanup {

	private static final Logger log = LoggerFactory.getLogger(PendingSignupCleanup.class);

	/** 한 번에 확인하는 회원 수. 남으면 다음 주기에 이어서 본다. */
	static final int BATCH_SIZE = 100;

	private final JdbcTemplate db;
	private final RefreshTokenService refreshTokens;
	private final Clock clock;
	private final Duration ttl;

	/** V26 적용 시각. 처음 실행할 때 한 번 읽는다. 비어 있으면 이력이 없어 정리하지 않는다. */
	private volatile Optional<Instant> baseline;

	/** 삭제하지 못한 회원 다음부터 이어 보기 위한 커서. 한 바퀴를 다 보면 0으로 돌아간다. */
	private long cursor;

	public PendingSignupCleanup(JdbcTemplate db, RefreshTokenService refreshTokens, Clock clock,
			@Value("${user.signup.pending-ttl-days:7}") long pendingTtlDays) {
		this.db = db;
		this.refreshTokens = refreshTokens;
		this.clock = clock;
		this.ttl = Duration.ofDays(pendingTtlDays);
	}

	@Scheduled(fixedDelayString = "${user.signup.cleanup-interval-ms:3600000}")
	public void scheduled() {
		try {
			runOnce(clock.instant());
		}
		catch (RuntimeException ex) {
			log.warn("가입 미완료 계정 정리 실패. 다음 주기에 재시도합니다: {}", ex.toString());
		}
	}

	/**
	 * V26 적용 시각을 기준으로 {@link #runOnce(Instant, Instant)}를 실행한다. 적용 이력이 없으면 아무것도 하지 않는다.
	 *
	 * @return 지운 회원 수
	 */
	int runOnce(Instant now) {
		return baseline().map(since -> runOnce(now, since)).orElse(0);
	}

	/**
	 * {@code since} 이후(포함), {@code now - ttl} 이전에 생성된 대상 회원을 한 명씩 지운다. 회원마다 따로 커밋되며(트랜잭션 없이
	 * 문장 하나), 한 회원의 실패는 경고만 남기고 다음 회원으로 넘어간다.
	 *
	 * @param since 기준 시각. 운영은 V26 적용 시각이고, 테스트는 다른 테스트의 회원을 건드리지 않도록 직접 정한다
	 * @return 지운 회원 수
	 */
	synchronized int runOnce(Instant now, Instant since) {
		List<Long> ids = db.queryForList("""
				SELECT id FROM users
				WHERE status = 'ACTIVE' AND terms_agreed_at IS NULL AND privacy_agreed_at IS NULL
				  AND created_at >= ? AND created_at < ? AND id > ?
				ORDER BY id LIMIT ?
				""", Long.class, Timestamp.from(since), Timestamp.from(now.minus(ttl)), cursor, BATCH_SIZE);
		int deleted = 0;
		for (long id : ids) {
			if (deleteSafely(id)) {
				deleted++;
			}
			cursor = id;
		}
		if (ids.size() < BATCH_SIZE) {
			cursor = 0;
		}
		if (deleted > 0) {
			log.info("가입 미완료 계정 {}명을 정리했습니다.", deleted);
		}
		return deleted;
	}

	private boolean deleteSafely(long userId) {
		try {
			// 조회와 삭제 사이에 동의했거나 탈퇴했으면 지우지 않는다
			int rows = db.update("""
					DELETE FROM users
					WHERE id = ? AND status = 'ACTIVE' AND terms_agreed_at IS NULL AND privacy_agreed_at IS NULL
					""", userId);
			if (rows == 0) {
				return false;
			}
		}
		catch (DataAccessException ex) {
			log.warn("가입 미완료 계정 삭제 실패 userId={}: {}", userId, ex.getMostSpecificCause().toString());
			return false;
		}
		try {
			refreshTokens.revokeAllOf(userId);
		}
		catch (RuntimeException ex) {
			// 회원 행이 없으므로 남은 토큰은 재발급에서 거부된다
			log.warn("가입 미완료 계정의 refresh 토큰 폐기 실패 userId={}: {}", userId, ex.toString());
		}
		return true;
	}

	private Optional<Instant> baseline() {
		var value = baseline;
		if (value == null) {
			value = readBaseline();
			baseline = value;
		}
		return value;
	}

	private Optional<Instant> readBaseline() {
		try {
			var installedOn = db.query("SELECT installed_on FROM flyway_schema_history WHERE version = '26'",
					(rs, row) -> rs.getTimestamp(1));
			if (!installedOn.isEmpty() && installedOn.getFirst() != null) {
				return Optional.of(installedOn.getFirst().toInstant());
			}
		}
		catch (DataAccessException ex) {
			log.warn("마이그레이션 이력을 읽지 못했습니다: {}", ex.getMostSpecificCause().toString());
		}
		log.warn("V26 적용 이력이 없어 가입 미완료 계정 정리를 건너뜁니다.");
		return Optional.empty();
	}

}
