package com.ssafy.airdrum.chart;

import org.springframework.stereotype.Component;
import com.ssafy.airdrum.common.error.BusinessException;
import com.ssafy.airdrum.common.error.CommonErrorCode;
import com.ssafy.airdrum.song.SongRepository;

/** 외부 파일 작업 뒤에도 DB에서 회원 상태를 새로 확인한다. */
@Component
public class ChartQueryAccess {
	private final SongRepository songs;
	public ChartQueryAccess(SongRepository songs) { this.songs = songs; }
	public void requireActive(long userId) {
		if (userId <= 0 || !songs.isActive(userId)) throw new BusinessException(CommonErrorCode.UNAUTHORIZED);
	}
	public static void requireReady(String status) {
		if (!"READY".equals(status)) throw new BusinessException(ChartErrorCode.SONG_NOT_READY);
	}
}
