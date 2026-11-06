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
import com.ssafy.airdrum.song.meta.SongMetadata;
import com.ssafy.airdrum.song.meta.SongMetadataRepository;

import static org.assertj.core.api.Assertions.assertThat;

/** 254번 설계 3-2절: 공용 곡 카탈로그 등록 규칙. 시작 시 자동 실행은 테스트 기본값으로 꺼져 있고 여기서 직접 부른다. */
// 기본 컨텍스트는 마이그레이션 테스트가 풀 연결의 search_path를 바꿔 둘 수 있어(전체 빌드에서 songs를 못 찾음) SheetMusicSchemaTest와 같은 격리 컨텍스트를 쓴다.
@SpringBootTest(properties = {"auth.jwt.secret=test-only-jwt-secret-0123456789ab", "auth.refresh-token.store=memory", "chart.worker.cleanup-interval-ms=86400000"})
class BuiltinSongSeederTest {

	@Autowired BuiltinSongSeeder seeder;
	@Autowired JdbcTemplate db;
	@Autowired DataSource dataSource;
	@Autowired SongMetadataRepository metadata;
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
		return new BuiltinSongCatalog.Entry(prefix + title, "A307", "자작 (테스트)", true, midi, 0, null);
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

	/** 260번 설계 4-1절: 0틱 = 음원 0초인 MIDI(첫 박 1693틱 = 1840ms, 115 BPM). */
	static byte[] offsetMidi() throws Exception {
		var sequence = new javax.sound.midi.Sequence(javax.sound.midi.Sequence.PPQ, 480);
		var track = sequence.createTrack();
		int us = (int) Math.round(60_000_000 / 115.0);
		track.add(new javax.sound.midi.MidiEvent(new javax.sound.midi.MetaMessage(0x51, new byte[] {(byte) (us >> 16), (byte) (us >> 8), (byte) us}, 3), 0));
		for (int beat = 0; beat < 8; beat++) {
			long tick = 1693 + beat * 480L;
			track.add(new javax.sound.midi.MidiEvent(new javax.sound.midi.ShortMessage(javax.sound.midi.ShortMessage.NOTE_ON, 9, beat % 2 == 0 ? 36 : 38, 100), tick));
			track.add(new javax.sound.midi.MidiEvent(new javax.sound.midi.ShortMessage(javax.sound.midi.ShortMessage.NOTE_OFF, 9, beat % 2 == 0 ? 36 : 38, 0), tick + 120));
		}
		var out = new java.io.ByteArrayOutputStream();
		javax.sound.midi.MidiSystem.write(sequence, 0, out);
		return out.toByteArray();
	}

	private List<Integer> timingOffsets(long songId) {
		return db.queryForList("SELECT CAST(v.timing->>'offsetMs' AS int) FROM charts c JOIN chart_versions v ON v.chart_id=c.id WHERE c.song_id=? ORDER BY v.id",
				Integer.class, songId);
	}

	@Test
	void 카탈로그_offsetMs는_곡과_채보_timing에_저장되고_난이도를_채울_때도_유지된다() throws Exception {
		var e = new BuiltinSongCatalog.Entry(prefix + "오프셋 곡", null, "자작 (테스트)", true, offsetMidi(), 1840, null);
		assertThat(seeder.seed(List.of(e))).containsEntry(e.title(), Outcome.REGISTERED);
		long id = ((Number) song("오프셋 곡").get("id")).longValue();
		assertThat(db.queryForObject("SELECT offset_ms FROM songs WHERE id=?", Integer.class, id)).isEqualTo(1840);
		assertThat(timingOffsets(id)).hasSize(3).containsOnly(1840);
		assertThat(db.queryForObject("SELECT CAST(v.notes->0->'notation'->>'tick' AS int) FROM charts c JOIN chart_versions v ON v.chart_id=c.id WHERE c.song_id=? AND c.difficulty='HARD'",
				Integer.class, id)).isZero();

		// 난이도가 모자란 곡을 채우는 경로(regenerate)도 같은 offsetMs로 만든다.
		db.update("UPDATE songs SET song_level=NULL,level_chart_version_id=NULL,level_rule_version=NULL,level_duration_ms=NULL,offset_ms=0 WHERE id=?", id);
		db.update("DELETE FROM chart_versions WHERE chart_id IN (SELECT id FROM charts WHERE song_id=? AND difficulty<>'EASY')", id);
		db.update("DELETE FROM charts WHERE song_id=? AND difficulty<>'EASY'", id);
		assertThat(seeder.seed(List.of(e))).containsEntry(e.title(), Outcome.FILLED);
		assertThat(db.queryForObject("SELECT offset_ms FROM songs WHERE id=?", Integer.class, id)).isEqualTo(1840);
		assertThat(timingOffsets(id)).hasSize(4).containsOnly(1840);
	}

