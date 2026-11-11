package com.ssafy.airdrum.domain.chart.scheduler;

import java.util.HashSet;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.stereotype.Component;
import com.ssafy.airdrum.domain.chart.service.feature.ChartFeatureService;

/**
 * 앱이 준비되면 특징이 없는 기존 채보를 채운다. 배포만 하면 기존 곡도 추천 후보가 된다.
 * 어떤 실패도 앱 시작을 막지 않는다. {@code chart-features.backfill.enabled=false}면 하지 않는다(테스트 기본값).
 */
@Component
@ConditionalOnWebApplication(type = ConditionalOnWebApplication.Type.SERVLET)
@ConditionalOnProperty(name = "chart-features.backfill.enabled", havingValue = "true", matchIfMissing = true)
class ChartFeatureBackfillStartup {
	private static final Logger log = LoggerFactory.getLogger(ChartFeatureBackfillStartup.class);
	private static final int BATCH = 200;
	private final ChartFeatureService features;
	ChartFeatureBackfillStartup(ChartFeatureService features) { this.features = features; }

	@EventListener(ApplicationReadyEvent.class)
	void backfill() {
		try {
			int songs = 0, charts = 0;
			// 계산할 수 없는 채보는 계속 "없음"으로 남으므로, 이미 돌린 곡만 나오면 멈춘다.
			var seen = new HashSet<Long>();
			while (true) {
				var ids = features.songsMissingFeatures(BATCH).stream().filter(seen::add).toList();
				if (ids.isEmpty()) break;
				for (long id : ids) { charts += features.computeForSong(id); songs++; }
			}
			log.info("채보 특징 백필 곡 {}개, 저장 {}개", songs, charts);
		} catch (RuntimeException ex) {
			log.warn("채보 특징 백필 중단 errorType={}", ex.getClass().getSimpleName(), ex);
		}
	}
}
