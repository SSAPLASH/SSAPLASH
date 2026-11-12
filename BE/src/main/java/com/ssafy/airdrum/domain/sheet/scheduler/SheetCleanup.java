package com.ssafy.airdrum.domain.sheet.scheduler;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

/** 내 악보 파일을 기존 정리 큐(file_cleanup_tasks, 역할 SHEET_MUSIC)에 등록한다. 실제 삭제는 워커 정리 작업자가 한다. */
@Component
public class SheetCleanup {
	private final JdbcTemplate db;

	SheetCleanup(JdbcTemplate db) {
		this.db = db;
	}

	/** 업로드 전에 등록한다. 5분 안에 페이지로 연결되지 않으면 정리 작업자가 지운다. */
	public void temporary(long user, String key) {
		db.update("""
				INSERT INTO file_cleanup_tasks(object_key,file_role,user_id,next_attempt_at)
				VALUES(?,'SHEET_MUSIC',?,clock_timestamp()+interval '5 minutes')
				""", key, user);
	}

	/** 악보 삭제·탈퇴 때 등록한다. 이미 있으면 바로 실행되도록 앞당긴다. */
	void now(long user, String key) {
		db.update("""
				INSERT INTO file_cleanup_tasks(object_key,file_role,user_id) VALUES(?,'SHEET_MUSIC',?)
				ON CONFLICT(object_key) DO UPDATE SET next_attempt_at=least(file_cleanup_tasks.next_attempt_at,clock_timestamp())
				""", key, user);
	}

	public void sheet(long user, long sheet) {
		db.queryForList("SELECT object_key FROM sheet_music_pages WHERE sheet_id=?", String.class, sheet).forEach(key -> now(user, key));
	}
}
