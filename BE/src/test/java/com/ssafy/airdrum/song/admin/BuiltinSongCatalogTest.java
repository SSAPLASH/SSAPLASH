package com.ssafy.airdrum.song.admin;

import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;

import org.junit.jupiter.api.Test;

import com.ssafy.airdrum.song.meta.SongMetadata;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/** 254번 설계 3-1절: 공용 곡 카탈로그 읽기·검사. 문제가 하나라도 있으면 전체를 거부한다. */
class BuiltinSongCatalogTest {

	static final byte[] MIDI = {1, 2, 3};
	static final Map<String, byte[]> FILES = Map.of("a.mid", MIDI, "b.mid", MIDI);

	static BuiltinSongCatalog.Invalid invalid(String json) {
		try {
			BuiltinSongCatalog.parse(json.getBytes(StandardCharsets.UTF_8), FILES::get);
		} catch (BuiltinSongCatalog.Invalid e) {
			return e;
		}
		throw new AssertionError("거부되지 않음: " + json);
	}

	@Test
	void 정상_카탈로그는_필드와_MIDI를_읽고_published_기본값은_true() {
		var entries = BuiltinSongCatalog.parse("""
				[{"title":"곡 A","artist":"A307","license":"자작","midi":"a.mid"},
				 {"title":"곡 B","license":"Public Domain","midi":"b.mid","published":false}]
				""".getBytes(StandardCharsets.UTF_8), FILES::get);
		assertThat(entries).hasSize(2);
		assertThat(entries.get(0).title()).isEqualTo("곡 A");
		assertThat(entries.get(0).artist()).isEqualTo("A307");
		assertThat(entries.get(0).license()).isEqualTo("자작");
		assertThat(entries.get(0).published()).isTrue();
		assertThat(entries.get(0).midi()).isEqualTo(MIDI);
		assertThat(entries.get(1).artist()).isNull();
		assertThat(entries.get(1).published()).isFalse();
		assertThat(BuiltinSongCatalog.parse("[]".getBytes(StandardCharsets.UTF_8), FILES::get)).isEmpty();
	}

	/** 260번 설계 3-1절: offsetMs는 선택, 생략하면 0, 원본 음원 0초 기준 첫 박 시각(ms). */
	@Test
	void offsetMs는_선택이고_생략하면_0이다() {
		var entries = BuiltinSongCatalog.parse("""
				[{"title":"곡 A","license":"자작","midi":"a.mid","offsetMs":1840},
				 {"title":"곡 B","license":"자작","midi":"b.mid"},
				 {"title":"곡 C","license":"자작","midi":"a.mid","offsetMs":1800000}]
				""".getBytes(StandardCharsets.UTF_8), FILES::get);
		assertThat(entries).extracting(BuiltinSongCatalog.Entry::offsetMs).containsExactly(1840, 0, 1_800_000);
	}

	@Test
	void offsetMs가_0_이상_30분_이하_정수가_아니면_카탈로그를_거부한다() {
		for (String value : new String[] {"-1", "1.5", "1840.0", "\"1840\"", "null", "1800001", "1099511627776", "true", "[]"})
			assertThat(invalid("[{\"title\":\"곡 D\",\"license\":\"자작\",\"midi\":\"a.mid\",\"offsetMs\":" + value + "}]"))
					.as(value).hasMessageContaining("곡 D").hasMessageContaining("offsetMs");
	}

