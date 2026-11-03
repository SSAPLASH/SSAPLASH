package com.ssafy.airdrum.song.admin;

import java.io.IOException;
import java.io.InputStream;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import javax.sql.DataSource;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;

import com.ssafy.airdrum.song.admin.BuiltinSongSeeder.Outcome;

import static org.assertj.core.api.Assertions.assertThat;

/** 254번 설계 3-2절: 공용 곡 카탈로그 등록 규칙. 시작 시 자동 실행은 테스트 기본값으로 꺼져 있고 여기서 직접 부른다. */
// 기본 컨텍스트는 마이그레이션 테스트가 풀 연결의 search_path를 바꿔 둘 수 있어(전체 빌드에서 songs를 못 찾음) SheetMusicSchemaTest와 같은 격리 컨텍스트를 쓴다.
@SpringBootTest(properties = {"auth.jwt.secret=test-only-jwt-secret-0123456789ab", "auth.refresh-token.store=memory", "chart.worker.cleanup-interval-ms=86400000"})
class BuiltinSongSeederTest {

	@Autowired BuiltinSongSeeder seeder;
	@Autowired JdbcTemplate db;
	@Autowired DataSource dataSource;
	final String prefix = "시더검사-" + UUID.randomUUID().toString().substring(0, 8) + "-";

	@AfterEach
	void clean() {
		// V29 곡 난이도 등급이 HARD 채보 버전을 가리키므로 먼저 비운다.
		db.update("UPDATE songs SET song_level=NULL,level_chart_version_id=NULL,level_rule_version=NULL,level_duration_ms=NULL WHERE title LIKE ?", prefix + "%");
		db.update("DELETE FROM chart_versions WHERE chart_id IN (SELECT c.id FROM charts c JOIN songs s ON s.id=c.song_id WHERE s.title LIKE ?)", prefix + "%");
		db.update("DELETE FROM charts WHERE song_id IN (SELECT id FROM songs WHERE title LIKE ?)", prefix + "%");
		db.update("DELETE FROM songs WHERE title LIKE ?", prefix + "%");
	}

	static byte[] midi(String path) throws IOException {
		try (InputStream in = BuiltinSongSeederTest.class.getResourceAsStream(path)) {
			return in.readAllBytes();
		}
	}

	BuiltinSongCatalog.Entry entry(String title, byte[] midi) {
		return new BuiltinSongCatalog.Entry(prefix + title, "A307", "자작 (테스트)", true, midi);
	}

	private Map<String, Object> song(String title) {
		return db.queryForMap("SELECT id, source, owner_id IS NULL AS builtin, license, artist, published, status FROM songs WHERE title=? AND deleted_at IS NULL", prefix + title);
	}

	private List<Map<String, Object>> charts(long songId) {
		return db.queryForList("SELECT c.difficulty, max(v.version) AS latest, count(v.id) AS versions FROM charts c JOIN chart_versions v ON v.chart_id=c.id "
				+ "WHERE c.song_id=? GROUP BY c.difficulty ORDER BY c.difficulty", songId);
	}

	@Test
	void 없는_곡은_3난이도로_등록하고_다시_실행하면_건너뛴다() throws Exception {
		var e = entry("새 곡", midi("/builtin-songs-test/midi/test-8beat.mid"));
		assertThat(seeder.seed(List.of(e))).containsEntry(e.title(), Outcome.REGISTERED);
		var row = song("새 곡");
		assertThat(row).containsEntry("source", "BUILTIN").containsEntry("builtin", true).containsEntry("license", "자작 (테스트)")
				.containsEntry("artist", "A307").containsEntry("published", true).containsEntry("status", "READY");
		long id = ((Number) row.get("id")).longValue();
		assertThat(charts(id)).extracting(m -> m.get("difficulty")).containsExactly("EASY", "HARD", "NORMAL");
		assertThat(charts(id)).allSatisfy(m -> assertThat(((Number) m.get("latest")).intValue()).isEqualTo(1));

		assertThat(seeder.seed(List.of(e))).containsEntry(e.title(), Outcome.SKIPPED);
		assertThat(db.queryForObject("SELECT count(*) FROM songs WHERE title=?", Integer.class, e.title())).isEqualTo(1);
		assertThat(charts(id)).allSatisfy(m -> assertThat(((Number) m.get("versions")).intValue()).isEqualTo(1));
	}

