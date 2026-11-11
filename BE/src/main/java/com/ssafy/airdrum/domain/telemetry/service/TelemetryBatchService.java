package com.ssafy.airdrum.domain.telemetry.service;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.annotation.Propagation;
import com.ssafy.airdrum.domain.telemetry.dto.TelemetryBatchRequest;
import com.ssafy.airdrum.domain.telemetry.repository.TelemetryEventRepository;
import com.ssafy.airdrum.domain.telemetry.repository.TelemetrySessionConditionsRepository;

/**
 * 검증된 배치 전체를 한 트랜잭션으로 저장한다. 한 행이라도 실패하면 모두 롤백한다. 259 조건이 붙은 배치는 조건 행도 같은 트랜잭션에서
 * 바꾸므로, 조건만 남고 이벤트가 롤백되는 상태는 없다.
 */
@Service
public class TelemetryBatchService {
	public record Deleted(int events, int conditions) {}

	private final TelemetryEventRepository events;
	private final TelemetrySessionConditionsRepository conditions;

	public TelemetryBatchService(TelemetryEventRepository events, TelemetrySessionConditionsRepository conditions) {
		this.events = events;
		this.conditions = conditions;
	}
	/** 탈퇴 트랜잭션에서 이벤트 다음 실험 조건을 지운다. */
	@Transactional(propagation = Propagation.MANDATORY)
	public Deleted deleteForWithdrawal(long userId) {
		return new Deleted(events.deleteAllByUserId(userId), conditions.deleteAllByUserId(userId));
	}

	@Transactional(timeout = 15)
	public int save(long userId, TelemetryBatchRequest batch) {
		events.insert(userId, batch);
		if (batch.conditions() != null) conditions.upsert(userId, batch.sessionId(), batch.conditions());
		return batch.events().size();
	}

}
