package com.ssafy.airdrum.domain.song.service.admin;

import java.io.IOException;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.function.Function;
import java.util.regex.Pattern;

import org.springframework.core.io.DefaultResourceLoader;
import org.springframework.core.io.Resource;

import com.ssafy.airdrum.domain.lesson.model.LessonKind;
import com.ssafy.airdrum.domain.lesson.model.LessonSpec;
import com.ssafy.airdrum.domain.song.model.SongMetadata;

import tools.jackson.core.StreamReadFeature;
import tools.jackson.core.json.JsonFactory;
import tools.jackson.databind.DeserializationFeature;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/**
 * 저장소에 둔 공용 곡 카탈로그(254번 설계 3-1절). {@code {location}catalog.json}과 {@code {location}midi/*.mid}를 읽는다.
 * 곡 하나라도 규칙에 어긋나면 카탈로그 전체를 거부한다(일부만 등록되어 상태가 엇갈리지 않게).
 */
public final class BuiltinSongCatalog {

	/**
	 * 카탈로그 한 곡. MIDI는 이미 읽은 바이트다. {@code offsetMs}는 원본 음원 0초 기준 첫 마디 첫 박 시각(ms)으로,
	 * MIDI 0틱 = 음원 0초인 곡에서 솎기 격자의 원점이 된다(260번 설계 3-1절). 생략하면 0.
	 * {@code meta}는 곡 추천용 메타데이터(255번 설계 3-1절)이고 생략하면 null.
	 * {@code lesson}은 입문 코스 레슨 정보(331번 설계 3-1절)이고 레슨이 아닌 곡은 null.
	 */
	record Entry(String title, String artist, String license, boolean published, byte[] midi, int offsetMs, SongMetadata meta, LessonSpec lesson) {
		Entry(String title, String artist, String license, boolean published, byte[] midi, int offsetMs, SongMetadata meta) {
			this(title, artist, license, published, midi, offsetMs, meta, null);
		}
	}

	/** 카탈로그 규칙 위반. 메시지에 원인 곡 제목을 적는다. */
	static final class Invalid extends RuntimeException {
		Invalid(String message) {
			super(message);
		}
	}

	private static final Set<String> FIELDS = Set.of("title", "artist", "license", "midi", "published", "offsetMs", "meta", "lesson");
	private static final Set<String> LESSON_FIELDS = Set.of("order", "kind", "summary", "pads", "guide");
	private static final Set<String> META_FIELDS = Set.of("genre", "subGenres", "mood", "energy", "releaseYear", "language", "drumStyle",
			"source", "sourceNote");
	/** 곡 길이 상한(30분, MIDI 변환 규칙)과 같다. */
	public static final int MAX_OFFSET_MS = 30 * 60 * 1000;
	private static final Pattern MIDI_NAME = Pattern.compile("[A-Za-z0-9][A-Za-z0-9._-]{0,99}\\.mid");
	private static final JsonMapper JSON = JsonMapper.builder(JsonFactory.builder().enable(StreamReadFeature.STRICT_DUPLICATE_DETECTION).build())
			.enable(DeserializationFeature.FAIL_ON_TRAILING_TOKENS).build();

	private BuiltinSongCatalog() {
	}

	/** {@code location}은 끝이 / 인 리소스 위치(예: {@code classpath:builtin-songs/}). */
	static List<Entry> load(String location) {
		var loader = new DefaultResourceLoader();
		byte[] catalog = bytes(loader.getResource(location + "catalog.json"), "catalog.json");
		return parse(catalog, name -> {
			Resource midi = loader.getResource(location + "midi/" + name);
			return midi.exists() ? bytes(midi, name) : null;
		});
	}

