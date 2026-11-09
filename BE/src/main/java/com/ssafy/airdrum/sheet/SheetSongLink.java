package com.ssafy.airdrum.sheet;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

/**
 * 내 악보와 개인 곡 연결(248·333번) 중 다른 패키지가 부르는 부분. {@code song → sheet} 한 방향이며 {@code sheet}는 {@code song}을 import하지 않는다.
 * 곡 삭제(소프트)는 {@code song.SongManagementService}가 하고, 연결 해제만 여기서 한다.
 */
@Component
public class SheetSongLink {
	private final JdbcTemplate db;

	SheetSongLink(JdbcTemplate db) {
		this.db = db;
	}

	/**
	 * 그 곡에 연결된 살아 있는 악보의 연결만 끊는다(333번: 11/06 "같이 소프트 삭제"에서 변경). 악보 행과 페이지 파일은 그대로 두고
	 * 정리 큐에도 올리지 않으므로, 악보는 곡 없는 악보로 다시 보인다. 페이지 연결 전(업로드 중) 행도 끊는다.
	 * 곡 삭제 트랜잭션 안에서 부른다. 실패하면 곡 삭제도 같이 롤백된다.
	 */
	public void unlinkAll(long user, long song) {
		db.update("UPDATE sheet_music SET song_id=NULL,updated_at=clock_timestamp() WHERE song_id=? AND owner_id=? AND deleted_at IS NULL", song, user);
	}
}
