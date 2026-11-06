package com.ssafy.airdrum.chart;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashSet;
import java.util.List;
import java.util.regex.Pattern;
import org.springframework.stereotype.Component;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;
import com.ssafy.airdrum.common.error.BusinessException;
import static com.ssafy.airdrum.chart.ChartResponses.*;

/** 저장 JSON을 공개 DTO로 제한해 매핑한다. 원문·내부 키를 예외 메시지에 넣지 않는다. */
@Component
public class ChartDocumentReader {
	private static final Pattern PAD_PATTERN = Pattern.compile("[A-Z][A-Z0-9_]{0,31}");
	private final JsonMapper json;
	public ChartDocumentReader(JsonMapper json) { this.json = json; }

	public ChartDetail detail(ChartVersionRepository.Detail row) {
		requireSchema(row.getSchemaVersion());
		Timing timing = timing(row.getTiming());
		var notes = notes(row.getNotes(), row.getNoteCount());
		return new ChartDetail(row.getChartId(), row.getSongId(), row.getTitle(), row.getSource(),
				row.getDifficulty(), row.getChartVersionId(), row.getVersion(), row.getSchemaVersion(),
				timing.bpm(), timing.offsetMs(), timing.timeSignature(), signature(timing.timeSignature())[0],
				row.getDurationMs(), timing, row.getNoteCount(), notes, row.getNotationStatus(),
				hasImages(row.getSheetPages()));
	}

	/** 상세 조회와 난이도 산정이 같은 노트 유효성 규칙을 사용한다. */
	public List<Note> notes(String raw, int noteCount) {
		var array = parse(raw);
		check(array.isArray() && array.size() == noteCount);
		var ids = new HashSet<String>();
		var notes = new ArrayList<Note>();
		double previous = -1;
		for (var node : array) {
			String id = text(node, "noteId");
			check(id.length() <= 64 && ids.add(id));
			double time = number(node, "timeMs");
			check(time >= 0 && time >= previous);
			previous = time;
			String pad = text(node, "pad");
			check(PAD_PATTERN.matcher(pad).matches());
			Integer velocity = optionalInt(node, "velocityHint");
			check(velocity == null || (velocity >= 0 && velocity <= 127));
			Notation notation = null;
			if (present(node, "notation")) {
				var n = node.get("notation");
				long tick = integer(n, "tick");
				long duration = integer(n, "durationTicks");
				int voice = intValue(n, "voice");
				check(tick >= 0 && duration > 0 && voice > 0);
				notation = new Notation(tick, duration, voice);
			}
			var hihatOpen = node.get("hihatOpen");
			notes.add(new Note(id, time, pad, velocity, notation,
					"HIHAT".equals(pad) && hihatOpen != null && hihatOpen.isBoolean() ? hihatOpen.booleanValue() : null));
		}
		return List.copyOf(notes);
	}

	public Timing timing(String raw) {
		var n = parse(raw);
		check(n.isObject());
		double bpm = number(n, "bpm");
		check(bpm > 0);
		int offset = intValue(n, "offsetMs");
		String timeSignature = text(n, "timeSignature");
		int[] initial = signature(timeSignature);
		Integer ppq = optionalInt(n, "ppq");
		check(ppq == null || ppq > 0);
		List<Tempo> tempos = null;
		if (present(n, "tempoMap")) {
			var array = n.get("tempoMap");
			check(array.isArray() && !array.isEmpty());
			var values = new ArrayList<Tempo>();
			long previous = -1;
			for (var t : array) {
				long tick = integer(t, "tick");
				double rate = number(t, "bpm");
				check(tick >= 0 && tick > previous && rate > 0);
				values.add(new Tempo(tick, rate));
				previous = tick;
			}
			check(values.getFirst().tick() == 0 && Double.compare(values.getFirst().bpm(), bpm) == 0);
			tempos = List.copyOf(values);
		}
		List<Signature> signatures = null;
		if (present(n, "timeSignatureMap")) {
			var array = n.get("timeSignatureMap");
			check(array.isArray() && !array.isEmpty());
			var values = new ArrayList<Signature>();
			long previous = -1;
			for (var t : array) {
				long tick = integer(t, "tick");
				int numerator = intValue(t, "numerator");
				int denominator = intValue(t, "denominator");
				check(tick >= 0 && tick > previous && numerator > 0 && validDenominator(denominator));
				values.add(new Signature(tick, numerator, denominator));
				previous = tick;
			}
			check(values.getFirst().tick() == 0 && values.getFirst().numerator() == initial[0]
					&& values.getFirst().denominator() == initial[1]);
			signatures = List.copyOf(values);
		}
		return new Timing(bpm, offset, timeSignature, ppq, tempos, signatures);
	}

