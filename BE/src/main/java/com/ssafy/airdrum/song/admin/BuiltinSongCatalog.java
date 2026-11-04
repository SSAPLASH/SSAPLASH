package com.ssafy.airdrum.song.admin;

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

import tools.jackson.core.StreamReadFeature;
import tools.jackson.core.json.JsonFactory;
import tools.jackson.databind.DeserializationFeature;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/**
 * 저장소에 둔 공용 곡 카탈로그(254번 설계 3-1절). {@code {location}catalog.json}과 {@code {location}midi/*.mid}를 읽는다.
 * 곡 하나라도 규칙에 어긋나면 카탈로그 전체를 거부한다(일부만 등록되어 상태가 엇갈리지 않게).
 */
final class BuiltinSongCatalog {

	/** 카탈로그 한 곡. MIDI는 이미 읽은 바이트다. */
	record Entry(String title, String artist, String license, boolean published, byte[] midi) {
	}

	/** 카탈로그 규칙 위반. 메시지에 원인 곡 제목을 적는다. */
	static final class Invalid extends RuntimeException {
		Invalid(String message) {
			super(message);
		}
	}

	private static final Set<String> FIELDS = Set.of("title", "artist", "license", "midi", "published");
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
			if (!titles.add(title)) throw new Invalid(where + ": 제목이 중복됩니다.");
			byte[] midi = files.apply(midiName);
			if (midi == null) throw new Invalid(where + ": MIDI 파일이 없습니다(" + midiName + ").");
			entries.add(new Entry(title, artist, license, published, midi));
		}
		return List.copyOf(entries);
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