	/** {@code files}는 MIDI 파일 이름으로 바이트를 돌려주고, 없으면 null. */
	static List<Entry> parse(byte[] json, Function<String, byte[]> files) {
		JsonNode root;
		try {
			root = JSON.readTree(json);
		} catch (RuntimeException e) {
			throw new Invalid("카탈로그 JSON을 읽을 수 없습니다.");
		}
		if (root == null || !root.isArray()) throw new Invalid("카탈로그는 배열이어야 합니다.");
		var entries = new ArrayList<Entry>();
		var titles = new HashSet<String>();
		int index = 0;
		for (var node : root) {
			index++;
			if (!node.isObject()) throw new Invalid(index + "번째 항목이 객체가 아닙니다.");
			String where = index + "번째(" + (node.path("title").isString() ? node.path("title").asString() : "제목 없음") + ")";
			for (var field : node.propertyNames())
				if (!FIELDS.contains(field)) throw new Invalid(where + ": 모르는 필드 " + field);
			String title = text(node, "title", where, 100, true);
			if (!title.equals(title.strip())) throw new Invalid(where + ": 제목 앞뒤에 공백이 있습니다.");
			String artist = text(node, "artist", where, 100, false);
			String license = text(node, "license", where, 200, true);
			String midiName = text(node, "midi", where, 104, true);
			if (!MIDI_NAME.matcher(midiName).matches()) throw new Invalid(where + ": MIDI 파일 이름이 올바르지 않습니다.");
			boolean published = true;
			if (node.has("published")) {
				if (!node.get("published").isBoolean()) throw new Invalid(where + ": published는 true·false여야 합니다.");
				published = node.get("published").asBoolean();
			}
			int offsetMs = 0;
			if (node.has("offsetMs")) {
				var offset = node.get("offsetMs");
				if (!offset.isIntegralNumber() || !offset.canConvertToInt() || offset.asInt() < 0 || offset.asInt() > MAX_OFFSET_MS)
					throw new Invalid(where + ": offsetMs는 0 이상 " + MAX_OFFSET_MS + " 이하 정수(ms)여야 합니다.");
				offsetMs = offset.asInt();
			}
			SongMetadata meta = node.has("meta") ? meta(node.get("meta"), where) : null;
			LessonSpec lesson = node.has("lesson") ? lesson(node.get("lesson"), where) : null;
			if (!titles.add(title)) throw new Invalid(where + ": 제목이 중복됩니다.");
			byte[] midi = files.apply(midiName);
			if (midi == null) throw new Invalid(where + ": MIDI 파일이 없습니다(" + midiName + ").");
			entries.add(new Entry(title, artist, license, published, midi, offsetMs, meta, lesson));
		}
		lessonOrders(entries);
		return List.copyOf(entries);
	}

	/** 331번 설계 3-1절. 형식은 여기서, 값 규칙은 {@link LessonSpec}이 검사한다. guide는 알아보기(READ) 레슨에만 쓴다. */
	private static LessonSpec lesson(JsonNode node, String where) {
		if (!node.isObject()) throw new Invalid(where + ": lesson은 객체여야 합니다.");
		for (var field : node.propertyNames())
			if (!LESSON_FIELDS.contains(field)) throw new Invalid(where + ": lesson에 모르는 필드 " + field);
		var order = node.get("order");
		if (order == null || !order.isIntegralNumber() || !order.canConvertToInt()) throw new Invalid(where + ": lesson.order는 정수여야 합니다.");
		LessonKind kind = LessonKind.PLAY;
		if (node.has("kind")) {
			if (!node.get("kind").isString()) throw new Invalid(where + ": lesson.kind는 READ·PLAY여야 합니다.");
			try {
				kind = LessonKind.valueOf(node.get("kind").asString());
			} catch (IllegalArgumentException e) {
				throw new Invalid(where + ": lesson.kind는 READ·PLAY여야 합니다.");
			}
		}
		var summary = node.get("summary");
		if (summary == null || !summary.isString()) throw new Invalid(where + ": lesson.summary는 문자열이어야 합니다.");
		var pads = node.get("pads");
		if (pads == null || !pads.isArray()) throw new Invalid(where + ": lesson.pads는 문자열 배열이어야 합니다.");
		var names = new ArrayList<String>();
		for (var pad : pads) {
			if (!pad.isString()) throw new Invalid(where + ": lesson.pads는 문자열 배열이어야 합니다.");
			names.add(pad.asString());
		}
		boolean guide = true;
		if (node.has("guide")) {
			if (kind != LessonKind.READ) throw new Invalid(where + ": lesson.guide는 READ 레슨에만 쓴다.");
			if (!node.get("guide").isBoolean()) throw new Invalid(where + ": lesson.guide는 true·false여야 합니다.");
			guide = node.get("guide").asBoolean();
		}
		try {
			return new LessonSpec(order.asInt(), kind, summary.asString(), names, guide);
		} catch (IllegalArgumentException e) {
			throw new Invalid(where + ": lesson." + e.getMessage());
		}
	}

