package com.ssafy.airdrum.domain.lesson.repository;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.jdbc.core.JdbcTemplate;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/** 331 V48: 레슨 순서·종류·설명·패드 제약과 완료 기록의 기본 키, 곡을 지우면 함께 지워지는지. */
@SpringBootTest(properties = {"auth.jwt.secret=test-only-jwt-secret-0123456789ab", "spring.datasource.hikari.schema=public"})
class LessonSchemaTest {

	@Autowired JdbcTemplate db;
	long user, a, b;

	@BeforeEach
	void seed() {
		user = db.queryForObject("INSERT INTO users(nickname) VALUES('레슨 스키마 회원') RETURNING id", Long.class);
		a = db.queryForObject("INSERT INTO songs(title,source,license) VALUES('레슨 스키마 A','BUILTIN','자작') RETURNING id", Long.class);
		b = db.queryForObject("INSERT INTO songs(title,source,license) VALUES('레슨 스키마 B','BUILTIN','자작') RETURNING id", Long.class);
	}

	@AfterEach
	void clean() {
		db.update("DELETE FROM songs WHERE id IN (?,?)", a, b);
		db.update("DELETE FROM users WHERE id=?", user);
	}

	void lesson(long song, int position, String kind, String summary, String pads) {
		db.update("INSERT INTO lessons(song_id,position,kind,summary,pads) VALUES(?,?,?,?,?::jsonb)", song, position, kind, summary, pads);
	}

	@Test
	void 레슨_값_규칙을_어기면_넣을_수_없다() {
		assertThatThrownBy(() -> lesson(a, 0, "PLAY", "s", "[\"KICK\"]")).isInstanceOf(DataIntegrityViolationException.class);
		assertThatThrownBy(() -> lesson(a, 9101, "WATCH", "s", "[\"KICK\"]")).isInstanceOf(DataIntegrityViolationException.class);
		assertThatThrownBy(() -> lesson(a, 9101, "PLAY", "", "[\"KICK\"]")).isInstanceOf(DataIntegrityViolationException.class);
		assertThatThrownBy(() -> lesson(a, 9101, "PLAY", "가".repeat(201), "[\"KICK\"]")).isInstanceOf(DataIntegrityViolationException.class);
		assertThatThrownBy(() -> lesson(a, 9101, "PLAY", "s", "{\"pad\":\"KICK\"}")).isInstanceOf(DataIntegrityViolationException.class);
		lesson(a, 9101, "READ", "s", "[\"KICK\"]");
		assertThat(db.queryForObject("SELECT guide FROM lessons WHERE song_id=?", Boolean.class, a)).isTrue();
		// 순서는 겹칠 수 없다
		assertThatThrownBy(() -> lesson(b, 9101, "PLAY", "s", "[\"KICK\"]")).isInstanceOf(DataIntegrityViolationException.class);
	}

	@Test
	void 완료_기록은_사용자와_곡마다_하나이고_곡을_지우면_레슨과_함께_지워진다() {
		lesson(a, 9102, "READ", "s", "[\"KICK\"]");
		db.update("INSERT INTO lesson_completions(user_id,song_id) VALUES(?,?)", user, a);
		assertThatThrownBy(() -> db.update("INSERT INTO lesson_completions(user_id,song_id) VALUES(?,?)", user, a))
				.isInstanceOf(DataIntegrityViolationException.class);
		db.update("DELETE FROM songs WHERE id=?", a);
		assertThat(db.queryForObject("SELECT count(*) FROM lessons WHERE song_id=?", Integer.class, a)).isZero();
		assertThat(db.queryForObject("SELECT count(*) FROM lesson_completions WHERE song_id=?", Integer.class, a)).isZero();
	}
}