	@Test
	void 첫_박보다_앞선_노트가_있으면_그_곡만_실패하고_다음_곡은_등록한다() throws Exception {
		// test-8beat은 0틱부터 노트가 있으므로 offsetMs를 주면 첫 박보다 앞선 노트가 생긴다.
		var early = new BuiltinSongCatalog.Entry(prefix + "앞선 노트 곡", null, "자작 (테스트)", true, midi("/builtin-songs-test/midi/test-8beat.mid"), 500, null);
		var good = entry("뒤 곡", midi("/builtin-songs-test/midi/test-8beat.mid"));
		assertThat(seeder.seed(List.of(early, good))).containsEntry(early.title(), Outcome.FAILED).containsEntry(good.title(), Outcome.REGISTERED);
		assertThat(db.queryForObject("SELECT count(*) FROM songs WHERE title=?", Integer.class, early.title())).isZero();
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

	/** 255번 설계 4-1절: 등록·채움·건너뜀 모두 뒤에 카탈로그 meta로 덮어쓰고, meta가 없으면 지운다. */
	@Test
	void 카탈로그_meta는_매번_덮어쓰고_빠지면_지운다() throws Exception {
		var rock = new SongMetadata("ROCK", List.of("POP"), List.of("UPLIFTING"), 3, 2007, "EN", List.of(), "HUMAN", null);
		var metal = new SongMetadata("METAL", List.of(), List.of("DARK"), 5, null, "EN", List.of("DOUBLE_KICK"), "HUMAN", null);
		var base = entry("메타 곡", midi("/builtin-songs-test/midi/test-8beat.mid"));

		assertThat(seeder.seed(List.of(withMeta(base, rock)))).containsEntry(base.title(), Outcome.REGISTERED);
		long id = ((Number) song("메타 곡").get("id")).longValue();
		assertThat(metadata.findBySongIds(List.of(id))).containsEntry(id, rock);

		// 이미 3난이도라 곡은 건너뛰어도 메타데이터는 카탈로그 값으로 바뀐다(운영에 먼저 등록된 31곡이 이 경로).
		assertThat(seeder.seed(List.of(withMeta(base, metal)))).containsEntry(base.title(), Outcome.SKIPPED);
		assertThat(metadata.findBySongIds(List.of(id))).containsEntry(id, metal);

		assertThat(seeder.seed(List.of(base))).containsEntry(base.title(), Outcome.SKIPPED);
		assertThat(metadata.findBySongIds(List.of(id))).isEmpty();
	}

	@Test
	void 난이도를_채울_때도_meta를_넣는다() throws Exception {
		var meta = new SongMetadata("PRACTICE", List.of(), List.of(), null, null, "INSTRUMENTAL", List.of("EIGHT_BEAT"), "HUMAN", null);
		var e = entry("채움 메타 곡", midi("/builtin-songs-test/midi/test-8beat.mid"));
		seeder.seed(List.of(e));
		long id = ((Number) song("채움 메타 곡").get("id")).longValue();
		db.update("UPDATE songs SET song_level=NULL,level_chart_version_id=NULL,level_rule_version=NULL,level_duration_ms=NULL WHERE id=?", id);
		db.update("DELETE FROM chart_versions WHERE chart_id IN (SELECT id FROM charts WHERE song_id=? AND difficulty<>'EASY')", id);
		db.update("DELETE FROM charts WHERE song_id=? AND difficulty<>'EASY'", id);

		assertThat(seeder.seed(List.of(withMeta(e, meta)))).containsEntry(e.title(), Outcome.FILLED);
		assertThat(metadata.findBySongIds(List.of(id))).containsEntry(id, meta);
	}

	private static BuiltinSongCatalog.Entry withMeta(BuiltinSongCatalog.Entry e, SongMetadata meta) {
		return new BuiltinSongCatalog.Entry(e.title(), e.artist(), e.license(), e.published(), e.midi(), e.offsetMs(), meta);
	}

	@Test
	void 저장소의_카탈로그는_모든_곡이_3난이도로_변환된다() {
		var entries = BuiltinSongCatalog.load("classpath:builtin-songs/");
		assertThat(entries).extracting(BuiltinSongCatalog.Entry::title).contains("기본 8비트", "8비트 + 필인", "라이드 16비트");
		for (var entry : entries) {
			// 260번: 각 곡의 offsetMs로 변환한다. 첫 박보다 앞선 노트가 있는 곡을 카탈로그에 넣으면 여기서 실패한다(설계 U1).
			var renamed = new BuiltinSongCatalog.Entry(prefix + entry.title(), entry.artist(), entry.license(), entry.published(), entry.midi(), entry.offsetMs(), entry.meta());
			assertThat(seeder.seed(List.of(renamed))).as(entry.title()).containsEntry(renamed.title(), Outcome.REGISTERED);
			long id = db.queryForObject("SELECT id FROM songs WHERE title=? AND deleted_at IS NULL", Long.class, renamed.title());
			assertThat(db.queryForObject("SELECT offset_ms FROM songs WHERE id=?", Integer.class, id)).as(entry.title()).isEqualTo(entry.offsetMs());
			assertThat(db.queryForObject("SELECT count(*) FROM charts c JOIN chart_versions v ON v.chart_id=c.id WHERE c.song_id=? AND v.note_count>0",
					Integer.class, id)).as(entry.title()).isEqualTo(3);
			assertThat(entry.license()).isNotBlank();
		}
	}
}
