package com.ssafy.airdrum.sheet;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.jdbc.core.JdbcTemplate;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/** 155번 설계 3절: V23 악보 보관 테이블과 정리 역할. */
// 기본 컨텍스트는 마이그레이션 테스트가 풀 연결의 search_path를 바꿔 둘 수 있어, 정리 큐 테스트와 같은 격리 컨텍스트를 쓴다.
@SpringBootTest(properties = {"auth.jwt.secret=test-only-jwt-secret-0123456789ab", "auth.refresh-token.store=memory", "chart.worker.cleanup-interval-ms=86400000"})
class SheetMusicSchemaTest {

	@Autowired JdbcTemplate db;
	long user;
	long song;

	@BeforeEach
	void seed() {
		user = db.queryForObject("INSERT INTO users(nickname) VALUES('악보 스키마 회원') RETURNING id", Long.class);
		song = db.queryForObject("INSERT INTO songs(owner_id,title,source,status) VALUES(?,'연결 곡','MIDI','READY') RETURNING id", Long.class, user);
	}

	@AfterEach
	void clean() {
		db.update("DELETE FROM file_cleanup_tasks WHERE object_key LIKE 'sheet/%'");
		db.update("DELETE FROM sheet_music WHERE owner_id=?", user);
		db.update("DELETE FROM songs WHERE id=?", song);
		db.update("DELETE FROM users WHERE id=?", user);
	}

	/** 248 V44: 곡당 살아 있는 악보는 하나다. 소프트 삭제하면 자리가 비고, 곡 없는 악보는 제한이 없다. */
	@Test
	void V44_곡당_살아_있는_악보는_하나이고_지운_뒤에는_다시_연결된다() {
		long first = insertLinked("첫 악보", song);
		assertThat(db.queryForObject("SELECT song_id FROM sheet_music WHERE id=?", Long.class, first)).isEqualTo(song);
		assertThatThrownBy(() -> insertLinked("둘째 악보", song)).isInstanceOf(DataIntegrityViolationException.class);
		db.update("UPDATE sheet_music SET deleted_at=now() WHERE id=?", first);
		long second = insertLinked("둘째 악보", song);
		assertThat(second).isNotEqualTo(first);
		// 곡 없는 악보는 여러 개여도 된다
		insertSheet("곡 없음 1", "UPLOADED", "IMAGE", 1, 1);
		insertSheet("곡 없음 2", "UPLOADED", "IMAGE", 1, 1);
		// 없는 곡은 FK로 막는다
		assertThatThrownBy(() -> insertLinked("없는 곡", 999_999_999L)).isInstanceOf(DataIntegrityViolationException.class);
		assertThat(db.queryForObject("SELECT count(*) FROM sheet_music WHERE owner_id=? AND deleted_at IS NULL", Integer.class, user)).isEqualTo(3);
	}

	private long insertLinked(String title, long songId) {
		return db.queryForObject("INSERT INTO sheet_music(owner_id,title,source,kind,page_count,total_bytes,song_id) VALUES(?,?,'UPLOADED','IMAGE',1,1,?) RETURNING id",
				Long.class, user, title, songId);
	}

	@Test
	void 악보와_페이지를_저장하고_삭제하면_페이지도_지운다() {
		long sheet = insertSheet("연습 악보", "UPLOADED", "IMAGE", 2, 300);
		db.update("INSERT INTO sheet_music_pages(sheet_id,page_no,object_key,content_type,bytes,width,height) VALUES(?,1,?,'image/png',100,800,1200)", sheet, "sheet/" + user + "/" + sheet + "/a.png");
		db.update("INSERT INTO sheet_music_pages(sheet_id,page_no,object_key,content_type,bytes,width,height) VALUES(?,2,?,'image/png',200,800,1200)", sheet, "sheet/" + user + "/" + sheet + "/b.png");
		long pdf = insertSheet("PDF 악보", "RENDERED", "PDF", 1, 500);
		db.update("INSERT INTO sheet_music_pages(sheet_id,page_no,object_key,content_type,bytes) VALUES(?,1,?,'application/pdf',500)", pdf, "sheet/" + user + "/" + pdf + "/c.pdf");

		assertThat(db.queryForObject("SELECT count(*) FROM sheet_music_pages WHERE sheet_id=?", Integer.class, sheet)).isEqualTo(2);
		assertThat(db.queryForObject("SELECT deleted_at IS NULL AND created_at IS NOT NULL AND updated_at IS NOT NULL FROM sheet_music WHERE id=?", Boolean.class, sheet)).isTrue();
		db.update("DELETE FROM sheet_music WHERE id=?", sheet);
		assertThat(db.queryForObject("SELECT count(*) FROM sheet_music_pages WHERE sheet_id=?", Integer.class, sheet)).isZero();
	}

