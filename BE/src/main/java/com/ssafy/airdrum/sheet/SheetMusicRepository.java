package com.ssafy.airdrum.sheet;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Instant;
import java.util.List;
import java.util.Optional;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

import com.ssafy.airdrum.common.error.BusinessException;

/** sheet_music·sheet_music_pages SQL. 권한 판단은 owner_id 조건으로만 한다(남의 것은 없는 것과 같다). */
@Repository
class SheetMusicRepository {
	private static final String COLUMNS = "SELECT m.id,m.owner_id,m.title,m.source,m.kind,m.page_count,m.total_bytes,m.created_at,m.updated_at,m.song_id FROM sheet_music m";
	/** 페이지가 연결되기 전(업로드 중·실패) 행은 보여 주지 않는다. */
	private static final String VISIBLE = " m.owner_id=? AND m.deleted_at IS NULL AND EXISTS(SELECT 1 FROM sheet_music_pages p WHERE p.sheet_id=m.id)";

	record Row(long id, long ownerId, String title, String source, String kind, int pageCount, long totalBytes, Instant createdAt, Instant updatedAt,
			Long songId) {}

	record Page(int pageNo, String key, String contentType, long bytes, Integer width, Integer height) {}

	private final JdbcTemplate db;

	SheetMusicRepository(JdbcTemplate db) {
		this.db = db;
	}

	/** 업로드 동시 요청 사이의 상한 계산을 직렬화한다. 탈퇴 회원은 401 처리 전에 여기까지 오지 않지만 다시 막는다. */
	void lockOwner(long user) {
		if (db.queryForList("SELECT id FROM users WHERE id=? AND status='ACTIVE' FOR UPDATE", Long.class, user).isEmpty())
			throw new BusinessException(SheetError.SHEET_NOT_FOUND);
	}

	long liveCount(long user) {
		return db.queryForObject("SELECT count(*) FROM sheet_music WHERE owner_id=? AND deleted_at IS NULL", Long.class, user);
	}

	long liveBytes(long user) {
		return db.queryForObject("SELECT coalesce(sum(total_bytes),0) FROM sheet_music WHERE owner_id=? AND deleted_at IS NULL", Long.class, user);
	}

	/** 248: {@code songId}가 있으면 연결해 넣는다. 곡당 살아 있는 악보 하나는 부분 유일 인덱스가 보장한다(경합은 {@code DuplicateKeyException}). */
	long insert(long user, String title, String source, String kind, int pages, long bytes, Long songId) {
		return db.queryForObject("INSERT INTO sheet_music(owner_id,title,source,kind,page_count,total_bytes,song_id) VALUES(?,?,?,?,?,?,?) RETURNING id",
				Long.class, user, title, source, kind, pages, bytes, songId);
	}

	/** 248: 본인 소유·삭제 안 됨·공용(BUILTIN) 아님인 곡만 연결한다. 상태는 보지 않는다. 곡 삭제와 겹치지 않게 공유 잠금을 건다. */
	boolean ownSong(long user, long song) {
		return !db.queryForList("SELECT id FROM songs WHERE id=? AND owner_id=? AND deleted_at IS NULL AND source<>'BUILTIN' FOR SHARE", Long.class, song, user).isEmpty();
	}

	/** 248: 그 곡에 살아 있는 악보(페이지 연결 전 포함)가 있는지. */
	boolean linked(long song) {
		return !db.queryForList("SELECT id FROM sheet_music WHERE song_id=? AND deleted_at IS NULL", Long.class, song).isEmpty();
	}

	void insertPage(long sheet, Page page) {
		db.update("INSERT INTO sheet_music_pages(sheet_id,page_no,object_key,content_type,bytes,width,height) VALUES(?,?,?,?,?,?,?)",
				sheet, page.pageNo(), page.key(), page.contentType(), page.bytes(), page.width(), page.height());
	}

	/** 본인의 삭제되지 않은 악보를 잠근다. 페이지 연결 전 행도 잠근다(업로드 마무리 단계용). */
	boolean lockOwn(long user, long sheet) {
		return !db.queryForList("SELECT id FROM sheet_music WHERE id=? AND owner_id=? AND deleted_at IS NULL FOR UPDATE", Long.class, sheet, user).isEmpty();
	}

	void softDelete(long sheet) {
		db.update("UPDATE sheet_music SET deleted_at=clock_timestamp(),updated_at=clock_timestamp() WHERE id=?", sheet);
	}

	void rename(long sheet, String title) {
		db.update("UPDATE sheet_music SET title=?,updated_at=clock_timestamp() WHERE id=?", title, sheet);
	}

	/** 임시 정리 작업이 아직 실행 전이면 잠그고 true. 이미 정리가 시작됐으면 연결하지 않는다. */
	boolean temporaryAlive(String key) {
		return !db.queryForList("SELECT id FROM file_cleanup_tasks WHERE object_key=? AND file_role='SHEET_MUSIC' AND status='PENDING' AND next_attempt_at>clock_timestamp() FOR UPDATE",
				Long.class, key).isEmpty();
	}

	Optional<Row> find(long user, long sheet) {
		return db.query(COLUMNS + " WHERE m.id=? AND" + VISIBLE, this::row, sheet, user).stream().findFirst();
	}

	List<Row> page(long user, String pattern, int size, long offset) {
		return db.query(COLUMNS + " WHERE" + VISIBLE + " AND m.title ILIKE ? ESCAPE '!' ORDER BY m.created_at DESC, m.id DESC LIMIT ? OFFSET ?",
				this::row, user, pattern, size, offset);
	}

	long count(long user, String pattern) {
		return db.queryForObject("SELECT count(*) FROM sheet_music m WHERE" + VISIBLE + " AND m.title ILIKE ? ESCAPE '!'", Long.class, user, pattern);
	}

	List<Page> pages(long sheet) {
		return db.query("SELECT page_no,object_key,content_type,bytes,width,height FROM sheet_music_pages WHERE sheet_id=? ORDER BY page_no",
				(r, n) -> new Page(r.getInt(1), r.getString(2), r.getString(3), r.getLong(4), r.getObject(5, Integer.class), r.getObject(6, Integer.class)), sheet);
	}

	/** 목록 썸네일용 1쪽 키. 이미지 악보만 돌려준다. */
	Optional<String> firstImage(long sheet) {
		return db.queryForList("SELECT object_key FROM sheet_music_pages WHERE sheet_id=? AND page_no=1 AND content_type<>'application/pdf'", String.class, sheet)
				.stream().findFirst();
	}

	private Row row(ResultSet r, int n) throws SQLException {
		return new Row(r.getLong(1), r.getLong(2), r.getString(3), r.getString(4), r.getString(5), r.getInt(6), r.getLong(7),
				r.getTimestamp(8).toInstant(), r.getTimestamp(9).toInstant(), r.getObject(10, Long.class));
	}
}
