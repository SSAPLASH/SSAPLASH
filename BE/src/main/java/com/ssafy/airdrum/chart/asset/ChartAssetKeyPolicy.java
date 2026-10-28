package com.ssafy.airdrum.chart.asset;

import org.springframework.stereotype.Component;

/** 92번 키 규칙. DB 값이라도 다른 자원·임시 파일을 가리키면 서명하지 않는다. */
@Component
public class ChartAssetKeyPolicy {
	public void sheet(long versionId, String key) {
		requireSafe(key);
		if (!key.matches("sheet/" + versionId + "/[A-Za-z0-9_-]+\\.(png|jpg|jpeg|webp)")) reject();
	}
	public void accompaniment(long songId, String key) {
		requireSafe(key);
		if (!key.matches("accompaniment/" + songId + "\\.(wav|mp3|ogg|flac|m4a)")
                && !key.matches("accompaniment/" + songId + "/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\.flac")) reject();
	}
	private void requireSafe(String key) {
		if (key == null || key.length() > 300 || key.contains("..") || key.contains("%") || key.contains("\\")) reject();
	}
	private static void reject() { throw new IllegalStateException("등록된 자산의 귀속 정보가 올바르지 않습니다."); }
}
