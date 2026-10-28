package com.ssafy.airdrum.telemetry;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.UUID;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Isolation;
import org.springframework.transaction.annotation.Transactional;

import com.ssafy.airdrum.common.error.BusinessException;
import com.ssafy.airdrum.common.error.CommonErrorCode;
import com.ssafy.airdrum.common.response.PageResponse;
import com.ssafy.airdrum.telemetry.TelemetryBatchRequest.Kind;
import com.ssafy.airdrum.telemetry.TelemetryResponses.EventItem;
import com.ssafy.airdrum.telemetry.TelemetryResponses.SessionSummary;

/** ADMIN 조회. 목록과 건수가 같은 스냅샷을 보도록 한 트랜잭션에서 읽는다. */
@Service
@Transactional(readOnly = true, isolation = Isolation.REPEATABLE_READ)
public class TelemetryQueryService {

	static final Duration DEFAULT_RANGE = Duration.ofDays(7);
	static final Duration MAX_RANGE = Duration.ofDays(31);

	private final TelemetryEventRepository events;
	private final Clock clock;

	public TelemetryQueryService(TelemetryEventRepository events, Clock clock) {
		this.events = events;
		this.clock = clock;
	}

	/** 기간을 안 주면 지금까지 최근 7일. 최대 31일(설계 U3). */
	public PageResponse<SessionSummary> sessions(Instant from, Instant to, Long userId, int page, int size) {
		var end = to != null ? to : clock.instant();
		var start = from != null ? from : end.minus(DEFAULT_RANGE);
		if (start.isAfter(end)) {
			throw new BusinessException(CommonErrorCode.VALIDATION_FAILED, "from은 to보다 늦을 수 없습니다.");
		}
		if (Duration.between(start, end).compareTo(MAX_RANGE) > 0) {
			throw new BusinessException(CommonErrorCode.VALIDATION_FAILED, "조회 기간은 31일 이하여야 합니다.");
		}
		var total = events.countSessions(start, end, userId);
		return PageResponse.of(events.sessions(start, end, userId, offset(page, size), size), page, size, total);
	}

	public PageResponse<EventItem> events(long userId, UUID sessionId, Kind kind, int page, int size) {
		var total = events.countEvents(userId, sessionId, kind);
		return PageResponse.of(events.events(userId, sessionId, kind, offset(page, size), size), page, size, total);
	}

	/** page 상한이 없으므로 int 곱셈 넘침을 막는다. */
	private static int offset(int page, int size) {
		return (int) Math.min((long) page * size, Integer.MAX_VALUE);
	}

}
