package com.ssafy.airdrum.domain.chart.event;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;
import org.springframework.transaction.event.TransactionPhase;
import org.springframework.transaction.event.TransactionalEventListener;
import com.ssafy.airdrum.domain.chart.service.feature.ChartFeatureService;

/** 채보·난이도 저장이 커밋된 뒤에 특징을 계산한다. 실패해도 이미 커밋된 저장에는 영향이 없다. */
@Component
class ChartFeatureListener {
	private static final Logger log = LoggerFactory.getLogger(ChartFeatureListener.class);
	private final ChartFeatureService features;
	ChartFeatureListener(ChartFeatureService features) { this.features = features; }

	@TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
	void changed(SongChartsChanged event) {
		try { features.computeForSong(event.songId()); }
		catch (RuntimeException ex) { log.warn("채보 특징 계산 실패 songId={} errorType={}", event.songId(), ex.getClass().getSimpleName()); }
	}
}
