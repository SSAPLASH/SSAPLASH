package com.ssafy.airdrum.song.admin;

import java.nio.charset.StandardCharsets;
import java.util.Map;

import org.junit.jupiter.api.Test;

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
	void 오류_메시지에_원인_곡을_적는다() {
		assertThatThrownBy(() -> BuiltinSongCatalog.parse(
				"[{\"title\":\"곡 C\",\"license\":\"자작\",\"midi\":\"없는.mid\"}]".getBytes(StandardCharsets.UTF_8), FILES::get))
				.isInstanceOf(BuiltinSongCatalog.Invalid.class).hasMessageContaining("곡 C");
	}
}
