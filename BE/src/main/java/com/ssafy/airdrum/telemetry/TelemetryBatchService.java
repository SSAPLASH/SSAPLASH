package com.ssafy.airdrum.telemetry;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** 검증된 배치 전체를 한 트랜잭션으로 저장한다. 한 행이라도 실패하면 모두 롤백한다. */
@Service
public class TelemetryBatchService {

	private final TelemetryEventRepository events;

	public TelemetryBatchService(TelemetryEventRepository events) {
		this.events = events;
	}

	@Transactional(timeout = 15)
	public int save(long userId, TelemetryBatchRequest batch) {
		events.insert(userId, batch);
		return batch.events().size();
	}

}
