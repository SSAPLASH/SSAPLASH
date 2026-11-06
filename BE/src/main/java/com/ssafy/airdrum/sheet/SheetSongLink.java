package com.ssafy.airdrum.sheet;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

/**
 * 248 내 악보와 개인 곡 연결 중 다른 패키지가 부르는 부분. {@code song → sheet} 한 방향이며 {@code sheet}는 {@code song}을 import하지 않는다.
 * 곡 삭제(소프트)는 {@code song.SongManagementService}가 하고, 연결된 악보 정리만 여기서 한다.
 */
@Component
public class SheetSongLink {
	private final JdbcTemplate db;
	private final SheetMusicRepository sheets;
	private final SheetCleanup cleanup;

	SheetSongLink(JdbcTemplate db, SheetMusicRepository sheets, SheetCleanup cleanup) {
		this.db = db;
		this.sheets = sheets;
		this.cleanup = cleanup;
	}

	/**
	 * 그 곡에 연결된 살아 있는 악보를 소프트 삭제하고 페이지 파일을 바로 정리 대상으로 등록한다(악보 DELETE와 같은 처리).
	 * 곡 삭제 트랜잭션 안에서 부른다. 실패하면 곡 삭제도 같이 롤백된다. 페이지 연결 전(업로드 중) 행도 지운다.
	 */
	public void deleteLinked(long user, long song) {
		for (long sheet : db.queryForList("SELECT id FROM sheet_music WHERE song_id=? AND owner_id=? AND deleted_at IS NULL FOR UPDATE", Long.class, song, user)) {
			sheets.softDelete(sheet);
			cleanup.sheet(user, sheet);
		}
	}
}