	@Test
	void 잘못된_카탈로그는_통째로_거부한다() {
		for (String bad : new String[] {
				"{}", "[", "[1]", "",
				"[{\"title\":\"곡\",\"license\":\"자작\",\"midi\":\"a.mid\"},{\"title\":\"곡\",\"license\":\"자작\",\"midi\":\"b.mid\"}]",
				"[{\"license\":\"자작\",\"midi\":\"a.mid\"}]",
				"[{\"title\":\"\",\"license\":\"자작\",\"midi\":\"a.mid\"}]",
				"[{\"title\":\" 곡\",\"license\":\"자작\",\"midi\":\"a.mid\"}]",
				"[{\"title\":\"" + "가".repeat(101) + "\",\"license\":\"자작\",\"midi\":\"a.mid\"}]",
				"[{\"title\":\"곡\",\"midi\":\"a.mid\"}]",
				"[{\"title\":\"곡\",\"license\":\"  \",\"midi\":\"a.mid\"}]",
				"[{\"title\":\"곡\",\"license\":\"" + "가".repeat(201) + "\",\"midi\":\"a.mid\"}]",
				"[{\"title\":\"곡\",\"artist\":\"" + "가".repeat(101) + "\",\"license\":\"자작\",\"midi\":\"a.mid\"}]",
				"[{\"title\":\"곡\",\"license\":\"자작\"}]",
				"[{\"title\":\"곡\",\"license\":\"자작\",\"midi\":\"없는.mid\"}]",
				"[{\"title\":\"곡\",\"license\":\"자작\",\"midi\":\"../a.mid\"}]",
				"[{\"title\":\"곡\",\"license\":\"자작\",\"midi\":\"a.mid\",\"cover\":\"x.png\"}]",
				"[{\"title\":\"곡\",\"license\":\"자작\",\"midi\":\"a.mid\",\"published\":\"yes\"}]"})
			assertThat(invalid(bad)).as(bad).isNotNull();
	}

	@Test
	void 저장소_카탈로그에_AI_공용_곡_31곡이_곡별_offsetMs와_함께_있다() {
		// 261번: AI(245)가 드럼리스 음원에 맞춘 MIDI 31곡. offsetMs는 AI 곡별_첫박.csv 값이다.
		var entries = BuiltinSongCatalog.load("classpath:builtin-songs/");
		var seeds = java.util.Set.of("기본 8비트", "8비트 + 필인", "라이드 16비트");
		var added = entries.stream().filter(e -> !seeds.contains(e.title())).toList();
		assertThat(entries).hasSize(34);
		assertThat(added).hasSize(31);
		assertThat(added).extracting(BuiltinSongCatalog.Entry::title, BuiltinSongCatalog.Entry::artist, BuiltinSongCatalog.Entry::offsetMs)
				.contains(
						org.assertj.core.groups.Tuple.tuple("Billie Jean", "Michael Jackson", 1226),
						org.assertj.core.groups.Tuple.tuple("Welcome To The Black Parade", "My Chemical Romance", 25800),
						org.assertj.core.groups.Tuple.tuple("거울", "국카스텐", 273),
						org.assertj.core.groups.Tuple.tuple("TOMBOY", "혁오", 1113),
						org.assertj.core.groups.Tuple.tuple("EVERYTHING", "검정치마", 231),
						org.assertj.core.groups.Tuple.tuple("고민중독", "QWER", 1084),
						org.assertj.core.groups.Tuple.tuple("Congratulations", "DAY6", 996),
						org.assertj.core.groups.Tuple.tuple("Welcome to the Show", "DAY6", 1549));
		for (var e : added)
			assertThat(e.license()).as(e.title()).isEqualTo("원곡 " + e.artist() + ", 드럼 채보 AI 팀 제작, 비상업 프로젝트 내부 시연용");
	}

	/** 255번 설계 3-1절: meta는 선택 객체이고 필드·값 목록은 COACH-004 CSV와 같다(다중 값은 배열). */
	@Test
	void meta는_선택이고_있으면_곡_메타데이터로_읽는다() {
		var entries = BuiltinSongCatalog.parse("""
				[{"title":"곡 A","license":"자작","midi":"a.mid","meta":{"genre":"METAL","subGenres":["ROCK"],"mood":["DARK","ENERGETIC"],
				   "energy":4,"releaseYear":2013,"language":"EN","drumStyle":["DOUBLE_KICK"],"source":"HUMAN"}},
				 {"title":"곡 B","license":"자작","midi":"b.mid"},
				 {"title":"곡 C","license":"자작","midi":"a.mid","meta":{"genre":"PRACTICE","source":"EXTERNAL_DB","sourceNote":"외부 DB, CC0"}}]
				""".getBytes(StandardCharsets.UTF_8), FILES::get);
		assertThat(entries.get(0).meta()).isEqualTo(new SongMetadata("METAL", List.of("ROCK"), List.of("DARK", "ENERGETIC"), 4, 2013, "EN",
				List.of("DOUBLE_KICK"), "HUMAN", null));
		assertThat(entries.get(1).meta()).isNull();
		assertThat(entries.get(2).meta()).isEqualTo(new SongMetadata("PRACTICE", List.of(), List.of(), null, null, null, List.of(), "EXTERNAL_DB", "외부 DB, CC0"));
	}

