package com.ssafy.airdrum.domain.chart.storage;

import java.time.Instant;

/** DB에서 권한과 귀속을 검증한 키만 전달한다. 실제 파일 확인과 GET 서명은 어댑터 책임이다. */
public interface ChartAssetStore {
	SignedAsset sign(Kind kind, String key);
	enum Kind { SHEET, ACCOMPANIMENT }
	record SignedAsset(String url, Instant expiresAt) {}
}
