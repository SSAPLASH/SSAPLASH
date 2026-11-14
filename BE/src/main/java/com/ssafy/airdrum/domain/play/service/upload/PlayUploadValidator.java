package com.ssafy.airdrum.domain.play.service.upload;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.Duration;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Map;
import org.springframework.stereotype.Component;
import com.ssafy.airdrum.domain.play.dto.PlayUploadRequest;
import com.ssafy.airdrum.domain.play.exception.PlayErrorCode;
import com.ssafy.airdrum.domain.play.model.PlayJson;
import com.ssafy.airdrum.domain.play.repository.session.PlaySessionRepository;
import com.ssafy.airdrum.domain.report.model.ScoreRule;
import com.ssafy.airdrum.global.error.BusinessException;
import static com.ssafy.airdrum.domain.play.dto.PlayUploadRequest.*;

@Component
public class PlayUploadValidator {
	private final PlayJson json;
	public PlayUploadValidator(PlayJson json) { this.json = json; }
	public void structure(PlayUploadRequest p) {
		check(p != null && p.schemaVersion() != null);
		if (p.schemaVersion() != 1) throw new BusinessException(PlayErrorCode.PLAY_SCHEMA_UNSUPPORTED);
		check(p.playId() != null && p.mode() != null && p.inputSource() != null && p.consent() != null);
		check(p.startedAt() != null && p.endedAt() != null && !p.endedAt().isBefore(p.startedAt()));
		check(p.startedAt().getNano() % 1000 == 0 && p.endedAt().getNano() % 1000 == 0);
		check(p.hits() != null);
		if (Duration.between(p.startedAt(), p.endedAt()).compareTo(Duration.ofHours(2)) > 0 || p.hits().size() > PlayJson.MAX_HITS)
			throw new BusinessException(PlayErrorCode.PLAY_UPLOAD_TOO_LARGE);
		check(p.kitPresetId() == null || p.kitPresetId() > 0);
		if (p.scored()) {
			check(p.songId() != null && p.songId() > 0 && p.chartVersionId() != null && p.chartVersionId() > 0);
			var c = p.judgementContext(); check(c != null && c.schemaVersion() != null);
			if (c.schemaVersion() != 1 || ScoreRule.of(c.judgementVersion()).isEmpty()) throw new BusinessException(PlayErrorCode.PLAY_SCHEMA_UNSUPPORTED);
			check(c.timingWindows() != null && finite(c.timingWindows().perfectMs()) && finite(c.timingWindows().goodMs()));
			check(c.timingWindows().perfectMs() >= 0 && c.timingWindows().goodMs() > c.timingWindows().perfectMs() && c.timingWindows().goodMs() <= 1000);
			check(finite(c.playbackRate()) && c.playbackRate() > 0 && c.playbackRate() <= 4);
			mapping(c.padMapping()); check(c.padMapping() != null);
			check(p.summary() != null && p.summary().score() != null && p.summary().accuracy() != null
					&& p.summary().maxCombo() != null && p.summary().judgementCounts() != null);
			// 해시 정규화 전에 범위·유효 소수 자릿수를 제한하여 짧은 지수 입력의 메모리 확장을 막는다.
			var accuracy = p.summary().accuracy();
			check(accuracy.signum() >= 0 && accuracy.compareTo(BigDecimal.valueOf(100)) <= 0
					&& accuracy.stripTrailingZeros().scale() <= 2);
		} else check(p.songId() == null && p.chartVersionId() == null && p.summary() == null && p.judgementContext() == null);
		if (p.calibration() != null) { check(finite(p.calibration().audioOffsetMs())); poses(p.calibration().pads()); }
		if (p.kitPresetSnapshot() != null) { text(p.kitPresetSnapshot().name(), 100); poses(p.kitPresetSnapshot().pads()); mapping(p.kitPresetSnapshot().keyBindings()); }
		check(p.liveCoachEvents().size() <= 1000);
		for (var e : p.liveCoachEvents()) { check(e != null && finite(e.tMs())); text(e.tag(), 64); text(e.text(), 2048); }
		if (p.clientMeta() != null) {
			var c = p.clientMeta(); check(c.endReason() != null && java.util.Set.of("COMPLETED", "ABORTED", "DISCONNECTED").contains(c.endReason()));
			check(finite(c.lastSongTimeMs()) && finite(c.elapsedActiveMs()) && c.elapsedActiveMs() >= 0);
			if (c.appVersion() != null) text(c.appVersion(), 64); if (c.firmwareVersion() != null) text(c.firmwareVersion(), 64);
		}
		var matched = new HashSet<String>();
		for (int i = 0; i < p.hits().size(); i++) {
			var h = p.hits().get(i); check(h != null && h.seq() != null && h.seq() == i && finite(h.tMs()) && h.pad() != null);
			check(h.stickId() == null || h.stickId() == 0 || h.stickId() == 1);
			check(optionalFinite(h.peakAccel()) && optionalFinite(h.pitch()) && optionalFinite(h.yaw()));
			if (h.matchedNoteId() != null) { text(h.matchedNoteId(), 64); check(matched.add(h.matchedNoteId())); }
			if (h.judgement() == Judgement.MISS) {
				check(h.matchedNoteId() != null && h.deltaMs() == null && h.velocity() == null && h.stickId() == null
						&& h.peakAccel() == null && h.pitch() == null && h.yaw() == null && h.baselinePad() == null && h.predictedPad() == null);
			} else {
				check(h.velocity() != null && h.velocity() >= 0 && h.velocity() <= 127);
				check(h.judgement() == null ? h.matchedNoteId() == null && h.deltaMs() == null : h.matchedNoteId() != null && finite(h.deltaMs()));
			}
			if (!p.scored()) check(h.judgement() == null);
			if (p.inputSource() == InputSource.KEYBOARD) check(h.stickId() == null && h.peakAccel() == null && h.pitch() == null && h.yaw() == null && h.baselinePad() == null && h.predictedPad() == null);
		}
	}
	public void notes(PlayUploadRequest p, PlaySessionRepository.ChartData chart) {
		if (!p.scored()) return;
		if (chart.schemaVersion() != 1) throw new BusinessException(PlayErrorCode.PLAY_SCHEMA_UNSUPPORTED);
		var notes = new HashMap<String, Note>();
		var array = json.mapper().readTree(chart.notes());
		if (!array.isArray() || array.size() != chart.noteCount()) throw new IllegalStateException("저장된 채보 노트 형식 오류");
		for (var n : array) {
			var id = n.get("noteId"); var time = n.get("timeMs"); var pad = n.get("pad");
			if (id == null || !id.isString() || id.asString().isBlank() || time == null || !time.isNumber()
					|| !Double.isFinite(time.doubleValue()) || pad == null || !pad.isString()
					|| notes.put(id.asString(), new Note(time.doubleValue(), pad.asString())) != null)
				throw new IllegalStateException("저장된 채보 노트 형식 오류");
		}
		int perfect = 0, good = 0, miss = 0, combo = 0, maxCombo = 0;
		for (var h : p.hits()) {
			if (h.judgement() == null) continue;
			var n = notes.get(h.matchedNoteId()); check(n != null && (n.pad().equals(h.pad().name())
					|| ("HI_TOM".equals(n.pad()) && h.pad() == Pad.SMALL_TOM)));
			if (h.judgement() == Judgement.MISS) { check(Math.abs(h.tMs() - n.time()) <= .001); miss++; combo = 0; }
			else {
				double realDeltaMs = (h.tMs() - n.time()) / p.judgementContext().playbackRate();
				check(Math.abs(h.deltaMs() - realDeltaMs) <= .001);
				double abs = Math.abs(h.deltaMs()); var w = p.judgementContext().timingWindows();
				if (h.judgement() == Judgement.PERFECT) { check(abs <= w.perfectMs()); perfect++; }
				else { check(abs > w.perfectMs() && abs <= w.goodMs()); good++; }
				maxCombo = Math.max(maxCombo, ++combo);
			}
		}
		// 기록이 보낸 규칙 버전으로 검산한다(structure가 아는 버전만 통과시켰다)
		long score = ScoreRule.of(p.judgementContext().judgementVersion()).orElseThrow().score(perfect, good);
		BigDecimal accuracy = chart.noteCount() == 0 ? BigDecimal.ZERO : BigDecimal.valueOf(score).divide(BigDecimal.valueOf(chart.noteCount()), 2, RoundingMode.HALF_UP);
		var s = p.summary(); check(s.score() == score && s.accuracy().compareTo(accuracy) == 0 && s.maxCombo() == maxCombo
				&& new Counts(perfect, good, miss).equals(s.judgementCounts()));
	}
	private record Note(double time, String pad) {}
	private static void poses(Map<Pad, Pose> values) { if (values != null) { check(values.size() <= 9); values.forEach((k,v) -> check(k != null && v != null && finite(v.pitch()) && finite(v.yaw()))); } }
	private static void mapping(Map<String, Pad> values) { if (values != null) { check(values.size() <= 32); values.forEach((k,v) -> { text(k, 64); check(v != null); }); } }
	private static boolean optionalFinite(Float n) { return n == null || Float.isFinite(n); }
	public static boolean finite(Double n) { return n != null && Double.isFinite(n); }
	public static void text(String s, int max) { check(s != null && !s.isBlank() && s.length() <= max); }
	public static void check(boolean condition) { if (!condition) throw new BusinessException(PlayErrorCode.PLAY_PAYLOAD_INVALID); }
}
