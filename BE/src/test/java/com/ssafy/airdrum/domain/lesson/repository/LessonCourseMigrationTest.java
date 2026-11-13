package com.ssafy.airdrum.domain.lesson.repository;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.sql.Connection;
import java.sql.SQLException;
import java.util.UUID;

import javax.sql.DataSource;

import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.datasource.DriverManagerDataSource;

import com.zaxxer.hikari.HikariDataSource;

/** 학습 코스 설계 3-2절 V50: 기존 레슨은 입문 코스로 남고, 순서는 코스 안에서만 겹치지 않는다. */
@SpringBootTest(properties = {"auth.jwt.secret=test-only-jwt-secret-0123456789ab"})
class LessonCourseMigrationTest {

	@Autowired DataSource source;

	@Test
	void 기존_레슨은_입문_코스가_되고_순서는_코스_안에서만_겹치지_않는다() throws Exception {
		String schema = "lesson50_" + UUID.randomUUID().toString().replace("-", "");
		var pool = (HikariDataSource) source;
		DataSource isolated = new DriverManagerDataSource(pool.getJdbcUrl(), pool.getUsername(), pool.getPassword());
		try {
			flyway(isolated, schema, "49").migrate();
			try (Connection c = isolated.getConnection(); var s = c.createStatement()) {
				s.execute("SET search_path TO " + schema);
				s.execute("INSERT INTO users(id,nickname) OVERRIDING SYSTEM VALUE VALUES(999999,'legacy')");
				for (int id = 999991; id <= 999994; id++)
					s.execute("INSERT INTO songs(id,title,source,license) OVERRIDING SYSTEM VALUE VALUES(" + id + ",'레슨 " + id + "','BUILTIN','자작')");
				s.execute("INSERT INTO lessons(song_id,position,kind,summary,pads) VALUES(999991,1,'READ','킥','[\"KICK\"]')");
				s.execute("INSERT INTO lesson_completions(user_id,song_id) VALUES(999999,999991)");
			}

			var migration = flyway(isolated, schema, "50");
			assertThat(migration.migrate().migrationsExecuted).isEqualTo(1);
			try (Connection c = isolated.getConnection(); var s = c.createStatement()) {
				s.execute("SET search_path TO " + schema);
				try (var rows = s.executeQuery("SELECT course, position FROM lessons WHERE song_id=999991")) {
					assertThat(rows.next()).isTrue();
					assertThat(rows.getString(1)).isEqualTo("BEGINNER");
					assertThat(rows.getInt(2)).isEqualTo(1);
				}
				try (var rows = s.executeQuery("SELECT count(*) FROM lesson_completions WHERE user_id=999999")) {
					rows.next();
					assertThat(rows.getInt(1)).isEqualTo(1);
				}
				// 다른 코스는 같은 순서를 쓸 수 있다
				s.execute("INSERT INTO lessons(song_id,course,position,kind,summary,pads) VALUES(999992,'INTERMEDIATE',1,'READ','크래시','[\"CRASH\"]')");
				// 같은 코스 안에서는 겹칠 수 없다
				assertThatThrownBy(() -> s.execute("INSERT INTO lessons(song_id,course,position,kind,summary,pads) VALUES(999993,'INTERMEDIATE',1,'PLAY','s','[\"RIDE\"]')"))
						.isInstanceOf(SQLException.class).extracting(e -> ((SQLException) e).getSQLState()).isEqualTo("23505");
				assertThatThrownBy(() -> s.execute("INSERT INTO lessons(song_id,position,kind,summary,pads) VALUES(999993,1,'PLAY','s','[\"KICK\"]')"))
						.isInstanceOf(SQLException.class).extracting(e -> ((SQLException) e).getSQLState()).isEqualTo("23505");
				assertThatThrownBy(() -> s.execute("INSERT INTO lessons(song_id,course,position,kind,summary,pads) VALUES(999994,'ADVANCED',1,'PLAY','s','[\"KICK\"]')"))
						.isInstanceOf(SQLException.class).extracting(e -> ((SQLException) e).getSQLState()).isEqualTo("23514");
			}
			assertThat(migration.migrate().migrationsExecuted).isZero();
		} finally {
			try (Connection c = isolated.getConnection(); var s = c.createStatement()) {
				s.execute("DROP SCHEMA IF EXISTS " + schema + " CASCADE");
			}
		}
	}

	private Flyway flyway(DataSource source, String schema, String target) {
		return Flyway.configure().dataSource(source).schemas(schema).defaultSchema(schema).locations("classpath:db/test-migration").target(target).load();
	}
}
