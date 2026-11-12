package com.ssafy.airdrum.domain.chart.service.query;

import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import com.ssafy.airdrum.domain.chart.exception.ChartErrorCode;
import com.ssafy.airdrum.domain.chart.model.ChartDocumentReader;
import com.ssafy.airdrum.domain.chart.repository.ChartVersionRepository;
import com.ssafy.airdrum.global.error.BusinessException;
import com.ssafy.airdrum.domain.chart.dto.ChartResponses.ChartDetail;
import com.ssafy.airdrum.domain.chart.dto.ChartResponses.ChartSummary;

@Service
@Transactional(readOnly = true)
public class ChartQueryService {
	private final ChartVersionRepository versions;
	private final ChartQueryAccess access;
	private final ChartDocumentReader documents;
	public ChartQueryService(ChartVersionRepository versions, ChartQueryAccess access, ChartDocumentReader documents) {
		this.versions = versions; this.access = access; this.documents = documents;
	}
	/** 보이는 READY 곡의 최신 채보를 곡별로 모아 중복 난이도를 제외한다. */
	public Map<Long, List<ChartSummary>> summaries(long userId, List<Long> songIds) {
		if (songIds.isEmpty()) return Map.of();
		return versions.summaries(songIds, userId).stream()
				.collect(Collectors.groupingBy(ChartVersionRepository.Summary::getSongId,
						Collectors.collectingAndThen(Collectors.toList(), ChartQueryService::distinctSummaries)));
	}
	/** NORMAL과 노트 수가 같은 EASY/HARD만 표시에서 제외한다. */
	private static List<ChartSummary> distinctSummaries(List<ChartVersionRepository.Summary> rows) {
		var normal = rows.stream().filter(c -> "NORMAL".equals(c.getDifficulty())).findFirst().orElse(null);
		return rows.stream().filter(c -> normal == null || c == normal || c.getNoteCount() != normal.getNoteCount())
				.map(v -> new ChartSummary(v.getChartId(), v.getDifficulty(), v.getChartVersionId(), v.getVersion(),
						v.getNoteCount(), v.getNotationStatus())).toList();
	}
	public ChartDetail latest(long userId, long chartId) {
		access.requireActive(userId);
		var row = versions.latest(chartId, userId).orElseThrow(() -> new BusinessException(ChartErrorCode.CHART_NOT_FOUND));
		ChartQueryAccess.requireReady(row.getStatus());
		return documents.detail(row);
	}
	public ChartDetail version(long userId, long versionId) {
		access.requireActive(userId);
		var row = versions.version(versionId, userId)
				.orElseThrow(() -> new BusinessException(ChartErrorCode.CHART_VERSION_NOT_FOUND));
		ChartQueryAccess.requireReady(row.getStatus());
		return documents.detail(row);
	}
}
