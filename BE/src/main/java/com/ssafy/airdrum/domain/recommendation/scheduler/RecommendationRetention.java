package com.ssafy.airdrum.domain.recommendation.scheduler;

import java.time.Clock;
import java.time.Duration;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import com.ssafy.airdrum.domain.recommendation.service.RecommendationService;

/** 보관 기간(기본 90일)이 지난 추천 노출·클릭 기록을 하루에 한 번 지운다. 실패해도 다음 주기에 다시 한다. */
@Component
class RecommendationRetention {
	private static final Logger log = LoggerFactory.getLogger(RecommendationRetention.class);
	private final RecommendationService service;
	private final Clock clock;
	private final int days;

	RecommendationRetention(RecommendationService service, Clock clock, @Value("${recommendation.retention-days:90}") int days) {
		this.service = service; this.clock = clock; this.days = Math.max(1, days);
	}

	@Scheduled(fixedDelayString = "${recommendation.retention-interval-ms:86400000}", initialDelayString = "${recommendation.retention-interval-ms:86400000}")
	void purge() {
		try {
			int deleted = service.deleteOlderThan(clock.instant().minus(Duration.ofDays(days)));
			if (deleted > 0) log.info("추천 기록 보관 기간 정리 {}건", deleted);
		} catch (RuntimeException ex) {
			log.warn("추천 기록 정리 실패 errorType={}", ex.getClass().getSimpleName());
		}
	}
}
