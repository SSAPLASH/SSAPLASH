package com.ssafy.airdrum.domain.withdrawal.service;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.dao.DataAccessException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.ssafy.airdrum.domain.auth.service.token.RefreshTokenService;
import com.ssafy.airdrum.domain.preset.service.KitPresetService;
import com.ssafy.airdrum.domain.recording.service.RecordingService;
import com.ssafy.airdrum.domain.telemetry.service.TelemetryBatchService;
import com.ssafy.airdrum.domain.recommendation.service.RecommendationService;
import com.ssafy.airdrum.domain.user.service.consent.RecommendationConsentService;
import com.ssafy.airdrum.domain.user.exception.UserNotActiveException;
import com.ssafy.airdrum.domain.user.service.profile.UserWithdrawalService;
import com.ssafy.airdrum.domain.user.event.UserWithdrawnEvent;

/**
 * 회원 탈퇴 트랜잭션(탈퇴 설계 4장 흐름 A). {@code users} 행을 {@code FOR UPDATE}로 잠근 뒤 상태 전이·개인정보 비우기,
 * 소셜 연동·키트 프리셋·연주 녹음·텔레메트리 삭제, refresh 토큰 폐기, {@link UserWithdrawnEvent} 발행까지 한 트랜잭션에서 한다.
 *
 * <p>곡·파일·채보 작업 정리는 이벤트를 받는 쪽(BE2)이 커밋 뒤에 한다. 이 클래스가 {@code user}·{@code auth}·{@code preset}을
 * 모두 알아야 해서 {@code user} 패키지에 두지 않는다(순환 의존 방지). 각 데이터의 삭제는 소유 도메인에 위임한다.
 */
@Service
public class WithdrawalService {

	private static final Logger log = LoggerFactory.getLogger(WithdrawalService.class);

	private final UserWithdrawalService users;
	private final KitPresetService presets;
	private final RefreshTokenService refreshTokens;
	private final ApplicationEventPublisher events;
	private final RecordingService recordings;
	private final TelemetryBatchService telemetry;
	private final RecommendationService recommendations;
	private final RecommendationConsentService consent;

	public WithdrawalService(UserWithdrawalService users, KitPresetService presets,
			RefreshTokenService refreshTokens, ApplicationEventPublisher events, RecordingService recordings,
			TelemetryBatchService telemetry,
			RecommendationService recommendations, RecommendationConsentService consent) {
		this.users = users;
		this.presets = presets;
		this.refreshTokens = refreshTokens;
		this.events = events;
		this.recordings = recordings;
		this.telemetry = telemetry;
		this.recommendations = recommendations;
		this.consent = consent;
	}

	/**
	 * @throws UserNotActiveException 잠금을 얻고 보니 이미 탈퇴했다(동시 탈퇴에서 진 요청, U1). 이벤트는 발행하지 않는다
	 */
	@Transactional(timeout = 15)
	public void withdraw(long userId) {
		users.withdraw(userId);
		presets.deleteForWithdrawal(userId);
		int deletedRecordings = recordings.deleteForWithdrawal(userId);
		var deletedTelemetry = telemetry.deleteForWithdrawal(userId);
		recommendations.deleteUserData(userId);
		consent.recordWithdrawal(userId);
		revokeRefreshTokens(userId);
		events.publishEvent(new UserWithdrawnEvent(userId));
		log.info("회원 탈퇴 userId={} deletedRecordings={} deletedTelemetry={} deletedTelemetryConditions={}", userId,
				deletedRecordings, deletedTelemetry.events(), deletedTelemetry.conditions());
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
