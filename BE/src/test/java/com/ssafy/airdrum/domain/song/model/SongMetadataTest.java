package com.ssafy.airdrum.domain.song.model;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.util.List;

import org.junit.jupiter.api.Test;

/** 255번 설계 3-1절: 곡 메타데이터 값 규칙(COACH-004 값 목록과 같음). */
public class SongMetadataTest {

	public static SongMetadata valid() {
		return new SongMetadata("METAL", List.of("ROCK"), List.of("DARK", "ENERGETIC"), 4, 2013, "EN", List.of("DOUBLE_KICK"), "HUMAN", null);
	}

	@Test
	void 정상_값은_그대로_담고_빈_목록은_빈_리스트다() {
		var meta = new SongMetadata("PRACTICE", null, null, null, null, "INSTRUMENTAL", List.of("EIGHT_BEAT"), "HUMAN", null);
		assertThat(meta.subGenres()).isEmpty();
		assertThat(meta.mood()).isEmpty();
		assertThat(meta.drumStyle()).containsExactly("EIGHT_BEAT");
		assertThat(valid().mood()).containsExactly("DARK", "ENERGETIC");
	}

	@Test
	void 비슷한_곡_장르는_대표와_보조_장르를_합친다() {
		assertThat(valid().genresWithSub()).containsExactlyInAnyOrder("METAL", "ROCK");
	}

	@Test
	void 값_목록_밖이거나_개수를_넘으면_거부한다() {
		assertThatThrownBy(() -> new SongMetadata("ROCKS", null, null, null, null, null, null, "HUMAN", null))
				.isInstanceOf(IllegalArgumentException.class).hasMessageContaining("genre");
		assertThatThrownBy(() -> new SongMetadata(null, null, null, null, null, null, null, "HUMAN", null))
				.isInstanceOf(IllegalArgumentException.class).hasMessageContaining("genre");
		assertThatThrownBy(() -> new SongMetadata("ROCK", List.of("POP", "FUNK", "JAZZ"), null, null, null, null, null, "HUMAN", null))
				.isInstanceOf(IllegalArgumentException.class).hasMessageContaining("subGenres");
		assertThatThrownBy(() -> new SongMetadata("ROCK", null, List.of("HAPPY"), null, null, null, null, "HUMAN", null))
				.isInstanceOf(IllegalArgumentException.class).hasMessageContaining("mood");
		assertThatThrownBy(() -> new SongMetadata("ROCK", null, List.of("DARK", "DARK"), null, null, null, null, "HUMAN", null))
				.isInstanceOf(IllegalArgumentException.class).hasMessageContaining("mood");
		assertThatThrownBy(() -> new SongMetadata("ROCK", null, null, null, null, null,
				List.of("SHUFFLE", "HALF_TIME", "SYNCOPATED", "FILL_HEAVY"), "HUMAN", null))
				.isInstanceOf(IllegalArgumentException.class).hasMessageContaining("drumStyle");
		assertThatThrownBy(() -> new SongMetadata("ROCK", null, null, 0, null, null, null, "HUMAN", null))
				.isInstanceOf(IllegalArgumentException.class).hasMessageContaining("energy");
		assertThatThrownBy(() -> new SongMetadata("ROCK", null, null, 6, null, null, null, "HUMAN", null))
				.isInstanceOf(IllegalArgumentException.class).hasMessageContaining("energy");
		assertThatThrownBy(() -> new SongMetadata("ROCK", null, null, null, 1899, null, null, "HUMAN", null))
				.isInstanceOf(IllegalArgumentException.class).hasMessageContaining("releaseYear");
		assertThatThrownBy(() -> new SongMetadata("ROCK", null, null, null, null, "KR", null, "HUMAN", null))
				.isInstanceOf(IllegalArgumentException.class).hasMessageContaining("language");
		assertThatThrownBy(() -> new SongMetadata("ROCK", null, null, null, null, null, null, "MANUAL", null))
				.isInstanceOf(IllegalArgumentException.class).hasMessageContaining("source");
	}

	@Test
	void 외부_DB_출처는_이용_조건_메모가_있어야_한다() {
		assertThatThrownBy(() -> new SongMetadata("ROCK", null, null, null, null, null, null, "EXTERNAL_DB", " "))
				.isInstanceOf(IllegalArgumentException.class).hasMessageContaining("sourceNote");
		var external = new SongMetadata("ROCK", null, null, null, null, null, null, "EXTERNAL_DB", "MusicBrainz, CC0");
		assertThat(external.sourceNote()).isEqualTo("MusicBrainz, CC0");
		assertThatThrownBy(() -> new SongMetadata("ROCK", null, null, null, null, null, null, "HUMAN", "x".repeat(201)))
				.isInstanceOf(IllegalArgumentException.class).hasMessageContaining("sourceNote");
	}

	@Test
	void 값_목록은_AI_요청_문서와_같다() {
		assertThat(SongMetadata.GENRES).containsExactly("ROCK", "POP", "KPOP", "BALLAD", "JAZZ", "FUNK", "LATIN", "METAL", "PUNK", "HIPHOP",
				"ELECTRONIC", "SOUNDTRACK", "PRACTICE", "OTHER");
		assertThat(SongMetadata.MOODS).containsExactly("CALM", "UPLIFTING", "ENERGETIC", "DARK", "SENTIMENTAL");
		assertThat(SongMetadata.DRUM_STYLES).containsExactly("EIGHT_BEAT", "SIXTEEN_BEAT", "SHUFFLE", "HALF_TIME", "FOUR_ON_FLOOR", "DOUBLE_KICK",
				"SYNCOPATED", "FILL_HEAVY", "LATIN_PERCUSSION");
		assertThat(SongMetadata.LANGUAGES).containsExactly("KO", "EN", "JA", "INSTRUMENTAL", "OTHER");
	}
}