	@Test
	void 잘못된_값은_CHECK로_막는다() {
		assertThatThrownBy(() -> insertSheet("  ", "UPLOADED", "IMAGE", 1, 1)).isInstanceOf(DataIntegrityViolationException.class);
		assertThatThrownBy(() -> insertSheet("x".repeat(101), "UPLOADED", "IMAGE", 1, 1)).isInstanceOf(DataIntegrityViolationException.class);
		assertThatThrownBy(() -> insertSheet("악보", "SCANNED", "IMAGE", 1, 1)).isInstanceOf(DataIntegrityViolationException.class);
		assertThatThrownBy(() -> insertSheet("악보", "UPLOADED", "GIF", 1, 1)).isInstanceOf(DataIntegrityViolationException.class);
		assertThatThrownBy(() -> insertSheet("악보", "UPLOADED", "IMAGE", 0, 1)).isInstanceOf(DataIntegrityViolationException.class);
		assertThatThrownBy(() -> insertSheet("악보", "UPLOADED", "IMAGE", 21, 1)).isInstanceOf(DataIntegrityViolationException.class);
		assertThatThrownBy(() -> insertSheet("악보", "UPLOADED", "PDF", 2, 1)).isInstanceOf(DataIntegrityViolationException.class);
		assertThatThrownBy(() -> insertSheet("악보", "UPLOADED", "IMAGE", 1, -1)).isInstanceOf(DataIntegrityViolationException.class);

		long sheet = insertSheet("악보", "UPLOADED", "IMAGE", 1, 1);
		String key = "sheet/" + user + "/" + sheet + "/a.png";
		db.update("INSERT INTO sheet_music_pages(sheet_id,page_no,object_key,content_type,bytes) VALUES(?,1,?,'image/png',1)", sheet, key);
		assertThatThrownBy(() -> db.update("INSERT INTO sheet_music_pages(sheet_id,page_no,object_key,content_type,bytes) VALUES(?,2,?,'image/png',1)", sheet, key))
				.isInstanceOf(DataIntegrityViolationException.class);
		assertThatThrownBy(() -> db.update("INSERT INTO sheet_music_pages(sheet_id,page_no,object_key,content_type,bytes) VALUES(?,0,?,'image/png',1)", sheet, key + "0"))
				.isInstanceOf(DataIntegrityViolationException.class);
		assertThatThrownBy(() -> db.update("INSERT INTO sheet_music_pages(sheet_id,page_no,object_key,content_type,bytes) VALUES(?,3,?,'image/gif',1)", sheet, key + "3"))
				.isInstanceOf(DataIntegrityViolationException.class);
	}

	@Test
	void 정리_큐는_SHEET_MUSIC_역할을_받는다() {
		db.update("INSERT INTO file_cleanup_tasks(object_key,file_role,user_id) VALUES(?, 'SHEET_MUSIC', ?)", "sheet/" + user + "/1/x.png", user);
		assertThat(db.queryForObject("SELECT file_role FROM file_cleanup_tasks WHERE object_key=?", String.class, "sheet/" + user + "/1/x.png")).isEqualTo("SHEET_MUSIC");
	}

	private long insertSheet(String title, String source, String kind, int pages, long bytes) {
		return db.queryForObject("INSERT INTO sheet_music(owner_id,title,source,kind,page_count,total_bytes) VALUES(?,?,?,?,?,?) RETURNING id",
				Long.class, user, title, source, kind, pages, bytes);
	}
}
