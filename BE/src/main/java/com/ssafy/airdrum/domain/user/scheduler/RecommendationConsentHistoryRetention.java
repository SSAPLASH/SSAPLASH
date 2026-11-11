package com.ssafy.airdrum.domain.user.scheduler;

import java.time.Clock;
import java.time.Duration;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import com.ssafy.airdrum.domain.user.service.consent.RecommendationConsentService;

/** 철회·탈퇴일부터 보관 기간(기본 2년)이 지난 추천 동의 이력을 하루에 한 번 지운다. 실패해도 다음 주기에 다시 지운다. */
@Component
class RecommendationConsentHistoryRetention {

	private static final Logger log = LoggerFactory.getLogger(RecommendationConsentHistoryRetention.class);

	private final RecommendationConsentService service;
	private final Clock clock;
	private final int days;

	RecommendationConsentHistoryRetention(RecommendationConsentService service, Clock clock,
			@Value("${recommend.consent-history-retention-days:730}") int days) {
		this.service = service;
		this.clock = clock;
		this.days = Math.max(1, days);
	}

	@Scheduled(fixedDelayString = "${recommend.consent-history-retention-interval-ms:86400000}",
			initialDelayString = "${recommend.consent-history-retention-interval-ms:86400000}")
	void purge() {
		try {
			int deleted = service.deleteHistoryBefore(clock.instant().minus(Duration.ofDays(days)));
			if (deleted > 0) log.info("추천 동의 이력 보관 기간 정리 {}건", deleted);
		} catch (RuntimeException ex) {
			log.warn("추천 동의 이력 정리 실패 errorType={}", ex.getClass().getSimpleName());
		}
	}

}
