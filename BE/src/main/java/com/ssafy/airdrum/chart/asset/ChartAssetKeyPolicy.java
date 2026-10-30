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
                && !key.matches("accompaniment/" + songId + "/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\.flac")
                && !key.matches("accompaniment/" + songId + "/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\.(wav|mp3)")) reject();
	}
	public void cover(long userId, long songId, String key) {
        requireSafe(key);
        if (!key.matches("cover/" + userId + "/" + songId + "/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\.(jpg|png|webp)")) reject();
    }
	/** 공용 곡 커버(156번). 소유자가 없어 회원 ID 대신 builtin을 쓴다. */
	public void builtinCover(long songId, String key) {
		requireSafe(key);
		if (!key.matches("cover/builtin/" + songId + "/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\.(jpg|png|webp)")) reject();
	}
	/** 내 악보(155번). 곡과 무관하게 회원·악보 단위로 둔다. */
	public void sheetMusic(long userId, long sheetId, String key) {
		requireSafe(key);
		if (!key.matches("sheet-music/" + userId + "/" + sheetId + "/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\.(jpg|png|webp|pdf)")) reject();
	}
	private void requireSafe(String key) {
		if (key == null || key.length() > 300 || key.contains("..") || key.contains("%") || key.contains("\\")) reject();
	}
	private static void reject() { throw new IllegalStateException("등록된 자산의 귀속 정보가 올바르지 않습니다."); }
}
