package com.ssafy.airdrum.chart;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import com.ssafy.airdrum.common.error.BusinessException;
import com.ssafy.airdrum.chart.ChartResponses.ChartDetail;

@Service
@Transactional(readOnly = true)
public class ChartQueryService {
	private final ChartVersionRepository versions;
	private final ChartQueryAccess access;
	private final ChartDocumentReader documents;
	public ChartQueryService(ChartVersionRepository versions, ChartQueryAccess access, ChartDocumentReader documents) {
		this.versions = versions; this.access = access; this.documents = documents;
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
