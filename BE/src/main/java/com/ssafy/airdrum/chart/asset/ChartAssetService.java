package com.ssafy.airdrum.chart.asset;

import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import org.springframework.stereotype.Service;
import com.ssafy.airdrum.chart.*;
import com.ssafy.airdrum.common.error.BusinessException;
import static com.ssafy.airdrum.chart.ChartResponses.*;

/** 스토리지 호출 동안 DB 트랜잭션을 열어 두지 않는다. 최종 권한은 별도 조회로 확인한다. */
@Service
public class ChartAssetService {
	private final ChartVersionRepository versions;
	private final ChartQueryAccess access;
	private final ChartDocumentReader documents;
	private final ChartAssetStore store;
	private final ChartAssetKeyPolicy keys;
	public ChartAssetService(ChartVersionRepository versions, ChartQueryAccess access, ChartDocumentReader documents,
			ChartAssetStore store, ChartAssetKeyPolicy keys) {
		this.versions = versions; this.access = access; this.documents = documents; this.store = store; this.keys = keys;
	}
	public ChartAssets assets(long userId, long versionId) {
		var row = authorized(userId, versionId);
		ChartDocumentReader.requireSchema(row.getSchemaVersion());
		List<ChartDocumentReader.StoredPage> pages;
		Timing timing = null;
		try {
			pages = documents.pages(row.getSheetPages());
			if (!pages.isEmpty()) timing = documents.timing(row.getTiming());
		} catch (IllegalStateException ex) {
			throw new BusinessException(ChartErrorCode.CHART_SHEET_TIMING_UNAVAILABLE);
		}
		// 모든 키와 시간 정보를 먼저 검사해 일부만 서명한 뒤 잘못된 키를 발견하는 일을 피한다.
		var bounds = new ArrayList<double[]>();
		for (var page : pages) {
			keys.sheet(versionId, page.imageKey());
			double from = documents.milliseconds(timing, page.fromTick());
			double to = documents.milliseconds(timing, page.toTick());
			if (to <= from) throw new BusinessException(ChartErrorCode.CHART_SHEET_TIMING_UNAVAILABLE);
			bounds.add(new double[] {from, to});
		}
		if (row.getAccompanimentKey() != null) {
			if (!"AUDIO".equals(row.getSource())) throw new IllegalStateException("반주 출처가 올바르지 않습니다.");
			keys.accompaniment(row.getSongId(), row.getAccompanimentKey());
		}
		Instant expiration = null;
		var responsePages = new ArrayList<SheetPage>();
		for (int i = 0; i < pages.size(); i++) {
			var p = pages.get(i);
			var signed = store.sign(ChartAssetStore.Kind.SHEET, p.imageKey());
			expiration = earliest(expiration, signed.expiresAt());
			responsePages.add(new SheetPage(p.page(), signed.url(), p.fromTick(), p.toTick(), bounds.get(i)[0], bounds.get(i)[1]));
		}
		String accompaniment = null;
		if (row.getAccompanimentKey() != null) {
			var signed = store.sign(ChartAssetStore.Kind.ACCOMPANIMENT, row.getAccompanimentKey());
			accompaniment = signed.url();
			expiration = earliest(expiration, signed.expiresAt());
		}
		authorized(userId, versionId);
		return new ChartAssets(versionId, row.getNotationStatus(), List.copyOf(responsePages), accompaniment, expiration);
	}
	private ChartVersionRepository.Assets authorized(long userId, long versionId) {
		access.requireActive(userId);
		var row = versions.assets(versionId, userId)
				.orElseThrow(() -> new BusinessException(ChartErrorCode.CHART_VERSION_NOT_FOUND));
		ChartQueryAccess.requireReady(row.getStatus());
		return row;
	}
	private static Instant earliest(Instant current, Instant next) {
		return current == null || next.isBefore(current) ? next : current;
	}
}
