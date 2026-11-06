package com.ssafy.airdrum.song.recommend;

import java.time.Clock;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/**
 * 생성 후 보관 기간(기본 7일)이 지난 추천 후보를 한 시간에 한 번 지운다. 배치가 멈추거나 새 후보를 못 받은 사용자의 행이 남지 않게 한다.
 * 삭제가 실패해도 서빙은 만료 후보를 쓰지 않고, 다음 주기에 다시 지운다.
 */
@Component
class RecommendationCandidateRetention {
	private static final Logger log = LoggerFactory.getLogger(RecommendationCandidateRetention.class);
	private final RecommendationCandidateService service;
	private final Clock clock;

	RecommendationCandidateRetention(RecommendationCandidateService service, Clock clock) {
		this.service = service; this.clock = clock;
	}

	@Scheduled(fixedDelayString = "${recommend.r3.retention-interval-ms:3600000}", initialDelayString = "${recommend.r3.retention-interval-ms:3600000}")
	void purge() {
		try {
			int deleted = service.deleteExpired(clock.instant());
			if (deleted > 0) log.info("추천 후보 보관 기간 정리 {}건", deleted);
		} catch (RuntimeException ex) {
			log.warn("추천 후보 정리 실패 errorType={}", ex.getClass().getSimpleName());
		}
	}
}
