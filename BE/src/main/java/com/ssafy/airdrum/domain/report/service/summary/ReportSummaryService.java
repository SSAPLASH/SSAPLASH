package com.ssafy.airdrum.domain.report.service.summary;

import java.util.UUID;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import com.ssafy.airdrum.domain.report.event.AnalysisRequested;
import com.ssafy.airdrum.domain.report.model.ReportAggregate;
import com.ssafy.airdrum.domain.report.model.ReportSummaryInput;
import com.ssafy.airdrum.domain.report.repository.ReportRepository;

@Service
public class ReportSummaryService {
	private final ReportAggregator aggregator;
	private final ReportRepository reports;
	private final ApplicationEventPublisher events;
	public ReportSummaryService(ReportAggregator aggregator, ReportRepository reports, ApplicationEventPublisher events) {
		this.aggregator = aggregator; this.reports = reports; this.events = events;
	}
	/** 검증 직후 트랜잭션 밖에서 집계한다. */
	public ReportAggregate aggregate(ReportSummaryInput input) { return aggregator.aggregate(input); }
	/** 세션과 hits를 저장한 트랜잭션에 참여한다. */
	@Transactional(propagation = Propagation.MANDATORY)
	public void save(UUID playId, ReportAggregate report) {
		reports.insert(playId, report);
		events.publishEvent(new AnalysisRequested(playId));
	}
}
