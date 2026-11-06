package com.ssafy.airdrum.telemetry;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * 검증된 배치 전체를 한 트랜잭션으로 저장한다. 한 행이라도 실패하면 모두 롤백한다. 259 조건이 붙은 배치는 조건 행도 같은 트랜잭션에서
 * 바꾸므로, 조건만 남고 이벤트가 롤백되는 상태는 없다.
 */
@Service
public class TelemetryBatchService {

	private final TelemetryEventRepository events;
	private final TelemetrySessionConditionsRepository conditions;

	public TelemetryBatchService(TelemetryEventRepository events, TelemetrySessionConditionsRepository conditions) {
		this.events = events;
		this.conditions = conditions;
	}

	@Transactional(timeout = 15)
	public int save(long userId, TelemetryBatchRequest batch) {
		events.insert(userId, batch);
		if (batch.conditions() != null) conditions.upsert(userId, batch.sessionId(), batch.conditions());
		return batch.events().size();
	}

}
