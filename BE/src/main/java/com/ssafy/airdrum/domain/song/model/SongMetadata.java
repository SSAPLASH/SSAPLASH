package com.ssafy.airdrum.domain.song.model;

import java.util.HashSet;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;

import io.swagger.v3.oas.annotations.media.Schema;

/**
 * 공용 곡의 추천용 메타데이터(255번 설계 3-1절). 필드 이름·값 목록은 AI 요청 문서 COACH-004(Jira 224)와 글자 그대로 같다.
 * 규칙에 어긋나면 만들 수 없다({@link IllegalArgumentException}, 메시지에 필드 이름). 빈 목록은 빈 리스트로 바꾼다.
 */
@Schema(description = "곡 추천용 메타데이터. 값 목록은 AI 요청 문서 COACH-004와 같다")
public record SongMetadata(
		@Schema(description = "대표 장르") String genre,
		@Schema(description = "보조 장르 0~2개") List<String> subGenres,
		@Schema(description = "분위기 0~2개") List<String> mood,
		@Schema(description = "1 잔잔함 ~ 5 매우 격렬함", nullable = true) Integer energy,
		@Schema(description = "처음 발매된 해", nullable = true) Integer releaseYear,
		@Schema(allowableValues = { "KO", "EN", "JA", "INSTRUMENTAL", "OTHER" }, nullable = true) String language,
		@Schema(description = "드럼 스타일 0~3개") List<String> drumStyle,
		@Schema(allowableValues = { "HUMAN", "AUTO", "EXTERNAL_DB" }) String source,
		@Schema(description = "EXTERNAL_DB면 외부 출처와 이용 조건", nullable = true) String sourceNote) {

	public static final List<String> GENRES = List.of("ROCK", "POP", "KPOP", "BALLAD", "JAZZ", "FUNK", "LATIN", "METAL", "PUNK", "HIPHOP",
			"ELECTRONIC", "SOUNDTRACK", "PRACTICE", "OTHER");
	public static final List<String> MOODS = List.of("CALM", "UPLIFTING", "ENERGETIC", "DARK", "SENTIMENTAL");
	public static final List<String> DRUM_STYLES = List.of("EIGHT_BEAT", "SIXTEEN_BEAT", "SHUFFLE", "HALF_TIME", "FOUR_ON_FLOOR", "DOUBLE_KICK",
			"SYNCOPATED", "FILL_HEAVY", "LATIN_PERCUSSION");
	public static final List<String> LANGUAGES = List.of("KO", "EN", "JA", "INSTRUMENTAL", "OTHER");
	public static final List<String> SOURCES = List.of("HUMAN", "AUTO", "EXTERNAL_DB");
	static final int MAX_SOURCE_NOTE = 200;

	public SongMetadata {
		if (genre == null || !GENRES.contains(genre)) throw invalid("genre", "장르 목록 중 하나여야 합니다");
		subGenres = list("subGenres", subGenres, GENRES, 2);
		mood = list("mood", mood, MOODS, 2);
		drumStyle = list("drumStyle", drumStyle, DRUM_STYLES, 3);
		if (energy != null && (energy < 1 || energy > 5)) throw invalid("energy", "1~5 정수여야 합니다");
		if (releaseYear != null && (releaseYear < 1900 || releaseYear > 2099)) throw invalid("releaseYear", "1900~2099여야 합니다");
		if (language != null && !LANGUAGES.contains(language)) throw invalid("language", LANGUAGES + " 중 하나여야 합니다");
		if (source == null || !SOURCES.contains(source)) throw invalid("source", SOURCES + " 중 하나여야 합니다");
		if (sourceNote != null && sourceNote.isBlank()) sourceNote = null;
		if (sourceNote != null && sourceNote.codePointCount(0, sourceNote.length()) > MAX_SOURCE_NOTE)
			throw invalid("sourceNote", MAX_SOURCE_NOTE + "자 이하여야 합니다");
		if ("EXTERNAL_DB".equals(source) && sourceNote == null) throw invalid("sourceNote", "EXTERNAL_DB는 출처와 이용 조건이 필요합니다");
	}

	/** 비슷한 곡(R2)의 장르 집합: 대표 장르와 보조 장르를 합친다(인웅님 합의 11/06). */
	public Set<String> genresWithSub() {
		var genres = new LinkedHashSet<String>();
		genres.add(genre);
		genres.addAll(subGenres);
		return Set.copyOf(genres);
	}

	private static List<String> list(String field, List<String> values, List<String> allowed, int max) {
		if (values == null) return List.of();
		if (values.size() > max) throw invalid(field, "최대 " + max + "개입니다");
		var seen = new HashSet<String>();
		for (var value : values) {
			if (value == null || !allowed.contains(value)) throw invalid(field, "값 목록 밖의 값입니다: " + value);
			if (!seen.add(value)) throw invalid(field, "같은 값이 두 번 있습니다: " + value);
		}
		return List.copyOf(values);
	}

	private static IllegalArgumentException invalid(String field, String reason) {
		return new IllegalArgumentException(field + ": " + reason);
	}
}
