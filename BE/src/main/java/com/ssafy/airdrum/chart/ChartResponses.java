package com.ssafy.airdrum.chart;

import java.time.Instant;
import java.util.List;

public final class ChartResponses {
	private ChartResponses() {}
	public record ChartDetail(Long id, Long songId, String title, String source, String difficulty,
			Long chartVersionId, int version, int schemaVersion, double bpm, int offsetMs,
			String timeSignature, int beatsPerBar, Integer durationMs, Timing timing,
			int noteCount, List<Note> notes, String notationStatus, boolean hasSheetImages) {}
	public record Note(String noteId, double timeMs, String pad, Integer velocityHint, Notation notation) {}
	public record Notation(long tick, long durationTicks, int voice) {}
	public record Timing(double bpm, int offsetMs, String timeSignature, Integer ppq,
			List<Tempo> tempoMap, List<Signature> timeSignatureMap) {}
	public record Tempo(long tick, double bpm) {}
	public record Signature(long tick, int numerator, int denominator) {}
	public record ChartAssets(Long chartVersionId, String notationStatus, List<SheetPage> sheetPages,
			String accompanimentUrl, Instant assetsExpireAt) {}
	public record SheetPage(int page, String imageUrl, long fromTick, long toTick, double fromMs, double toMs) {}
}
