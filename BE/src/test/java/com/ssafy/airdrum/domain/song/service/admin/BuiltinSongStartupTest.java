package com.ssafy.airdrum.domain.song.service.admin;

import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;

import static org.assertj.core.api.Assertions.assertThat;

/** 254번: builtin-songs.seed.enabled=true면 앱이 켜질 때 카탈로그 곡을 등록한다(테스트 카탈로그 위치로 바꿔 검사). */
@SpringBootTest(properties = {"builtin-songs.seed.enabled=true", "builtin-songs.location=classpath:builtin-songs-test/"})
class BuiltinSongStartupTest {

	static final String TITLE = "카탈로그 시작 등록 검사곡";
	static JdbcTemplate cleanup;

	@Autowired JdbcTemplate db;

	@Test
	void 앱이_켜지면_카탈로그_곡이_공용_곡으로_들어가_있다() {
		cleanup = db;
		assertThat(db.queryForObject("SELECT count(*) FROM songs WHERE title=? AND source='BUILTIN' AND deleted_at IS NULL", Integer.class, TITLE)).isEqualTo(1);
		assertThat(db.queryForObject("SELECT count(*) FROM charts c JOIN songs s ON s.id=c.song_id WHERE s.title=?", Integer.class, TITLE)).isEqualTo(3);
	}

	@AfterAll
	static void clean() {
		if (cleanup == null) return;
		cleanup.update("UPDATE songs SET song_level=NULL,level_chart_version_id=NULL,level_rule_version=NULL,level_duration_ms=NULL WHERE title=?", TITLE);
		cleanup.update("DELETE FROM chart_versions WHERE chart_id IN (SELECT c.id FROM charts c JOIN songs s ON s.id=c.song_id WHERE s.title=?)", TITLE);
		cleanup.update("DELETE FROM charts WHERE song_id IN (SELECT id FROM songs WHERE title=?)", TITLE);
		cleanup.update("DELETE FROM songs WHERE title=?", TITLE);
	}
}