	@Test
	void meta가_규칙에_어긋나면_카탈로그를_거부하고_원인_곡과_필드를_적는다() {
		String base = "[{\"title\":\"곡 M\",\"license\":\"자작\",\"midi\":\"a.mid\",\"meta\":%s}]";
		Map<String, String> bad = Map.ofEntries(
				Map.entry("\"ROCK\"", "meta"),
				Map.entry("{\"genre\":\"ROCK\"}", "source"),
				Map.entry("{\"source\":\"HUMAN\"}", "genre"),
				Map.entry("{\"genre\":\"ROCKS\",\"source\":\"HUMAN\"}", "genre"),
				Map.entry("{\"genre\":\"ROCK\",\"source\":\"HUMAN\",\"tempo\":120}", "tempo"),
				Map.entry("{\"genre\":\"ROCK\",\"source\":\"HUMAN\",\"subGenres\":[\"POP\",\"FUNK\",\"JAZZ\"]}", "subGenres"),
				Map.entry("{\"genre\":\"ROCK\",\"source\":\"HUMAN\",\"subGenres\":\"POP\"}", "subGenres"),
				Map.entry("{\"genre\":\"ROCK\",\"source\":\"HUMAN\",\"mood\":[1]}", "mood"),
				Map.entry("{\"genre\":\"ROCK\",\"source\":\"HUMAN\",\"energy\":0}", "energy"),
				Map.entry("{\"genre\":\"ROCK\",\"source\":\"HUMAN\",\"energy\":\"3\"}", "energy"),
				Map.entry("{\"genre\":\"ROCK\",\"source\":\"HUMAN\",\"energy\":3.5}", "energy"),
				Map.entry("{\"genre\":\"ROCK\",\"source\":\"HUMAN\",\"releaseYear\":1899}", "releaseYear"),
				Map.entry("{\"genre\":\"ROCK\",\"source\":\"HUMAN\",\"language\":\"KR\"}", "language"),
				Map.entry("{\"genre\":\"ROCK\",\"source\":\"HUMAN\",\"drumStyle\":[\"BLAST_BEAT\"]}", "drumStyle"),
				Map.entry("{\"genre\":\"ROCK\",\"source\":\"EXTERNAL_DB\"}", "sourceNote"));
		bad.forEach((meta, field) -> assertThat(invalid(base.formatted(meta))).as(meta).hasMessageContaining("곡 M").hasMessageContaining(field));
	}

	/** 255번: 224 요청 CSV(11/05 v2, 34곡, 모두 HUMAN)를 카탈로그 meta로 옮겼다. */
	@Test
	void 저장소_카탈로그_34곡_모두_meta가_있다() {
		var entries = BuiltinSongCatalog.load("classpath:builtin-songs/");
		assertThat(entries).hasSize(34).allSatisfy(e -> {
			assertThat(e.meta()).as(e.title()).isNotNull();
			assertThat(e.meta().source()).as(e.title()).isEqualTo("HUMAN");
		});
		var byTitle = new java.util.HashMap<String, SongMetadata>();
		entries.forEach(e -> byTitle.put(e.title(), e.meta()));
		for (var practice : List.of("기본 8비트", "8비트 + 필인", "라이드 16비트")) {
			assertThat(byTitle.get(practice).genre()).as(practice).isEqualTo("PRACTICE");
			assertThat(byTitle.get(practice).language()).as(practice).isEqualTo("INSTRUMENTAL");
		}
		assertThat(byTitle.get("8비트 + 필인").drumStyle()).containsExactly("EIGHT_BEAT", "FILL_HEAVY");
		assertThat(byTitle.get("Hail To The King")).isEqualTo(new SongMetadata("METAL", List.of("ROCK"), List.of("DARK", "ENERGETIC"), 4, 2013, "EN",
				List.of(), "HUMAN", null));
		assertThat(byTitle.get("거울").releaseYear()).isNull();
	}

	@Test
	void 오류_메시지에_원인_곡을_적는다() {
		assertThatThrownBy(() -> BuiltinSongCatalog.parse(
				"[{\"title\":\"곡 C\",\"license\":\"자작\",\"midi\":\"없는.mid\"}]".getBytes(StandardCharsets.UTF_8), FILES::get))
				.isInstanceOf(BuiltinSongCatalog.Invalid.class).hasMessageContaining("곡 C");
	}
}
