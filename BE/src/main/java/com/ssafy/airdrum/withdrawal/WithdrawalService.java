package com.ssafy.airdrum.withdrawal;

import java.time.Clock;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.dao.DataAccessException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.ssafy.airdrum.auth.RefreshTokenService;
import com.ssafy.airdrum.preset.KitPresetRepository;
import com.ssafy.airdrum.user.SocialAccountRepository;
import com.ssafy.airdrum.user.UserNotActiveException;
import com.ssafy.airdrum.user.UserRepository;
import com.ssafy.airdrum.user.UserStatus;
import com.ssafy.airdrum.user.UserWithdrawnEvent;

/**
 * 회원 탈퇴 트랜잭션(탈퇴 설계 4장 흐름 A). {@code users} 행을 {@code FOR UPDATE}로 잠근 뒤 상태 전이·개인정보 비우기,
 * 소셜 연동·키트 프리셋·연주 녹음·비동의 플레이 로그·텔레메트리 삭제, refresh 토큰 폐기, {@link UserWithdrawnEvent} 발행까지 한 트랜잭션에서 한다.
 *
 * <p>곡·파일·채보 작업 정리는 이벤트를 받는 쪽(BE2)이 커밋 뒤에 한다. 이 클래스가 {@code user}·{@code auth}·{@code preset}을
 * 모두 알아야 해서 {@code user} 패키지에 두지 않는다(순환 의존 방지). 플레이 로그·텔레메트리는 {@code play}·{@code telemetry} 클래스를 쓰지 않고 SQL로 지운다.
 */
@Service
public class WithdrawalService {

	private static final Logger log = LoggerFactory.getLogger(WithdrawalService.class);

	private final UserRepository users;
	private final SocialAccountRepository socialAccounts;
	private final KitPresetRepository presets;
	private final RefreshTokenService refreshTokens;
	private final ApplicationEventPublisher events;
	private final JdbcTemplate db;
	private final Clock clock;

	public WithdrawalService(UserRepository users, SocialAccountRepository socialAccounts, KitPresetRepository presets,
			RefreshTokenService refreshTokens, ApplicationEventPublisher events, JdbcTemplate db, Clock clock) {
		this.users = users;
		this.socialAccounts = socialAccounts;
		this.presets = presets;
		this.refreshTokens = refreshTokens;
		this.events = events;
		this.db = db;
		this.clock = clock;
	}

	/**
	 * @throws UserNotActiveException 잠금을 얻고 보니 이미 탈퇴했다(동시 탈퇴에서 진 요청, U1). 이벤트는 발행하지 않는다
	 */
	@Transactional(timeout = 15)
	public void withdraw(long userId) {
		var user = users.findByIdForUpdate(userId)
				.orElseThrow(() -> new IllegalStateException("인증을 통과한 회원 " + userId + "의 행이 없습니다."));
		if (user.getStatus() != UserStatus.ACTIVE) {
			throw new UserNotActiveException(userId);
		}
		user.withdraw(clock.instant());
		// 벌크 삭제가 먼저 flush하므로 위 전이도 여기서 DB에 반영된다
		socialAccounts.deleteAllByUserId(userId);
		presets.deleteAllByUserId(userId);
		int deletedRecordings = deleteRecordings(userId);
		int deletedPlays = deleteNonConsentedPlays(userId);
		int deletedTelemetry = deleteTelemetry(userId);
		db.update("DELETE FROM recommendation_items WHERE user_id = ?", userId);
		revokeRefreshTokens(userId);
		events.publishEvent(new UserWithdrawnEvent(userId));
		log.info("회원 탈퇴 userId={} deletedRecordings={} deletedPlays={} deletedTelemetry={}", userId, deletedRecordings,
				deletedPlays, deletedTelemetry);
	}

	/**
	 * 연주 녹음(살아 있는 것·지운 것)을 지운다(257 U7). 파일이 없어 정리 큐가 필요 없다. 비동의 세션 삭제보다 먼저 지워
	 * {@code play_session_id}의 SET NULL 갱신을 줄인다. {@code recording} 클래스를 쓰지 않고 SQL로 지운다.
	 */
	private int deleteRecordings(long userId) {
		return db.update("DELETE FROM recordings WHERE user_id = ?", userId);
	}

	/**
	 * 학습 데이터 사용에 동의하지 않은 세션을 지운다. {@code hits}·{@code reports}는 cascade로 함께 지워지고,
	 * {@code play_raw_uploads}는 세션 참조만 NULL이 되어 {@code RawLogCleanupWorker}가 다음 주기에 원본 객체를 회수한다.
	 * 동의 세션은 회원 행(개인정보를 비운 행)만 가리키므로 그대로 둔다.
	 */
	private int deleteNonConsentedPlays(long userId) {
		return db.update("DELETE FROM play_sessions WHERE user_id = ? AND consent = false", userId);
	}

	/**
	 * 그 회원의 텔레메트리를 지운다(258, Infra 합의). 진단용이라 익명으로 남기지 않는다. {@code user_id}는 FK가 없는 bigint라
	 * {@code users} 행 유지와 충돌하지 않는다. 실패하면 탈퇴 전체를 롤백한다. {@code user_id}가 NULL인 행은 건드리지 않는다.
	 * 탈퇴와 같은 순간 들어온 수신 배치가 남긴 소수 행이 있으면 90일 보관 정책(V30)이 지운다.
	 */
	private int deleteTelemetry(long userId) {
		return db.update("DELETE FROM telemetry_events WHERE user_id = ?", userId);
	}

	/** Redis 장애로 탈퇴를 막지 않는다(U2). 남은 토큰은 재발급 때 회원 상태 검사로 거절되고 TTL로 사라진다. */
	private void revokeRefreshTokens(long userId) {
		try {
			refreshTokens.revokeAllOf(userId);
		}
		catch (DataAccessException ex) {
			log.warn("탈퇴 회원의 refresh 토큰 폐기 실패, 탈퇴는 계속한다 userId={}", userId, ex);
		}
	}

}
