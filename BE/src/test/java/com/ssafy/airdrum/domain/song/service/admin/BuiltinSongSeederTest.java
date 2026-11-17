package com.ssafy.airdrum.domain.song.service.admin;

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

import com.ssafy.airdrum.domain.lesson.model.LessonCourse;
import com.ssafy.airdrum.domain.lesson.model.LessonKind;
import com.ssafy.airdrum.domain.lesson.model.LessonSpec;
import com.ssafy.airdrum.domain.song.service.admin.BuiltinSongSeeder.Outcome;
import com.ssafy.airdrum.domain.song.model.SongMetadata;
import com.ssafy.airdrum.domain.song.repository.SongMetadataRepository;

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

	/** 331번 설계 3-2절: lessons는 카탈로그가 유일한 출처라 시작할 때마다 카탈로그 내용으로 바뀐다. */
	private List<Map<String, Object>> lessons() {
		return db.queryForList("SELECT s.title, l.position, l.kind, l.summary, l.pads::text AS pads, l.guide FROM lessons l JOIN songs s ON s.id=l.song_id "
				+ "WHERE s.title LIKE ? ORDER BY l.position", prefix + "%");
	}

	BuiltinSongCatalog.Entry lesson(String title, LessonSpec spec) throws IOException {
		return new BuiltinSongCatalog.Entry(prefix + title, null, "자작 (테스트)", true, midi("/builtin-songs-test/midi/test-8beat.mid"), 0, null, spec);
	}

	@Test
	void 카탈로그의_lesson이_lessons에_들어가고_고치거나_빼면_반영된다() throws Exception {
		var a = lesson("레슨 A", new LessonSpec(1, LessonKind.READ, "킥 음표", List.of("KICK"), false));
		var b = lesson("레슨 B", new LessonSpec(2, LessonKind.PLAY, "킥과 스네어", List.of("KICK", "SNARE"), true));
		var plain = entry("곡", midi("/builtin-songs-test/midi/test-8beat.mid"));
		assertThat(seeder.seed(List.of(a, b, plain))).containsValues(Outcome.REGISTERED);
		assertThat(lessons()).hasSize(2);
		assertThat(lessons().get(0)).containsEntry("title", a.title()).containsEntry("position", 1).containsEntry("kind", "READ")
				.containsEntry("summary", "킥 음표").containsEntry("pads", "[\"KICK\"]").containsEntry("guide", false);
		assertThat(lessons().get(1)).containsEntry("title", b.title()).containsEntry("position", 2).containsEntry("kind", "PLAY")
				.containsEntry("pads", "[\"KICK\", \"SNARE\"]").containsEntry("guide", true);

		// 순서를 바꾸고 설명을 고치면 다음 시작에 반영된다(곡은 건너뛴다)
		var a2 = lesson("레슨 A", new LessonSpec(2, LessonKind.READ, "킥 음표 다시", List.of("KICK"), true));
		var b2 = lesson("레슨 B", new LessonSpec(1, LessonKind.PLAY, "킥과 스네어", List.of("KICK", "SNARE"), true));
		assertThat(seeder.seed(List.of(a2, b2, plain))).containsValues(Outcome.SKIPPED);
		assertThat(lessons()).extracting(m -> m.get("title")).containsExactly(b.title(), a.title());
		assertThat(lessons().get(1)).containsEntry("summary", "킥 음표 다시").containsEntry("guide", true);

		// lesson을 빼면 레슨에서 빠지고 곡은 그대로 남는다
		var a3 = new BuiltinSongCatalog.Entry(a.title(), null, "자작 (테스트)", true, a.midi(), 0, null);
		seeder.seed(List.of(a3, lesson("레슨 B", new LessonSpec(1, LessonKind.PLAY, "킥과 스네어", List.of("KICK", "SNARE"), true)), plain));
		assertThat(lessons()).extracting(m -> m.get("title")).containsExactly(b.title());
		assertThat(db.queryForObject("SELECT count(*) FROM songs WHERE title=? AND deleted_at IS NULL", Integer.class, a.title())).isEqualTo(1);
	}

	@Test
	void 레슨_교체_실패는_이전_레슨을_유지하고_새_곡_등록을_되돌리지_않는다() throws Exception {
		var previous = lesson("기존 레슨", new LessonSpec(1, LessonKind.READ, "기존", List.of("KICK"), false));
		seeder.seed(List.of(previous));
		var before = lessons();
		assertThat(before).hasSize(1);
		var a = lesson("새 레슨 A", new LessonSpec(2, LessonKind.PLAY, "A", List.of("KICK"), true));
		var b = lesson("새 레슨 B", new LessonSpec(2, LessonKind.PLAY, "B", List.of("SNARE"), true));

		assertThat(seeder.seed(List.of(a, b))).containsEntry(a.title(), Outcome.REGISTERED).containsEntry(b.title(), Outcome.REGISTERED);
		assertThat(lessons()).isEqualTo(before);
		assertThat(db.queryForObject("SELECT count(*) FROM songs WHERE title IN (?,?)", Integer.class, a.title(), b.title())).isEqualTo(2);
	}

	@Test
	void 이미_있는_레슨_곡은_이번_처리가_실패해도_레슨에_남는다() throws Exception {
		// 검증 추가 발견 2: 실패한 레슨 곡이 레슨에서 빠지면 일반 공용 곡으로 목록·추천에 나온다
		var a = lesson("레슨 A", new LessonSpec(1, LessonKind.PLAY, "킥", List.of("KICK"), true));
		seeder.seed(List.of(a));
		long id = ((Number) song("레슨 A").get("id")).longValue();
		// 난이도를 하나만 남겨 다음 처리가 채우기(재변환)로 가게 하고, 깨진 MIDI로 실패시킨다
		db.update("UPDATE songs SET song_level=NULL,level_chart_version_id=NULL,level_rule_version=NULL,level_duration_ms=NULL WHERE id=?", id);
		db.update("DELETE FROM chart_versions WHERE chart_id IN (SELECT id FROM charts WHERE song_id=? AND difficulty<>'NORMAL')", id);
		db.update("DELETE FROM charts WHERE song_id=? AND difficulty<>'NORMAL'", id);
		var broken = new BuiltinSongCatalog.Entry(a.title(), null, "자작 (테스트)", true, new byte[] {1, 2, 3}, 0, null, a.lesson());
		assertThat(seeder.seed(List.of(broken))).containsEntry(a.title(), Outcome.FAILED);
		assertThat(lessons()).extracting(m -> m.get("title")).containsExactly(a.title());
	}

	@Test
	void 저장소_카탈로그의_레슨은_순서가_이어지고_NORMAL이_원본과_같다() {
		var entries = BuiltinSongCatalog.load("classpath:builtin-songs/").stream().filter(e -> e.lesson() != null).toList();
		var beginner = entries.stream().filter(e -> e.lesson().course() == LessonCourse.BEGINNER).toList();
		var intermediate = entries.stream().filter(e -> e.lesson().course() == LessonCourse.INTERMEDIATE).toList();
		assertThat(beginner).extracting(e -> e.lesson().order()).containsExactlyInAnyOrder(1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12);
		// 입문: 알아보기 4개(1~4) 뒤에 연주 8개(5~12). 「섞어서 읽기」(4)만 처음부터 알려 주지 않는다
		assertThat(beginner).allSatisfy(e -> assertThat(e.lesson().kind()).isEqualTo(e.lesson().order() <= 4 ? LessonKind.READ : LessonKind.PLAY));
		assertThat(beginner).filteredOn(e -> !e.lesson().guide()).extracting(e -> e.lesson().order()).containsExactly(4);
		assertThat(beginner).allSatisfy(e -> assertThat(e.title()).startsWith("입문 · "));
		// 중급(학습 코스 설계 3-7절): 알아보기 3개(1~3) 뒤에 연주 7개(4~10). 입문에서 안 친 드럼 여섯 개를 모두 쓴다
		assertThat(intermediate).extracting(e -> e.lesson().order()).containsExactlyInAnyOrder(1, 2, 3, 4, 5, 6, 7, 8, 9, 10);
		assertThat(intermediate).allSatisfy(e -> assertThat(e.lesson().kind()).isEqualTo(e.lesson().order() <= 3 ? LessonKind.READ : LessonKind.PLAY));
		assertThat(intermediate).allSatisfy(e -> assertThat(e.title()).startsWith("중급 · "));
		assertThat(intermediate).flatExtracting(e -> e.lesson().pads()).contains("CRASH", "RIDE", "SMALL_TOM", "MID_TOM", "FLOOR_TOM", "HIHAT_PEDAL");
		for (var entry : entries) {
			// 레슨 채보는 NORMAL이다(설계 1절). 솎기로 노트가 빠지면 레슨 내용이 바뀐다.
			var renamed = new BuiltinSongCatalog.Entry(prefix + entry.title(), entry.artist(), entry.license(), entry.published(), entry.midi(), entry.offsetMs(), entry.meta());
			assertThat(seeder.seed(List.of(renamed))).as(entry.title()).containsEntry(renamed.title(), Outcome.REGISTERED);
			var counts = db.queryForMap("SELECT max(v.note_count) FILTER (WHERE c.difficulty='HARD') AS hard, max(v.note_count) FILTER (WHERE c.difficulty='NORMAL') AS normal "
					+ "FROM charts c JOIN chart_versions v ON v.chart_id=c.id JOIN songs s ON s.id=c.song_id WHERE s.title=?", renamed.title());
			assertThat(counts.get("normal")).as(entry.title()).isNotNull().isEqualTo(counts.get("hard"));
			// 채보에 나오는 패드가 레슨이 알려 주는 패드와 같다(GM 번호를 잘못 쓰면 다른 패드가 나온다)
			var pads = db.queryForList("SELECT DISTINCT n->>'pad' FROM charts c JOIN chart_versions v ON v.chart_id=c.id JOIN songs s ON s.id=c.song_id "
					+ "CROSS JOIN jsonb_array_elements(v.notes) n WHERE s.title=? AND c.difficulty='NORMAL'", String.class, renamed.title());
			assertThat(pads).as(entry.title()).containsExactlyInAnyOrderElementsOf(entry.lesson().pads());
			// 시연용으로 이 레슨만 2마디다(385번): 킥 8번, 마지막 노트 뒤 한 마디까지 11박(70 BPM)
			if (entry.title().equals("입문 · 킥으로 박자 세기")) {
				assertThat(((Number) counts.get("normal")).intValue()).as(entry.title()).isEqualTo(8);
				assertThat(db.queryForObject("SELECT duration_ms FROM songs WHERE title=?", Integer.class, renamed.title())).as(entry.title()).isEqualTo(9429);
			}
		}
	}

	@Test
	void 레슨_코스가_lessons에_들어가고_다른_코스는_같은_순서를_쓸_수_있다() throws Exception {
		var a = lesson("코스 입문 1", new LessonSpec(1, LessonKind.READ, "킥", List.of("KICK"), true));
		var b = lesson("코스 중급 1", new LessonSpec(1, LessonKind.READ, "크래시", List.of("CRASH"), true, LessonCourse.INTERMEDIATE));
		seeder.seed(List.of(a, b));
		assertThat(db.queryForList("SELECT s.title, l.course FROM lessons l JOIN songs s ON s.id=l.song_id WHERE s.title LIKE ? ORDER BY l.course, l.position",
				prefix + "코스%")).extracting(m -> m.get("title") + ":" + m.get("course"))
				.containsExactly(a.title() + ":BEGINNER", b.title() + ":INTERMEDIATE");
	}
}
