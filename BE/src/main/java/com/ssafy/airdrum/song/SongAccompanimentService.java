package com.ssafy.airdrum.song;

import java.util.Objects;
import org.springframework.stereotype.Service;
import com.ssafy.airdrum.chart.ChartErrorCode;
import com.ssafy.airdrum.chart.ChartQueryAccess;
import com.ssafy.airdrum.chart.asset.ChartAssetKeyPolicy;
import com.ssafy.airdrum.chart.asset.ChartAssetStore;
import com.ssafy.airdrum.common.error.BusinessException;

/** 스토리지 호출 중 DB 트랜잭션을 열지 않고 서명 전후에 권한을 확인한다. */
@Service
public class SongAccompanimentService {
	private final SongRepository songs;
	private final ChartQueryAccess access;
	private final ChartAssetKeyPolicy keys;
	private final ChartAssetStore store;
	public SongAccompanimentService(SongRepository songs, ChartQueryAccess access, ChartAssetKeyPolicy keys, ChartAssetStore store) {
		this.songs = songs; this.access = access; this.keys = keys; this.store = store;
	}
	public SongResponses.Accompaniment get(long userId, long songId) {
		var song = authorized(userId, songId);
		String key = song.getAccompanimentKey();
		if (key == null) return new SongResponses.Accompaniment(null, null);
		if (!"AUDIO".equals(song.getSource()) && !"BUILTIN".equals(song.getSource()) && !"MIDI".equals(song.getSource()))
			throw new IllegalStateException("반주 출처가 올바르지 않습니다.");
		keys.accompaniment(songId, key);
		var signed = store.sign(ChartAssetStore.Kind.ACCOMPANIMENT, key);
		var current = authorized(userId, songId);
		if (!Objects.equals(key, current.getAccompanimentKey())) throw new BusinessException(ChartErrorCode.CHART_ASSET_UNAVAILABLE);
		return new SongResponses.Accompaniment(signed.url(), signed.expiresAt());
	}
	private SongRepository.AccompanimentView authorized(long userId, long songId) {
		access.requireActive(userId);
		var song = songs.visibleAccompaniment(songId, userId)
				.orElseThrow(() -> new BusinessException(ChartErrorCode.SONG_NOT_FOUND));
		ChartQueryAccess.requireReady(song.getStatus());
		return song;
	}
}