	/** 레슨 순서는 카탈로그 안에서 겹치지 않고 1부터 빈 번호 없이 이어진다. */
	private static void lessonOrders(List<Entry> entries) {
		var orders = new HashSet<Integer>();
		for (var entry : entries) {
			if (entry.lesson() == null) continue;
			if (!orders.add(entry.lesson().order())) throw new Invalid(entry.title() + ": 레슨 순서 " + entry.lesson().order() + "이 겹칩니다.");
		}
		for (int i = 1; i <= orders.size(); i++)
			if (!orders.contains(i)) throw new Invalid("레슨 순서는 1부터 빈 번호 없이 이어져야 합니다(" + i + "번이 없습니다).");
	}

	/** 255번 설계 3-1절. 형식(객체·문자열·정수·문자열 배열)은 여기서, 값 규칙은 {@link SongMetadata}가 검사한다. */
	private static SongMetadata meta(JsonNode node, String where) {
		if (!node.isObject()) throw new Invalid(where + ": meta는 객체여야 합니다.");
		for (var field : node.propertyNames())
			if (!META_FIELDS.contains(field)) throw new Invalid(where + ": meta에 모르는 필드 " + field);
		try {
			return new SongMetadata(metaText(node, "genre", where), metaList(node, "subGenres", where), metaList(node, "mood", where),
					metaInt(node, "energy", where), metaInt(node, "releaseYear", where), metaText(node, "language", where),
					metaList(node, "drumStyle", where), metaText(node, "source", where), metaText(node, "sourceNote", where));
		} catch (IllegalArgumentException e) {
			throw new Invalid(where + ": meta." + e.getMessage());
		}
	}

	private static String metaText(JsonNode node, String field, String where) {
		if (!node.has(field) || node.get(field).isNull()) return null;
		if (!node.get(field).isString()) throw new Invalid(where + ": meta." + field + "는 문자열이어야 합니다.");
		return node.get(field).asString();
	}

	private static Integer metaInt(JsonNode node, String field, String where) {
		if (!node.has(field) || node.get(field).isNull()) return null;
		var value = node.get(field);
		if (!value.isIntegralNumber() || !value.canConvertToInt()) throw new Invalid(where + ": meta." + field + "는 정수여야 합니다.");
		return value.asInt();
	}

	private static List<String> metaList(JsonNode node, String field, String where) {
		if (!node.has(field) || node.get(field).isNull()) return null;
		var value = node.get(field);
		if (!value.isArray()) throw new Invalid(where + ": meta." + field + "는 문자열 배열이어야 합니다.");
		var values = new ArrayList<String>();
		for (var item : value) {
			if (!item.isString()) throw new Invalid(where + ": meta." + field + "는 문자열 배열이어야 합니다.");
			values.add(item.asString());
		}
		return values;
	}

	private static String text(JsonNode node, String field, String where, int max, boolean required) {
		if (!node.has(field) || node.get(field).isNull()) {
			if (required) throw new Invalid(where + ": " + field + "가 없습니다.");
			return null;
		}
		if (!node.get(field).isString()) throw new Invalid(where + ": " + field + "는 문자열이어야 합니다.");
		String value = node.get(field).asString();
		if (required && value.isBlank()) throw new Invalid(where + ": " + field + "가 비어 있습니다.");
		if (value.codePointCount(0, value.length()) > max) throw new Invalid(where + ": " + field + "는 " + max + "자 이하여야 합니다.");
		return value.isBlank() ? null : value;
	}

	private static byte[] bytes(Resource resource, String name) {
		if (!resource.exists()) throw new Invalid(name + "를 찾을 수 없습니다.");
		try (InputStream in = resource.getInputStream()) {
			return in.readAllBytes();
		} catch (IOException e) {
			throw new Invalid(name + "를 읽을 수 없습니다.");
		}
	}
}
