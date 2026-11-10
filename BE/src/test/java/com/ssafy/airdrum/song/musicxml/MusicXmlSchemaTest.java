package com.ssafy.airdrum.song.musicxml;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.jdbc.core.JdbcTemplate;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/** 293 V46: 곡 출처 MUSICXML과 채보 생성기 MUSICXML_RULE을 CHECK가 받는다. 기존 값·거절은 그대로다. */
// 기본 컨텍스트는 마이그레이션 테스트가 풀 연결의 search_path를 바꿔 둘 수 있어(전체 빌드에서 users를 못 찾음) SheetMusicSchemaTest와 같은 격리 컨텍스트를 쓴다.
@SpringBootTest(properties = {"auth.jwt.secret=test-only-jwt-secret-0123456789ab", "auth.refresh-token.store=memory", "chart.worker.cleanup-interval-ms=86400000"})
class MusicXmlSchemaTest {

	@Autowired JdbcTemplate db;
	long user;

	@BeforeEach
	void seed() {
		user = db.queryForObject("INSERT INTO users(nickname) VALUES('MusicXML 스키마 회원') RETURNING id", Long.class);
	}

	@AfterEach
	void clean() {
		db.update("DELETE FROM chart_versions WHERE chart_id IN (SELECT c.id FROM charts c JOIN songs s ON s.id=c.song_id WHERE s.owner_id=?)", user);
		db.update("DELETE FROM charts WHERE song_id IN (SELECT id FROM songs WHERE owner_id=?)", user);
		db.update("DELETE FROM songs WHERE owner_id=?", user);
		db.update("DELETE FROM users WHERE id=?", user);
	}

	@Test
	void V46_MUSICXML_출처와_MUSICXML_RULE_생성기를_받고_다른_값은_거절한다() {
		long song = insertSong("MUSICXML");
		assertThat(db.queryForObject("SELECT source FROM songs WHERE id=?", String.class, song)).isEqualTo("MUSICXML");
		long chart = db.queryForObject("INSERT INTO charts(song_id,difficulty) VALUES(?,'HARD') RETURNING id", Long.class, song);
		long version = insertVersion(chart, "MUSICXML_RULE", "sheet-musicxml-3");
		assertThat(db.queryForObject("SELECT generator||':'||generator_version FROM chart_versions WHERE id=?", String.class, version))
				.isEqualTo("MUSICXML_RULE:sheet-musicxml-3");
		// 기존 값은 그대로 받는다
		insertSong("MIDI");
		insertSong("AUDIO");
		long midiChart = db.queryForObject("INSERT INTO charts(song_id,difficulty) VALUES(?,'NORMAL') RETURNING id", Long.class, song);
		insertVersion(midiChart, "ADT_MODEL", "x");
		// 목록 밖 값은 거절한다
		assertThatThrownBy(() -> insertSong("PDF")).isInstanceOf(DataIntegrityViolationException.class);
		long easyChart = db.queryForObject("INSERT INTO charts(song_id,difficulty) VALUES(?,'EASY') RETURNING id", Long.class, song);
		assertThatThrownBy(() -> insertVersion(easyChart, "SHEET", "x")).isInstanceOf(DataIntegrityViolationException.class);
		// MUSICXML 곡에는 반주 키가 없다(반주 CHECK는 그대로)
		assertThatThrownBy(() -> db.update("UPDATE songs SET accompaniment_key='x' WHERE id=?", song)).isInstanceOf(DataIntegrityViolationException.class);
	}

	private long insertSong(String source) {
		return db.queryForObject("INSERT INTO songs(owner_id,title,source,status,bpm,offset_ms,time_signature,duration_ms) VALUES(?,'악보 곡',?,'READY',120,0,'4/4',4000) RETURNING id",
				Long.class, user, source);
	}

	private long insertVersion(long chart, String generator, String version) {
		return db.queryForObject("""
				INSERT INTO chart_versions(chart_id,version,schema_version,notes,timing,notation_status,note_count,generator,generator_version)
				VALUES(?,1,1,'[]'::jsonb,'{"bpm":120,"offsetMs":0,"timeSignature":"4/4"}'::jsonb,'UNAVAILABLE',0,?,?) RETURNING id
				""", Long.class, chart, generator, version);
	}
}
