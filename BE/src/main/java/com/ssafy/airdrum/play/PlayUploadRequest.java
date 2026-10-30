package com.ssafy.airdrum.play;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import com.fasterxml.jackson.annotation.JsonAlias;
import io.swagger.v3.oas.annotations.media.Schema;

/** schemaVersion=1의 전송 계약. 선택 필드는 null, 필수 필드는 검증기로 검사한다. */
public record PlayUploadRequest(
		Integer schemaVersion, UUID playId, Mode mode, InputSource inputSource,
		Long songId, Long chartVersionId, Long kitPresetId, KitSnapshot kitPresetSnapshot,
		Calibration calibration, JudgementContext judgementContext, Instant startedAt, Instant endedAt,
		@Schema(requiredMode = Schema.RequiredMode.REQUIRED) Boolean consent,
		Summary summary, List<Hit> hits, List<CoachEvent> liveCoachEvents, ClientMeta clientMeta) {
	public PlayUploadRequest {
		liveCoachEvents = liveCoachEvents == null ? List.of() : List.copyOf(liveCoachEvents);
	}
	public enum Mode { RHYTHM, FREE, TEMPO, SHEET }
	public enum InputSource { KEYBOARD, STICK }
	public enum Judgement { PERFECT, GOOD, MISS }
	public enum Pad { HIHAT, SNARE, @JsonAlias("HI_TOM") SMALL_TOM, MID_TOM, FLOOR_TOM, CRASH, RIDE, KICK, HIHAT_PEDAL }
	public record Hit(Integer seq, Double tMs, Integer stickId, Pad pad, Pad baselinePad,
			Pad predictedPad, Integer velocity, Float peakAccel, Float pitch, Float yaw,
			Judgement judgement, String matchedNoteId, Double deltaMs) {}
	public record Summary(Integer score, BigDecimal accuracy, Integer maxCombo, Counts judgementCounts) {
		public Summary {
			// 동일 수치 표현을 보존하되 0e-큰지수 등이 PostgreSQL numeric 범위를 넘지 않게 정규화한다.
			accuracy = accuracy == null ? null : accuracy.stripTrailingZeros();
		}
	}
	public record Counts(Integer perfect, Integer good, Integer miss) {}
	public record TimingWindows(Double perfectMs, Double goodMs) {}
	public record JudgementContext(Integer schemaVersion, String judgementVersion,
			TimingWindows timingWindows, Double playbackRate, Map<String, Pad> padMapping) {}
	public record Pose(Double pitch, Double yaw) {}
	public record Calibration(Double audioOffsetMs, Map<Pad, Pose> pads) {}
	public record KitSnapshot(String name, Map<Pad, Pose> pads, Map<String, Pad> keyBindings) {}
	public record CoachEvent(Double tMs, String tag, String text) {}
	public record ClientMeta(String endReason, Double lastSongTimeMs, Double elapsedActiveMs,
			String appVersion, String firmwareVersion) {}
	public boolean scored() { return mode == Mode.RHYTHM || mode == Mode.SHEET; }
}