	public List<StoredPage> pages(String raw) {
		if (raw == null) return List.of();
		var array = parse(raw);
		check(array.isArray());
		var pages = new ArrayList<StoredPage>();
		for (var n : array) {
			int page = intValue(n, "page");
			long from = integer(n, "fromTick"), to = integer(n, "toTick");
			check(page > 0 && from >= 0 && to > from);
			pages.add(new StoredPage(page, text(n, "imageKey"), from, to));
		}
		pages.sort(Comparator.comparingInt(StoredPage::page));
		long end = -1;
		int page = 0;
		for (var p : pages) {
			check(p.page() == ++page && p.fromTick() >= end);
			end = p.toTick();
		}
		return List.copyOf(pages);
	}

	public double milliseconds(Timing timing, long tick) {
		if (timing.ppq() == null || timing.tempoMap() == null || tick < 0)
			throw new BusinessException(ChartErrorCode.CHART_SHEET_TIMING_UNAVAILABLE);
		double ms = timing.offsetMs();
		var map = timing.tempoMap();
		for (int i = 0; i < map.size(); i++) {
			var tempo = map.get(i);
			if (tick <= tempo.tick()) break;
			long end = i + 1 < map.size() ? Math.min(tick, map.get(i + 1).tick()) : tick;
			ms += (end - tempo.tick()) * 60000.0 / timing.ppq() / tempo.bpm();
		}
		if (!Double.isFinite(ms)) throw new BusinessException(ChartErrorCode.CHART_SHEET_TIMING_UNAVAILABLE);
		return ms;
	}

	public static void requireSchema(int schema) {
		if (schema != 1) throw new BusinessException(ChartErrorCode.CHART_SCHEMA_UNSUPPORTED);
	}
	private boolean hasImages(String raw) {
		if (raw == null) return false;
		var n = parse(raw);
		check(n.isArray());
		return !n.isEmpty();
	}
	private JsonNode parse(String raw) {
		try { var n = json.readTree(raw); check(n != null); return n; }
		catch (RuntimeException ex) { throw invalid(); }
	}
	private static String text(JsonNode node, String field) {
		var value = node.get(field);
		check(value != null && value.isString() && !value.asString().isBlank());
		return value.asString();
	}
	private static double number(JsonNode node, String field) {
		var value = node.get(field);
		check(value != null && value.isNumber() && Double.isFinite(value.doubleValue()));
		return value.doubleValue();
	}
	private static long integer(JsonNode node, String field) {
		var value = node.get(field);
		check(value != null && value.isIntegralNumber() && value.canConvertToLong());
		return value.longValue();
	}
	private static int intValue(JsonNode node, String field) {
		long value = integer(node, field);
		check(value >= Integer.MIN_VALUE && value <= Integer.MAX_VALUE);
		return (int) value;
	}
	private static Integer optionalInt(JsonNode node, String field) {
		return present(node, field) ? intValue(node, field) : null;
	}
	private static boolean present(JsonNode node, String field) {
		return node.has(field) && !node.get(field).isNull();
	}
	private static int[] signature(String value) {
		check(value.matches("[1-9][0-9]*/[1-9][0-9]*"));
		try {
			var parts = value.split("/");
			int numerator = Integer.parseInt(parts[0]), denominator = Integer.parseInt(parts[1]);
			check(validDenominator(denominator));
			return new int[] { numerator, denominator };
		} catch (NumberFormatException ex) { throw invalid(); }
	}
	private static boolean validDenominator(int value) { return value > 0 && (value & (value - 1)) == 0; }
	private static void check(boolean condition) { if (!condition) throw invalid(); }
	private static IllegalStateException invalid() { return new IllegalStateException("저장된 채보 데이터 형식이 올바르지 않습니다."); }
	public record StoredPage(int page, String imageKey, long fromTick, long toTick) {}
}