	@Test
	void 난이도가_모자란_곡은_채우고_있던_난이도는_새_버전이_된다() throws Exception {
		var e = entry("모자란 곡", midi("/builtin-songs-test/midi/test-8beat.mid"));
		seeder.seed(List.of(e));
		long id = ((Number) song("모자란 곡").get("id")).longValue();
		// 시드처럼 EASY 하나만 남긴다(난이도 등급이 HARD 버전을 가리키므로 먼저 비운다).
		db.update("UPDATE songs SET song_level=NULL,level_chart_version_id=NULL,level_rule_version=NULL,level_duration_ms=NULL WHERE id=?", id);
		db.update("DELETE FROM chart_versions WHERE chart_id IN (SELECT id FROM charts WHERE song_id=? AND difficulty<>'EASY')", id);
		db.update("DELETE FROM charts WHERE song_id=? AND difficulty<>'EASY'", id);

		assertThat(seeder.seed(List.of(e))).containsEntry(e.title(), Outcome.FILLED);
		var rows = charts(id);
		assertThat(rows).extracting(m -> m.get("difficulty")).containsExactly("EASY", "HARD", "NORMAL");
		assertThat(rows.get(0)).containsEntry("difficulty", "EASY");
		assertThat(((Number) rows.get(0).get("latest")).intValue()).isEqualTo(2);
		assertThat(((Number) rows.get(1).get("latest")).intValue()).isEqualTo(1);
		assertThat(seeder.seed(List.of(e))).containsEntry(e.title(), Outcome.SKIPPED);
	}

	@Test
	void 변환에_실패한_곡만_건너뛰고_나머지는_등록한다() throws Exception {
		var broken = entry("깨진 곡", midi("/builtin-songs-test/midi/broken.mid"));
		var good = entry("멀쩡한 곡", midi("/builtin-songs-test/midi/test-8beat.mid"));
		var result = seeder.seed(List.of(broken, good));
		assertThat(result).containsEntry(broken.title(), Outcome.FAILED).containsEntry(good.title(), Outcome.REGISTERED);
		assertThat(db.queryForObject("SELECT count(*) FROM songs WHERE title=?", Integer.class, broken.title())).isZero();
	}

	@Test
	void 지운_공용_곡과_같은_제목이면_새로_등록하고_개인_곡_제목은_무시한다() throws Exception {
		var e = entry("지운 곡", midi("/builtin-songs-test/midi/test-8beat.mid"));
		seeder.seed(List.of(e));
		long first = ((Number) song("지운 곡").get("id")).longValue();
		db.update("UPDATE songs SET deleted_at=now() WHERE id=?", first);
		assertThat(seeder.seed(List.of(e))).containsEntry(e.title(), Outcome.REGISTERED);
		assertThat(((Number) song("지운 곡").get("id")).longValue()).isNotEqualTo(first);

		long owner = db.queryForObject("INSERT INTO users(nickname) VALUES('개인 곡 주인') RETURNING id", Long.class);
		try {
			db.update("INSERT INTO songs(owner_id,title,source,status) VALUES(?,?,'MIDI','READY')", owner, prefix + "개인 곡 제목");
			var personal = entry("개인 곡 제목", midi("/builtin-songs-test/midi/test-8beat.mid"));
			assertThat(seeder.seed(List.of(personal))).containsEntry(personal.title(), Outcome.REGISTERED);
		} finally {
			db.update("DELETE FROM songs WHERE owner_id=?", owner);
			db.update("DELETE FROM users WHERE id=?", owner);
		}
	}

	@Test
	void 다른_인스턴스가_잠금을_쥐고_있으면_아무것도_하지_않는다() throws Exception {
		var e = entry("잠긴 곡", midi("/builtin-songs-test/midi/test-8beat.mid"));
		try (var other = dataSource.getConnection(); var st = other.createStatement()) {
			st.execute("SELECT pg_advisory_lock(" + BuiltinSongSeeder.LOCK_KEY + ")");
			try {
				assertThat(seeder.seed(List.of(e))).isEmpty();
				assertThat(db.queryForObject("SELECT count(*) FROM songs WHERE title=?", Integer.class, e.title())).isZero();
			} finally {
				st.execute("SELECT pg_advisory_unlock(" + BuiltinSongSeeder.LOCK_KEY + ")");
			}
		}
		assertThat(seeder.seed(List.of(e))).containsEntry(e.title(), Outcome.REGISTERED);
	}

	@Test
	void 저장소의_카탈로그는_모든_곡이_3난이도로_변환된다() {
		var entries = BuiltinSongCatalog.load("classpath:builtin-songs/");
		assertThat(entries).extracting(BuiltinSongCatalog.Entry::title).contains("기본 8비트", "8비트 + 필인", "라이드 16비트");
		for (var entry : entries) {
			var renamed = new BuiltinSongCatalog.Entry(prefix + entry.title(), entry.artist(), entry.license(), entry.published(), entry.midi());
			assertThat(seeder.seed(List.of(renamed))).as(entry.title()).containsEntry(renamed.title(), Outcome.REGISTERED);
			long id = db.queryForObject("SELECT id FROM songs WHERE title=? AND deleted_at IS NULL", Long.class, renamed.title());
			assertThat(db.queryForObject("SELECT count(*) FROM charts c JOIN chart_versions v ON v.chart_id=c.id WHERE c.song_id=? AND v.note_count>0",
					Integer.class, id)).as(entry.title()).isEqualTo(3);
			assertThat(entry.license()).isNotBlank();
		}
	}
}
