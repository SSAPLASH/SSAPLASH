package com.ssafy.airdrum.recording;

import java.time.Instant;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Comparator;
import java.util.List;

import org.springframework.stereotype.Component;

import com.ssafy.airdrum.common.error.BusinessException;
import com.ssafy.airdrum.play.PlayUploadRequest.InputSource;
import com.ssafy.airdrum.play.PlayUploadRequest.Mode;

/**
 * 녹음 요청 검사와 정규화(256번 설계 3-2절). 제목을 다듬고 타격을 {@code tMs}로 안정 정렬한 새 요청을 돌려준다(설계 U4 c).
 * 패드 별칭 {@code HI_TOM}은 역직렬화 때 이미 {@code SMALL_TOM}이 된다.
 */
@Component
class RecordingValidator {
	static final int MAX_HITS = 50_000;
	static final int MAX_DURATION_MS = 2 * 60 * 60 * 1000;
	static final int MAX_TITLE = 100;
	/** DB timestamptz 범위 밖 시각이 INSERT에서 500이 되지 않게 받는 범위를 좁힌다(검증 D2). */
	static final Instant MIN_STARTED_AT = Instant.parse("2020-01-01T00:00:00Z");
	static final Instant MAX_STARTED_AT = Instant.parse("2100-01-01T00:00:00Z");

	RecordingRequest normalize(RecordingRequest p) {
		check(p != null && p.schemaVersion() != null);
		if (p.schemaVersion() != 1) throw new BusinessException(RecordingError.RECORDING_SCHEMA_UNSUPPORTED);
		check(p.clientKey() != null && p.mode() != null && p.inputSource() != null && p.startedAt() != null
				&& p.durationMs() != null && p.hits() != null);
		check(p.startedAt().getNano() % 1000 == 0 && !p.startedAt().isBefore(MIN_STARTED_AT) && p.startedAt().isBefore(MAX_STARTED_AT));
		String title = title(p.title());
		check(p.durationMs() >= 0);
		if (p.durationMs() > MAX_DURATION_MS || p.hits().size() > MAX_HITS)
			throw new BusinessException(RecordingError.RECORDING_TOO_LARGE);
		check(!p.hits().isEmpty());

		double last = 0;
		for (var h : p.hits()) {
			check(h != null && h.tMs() != null && Double.isFinite(h.tMs()) && h.tMs() >= 0 && h.pad() != null);
			check(h.velocity() != null && h.velocity() >= 0 && h.velocity() <= 127);
			check(h.stickId() == null || h.stickId() == 0 || h.stickId() == 1);
			if (p.inputSource() == InputSource.KEYBOARD) check(h.stickId() == null);
			last = Math.max(last, h.tMs());
		}
		check(last <= p.durationMs());

		// -0.0은 0.0보다 앞에 정렬되고 해시도 달라지므로 0.0으로 바꾼다(검증 D3). List.sort는 안정 정렬이라 같은 시각은 받은 순서를 지킨다.
		var hits = new ArrayList<RecordingRequest.Hit>(p.hits().size());
		for (var h : p.hits())
			hits.add(h.tMs() == 0 ? new RecordingRequest.Hit(0.0, h.pad(), h.velocity(), h.stickId()) : h);
		hits.sort(Comparator.comparingDouble(RecordingRequest.Hit::tMs));
		return new RecordingRequest(p.schemaVersion(), p.clientKey(), title, p.mode(), p.inputSource(), p.playId(),
				p.startedAt(), p.durationMs(), List.copyOf(hits));
	}

	/** 목록 검색어. 비었으면 전체, 앞뒤 공백 제거 뒤 100자(코드 포인트)까지. ILIKE용으로 ! % _를 escape한 패턴을 돌려준다. */
	static String searchPattern(String q) {
		String stripped = q == null ? "" : q.strip();
		check(stripped.codePointCount(0, stripped.length()) <= MAX_TITLE);
		return "%" + stripped.replace("!", "!!").replace("%", "!%").replace("_", "!_") + "%";
	}

	/** 목록 정렬. null이면 NEWEST. NEWEST면 true, OLDEST면 false, 그 밖은 400. */
	static boolean newest(String sort) {
		if (sort == null || sort.equals("NEWEST")) return true;
		check(sort.equals("OLDEST"));
		return false;
	}

	/** 목록 모드 필터. null이면 전체(null), 그 밖에는 플레이 로그와 같은 4개 값만. 빈 문자열도 400. */
	static String modeFilter(String mode) {
		if (mode == null) return null;
		check(Arrays.stream(Mode.values()).anyMatch(m -> m.name().equals(mode)));
		return mode;
	}

	static String title(String value) {
		check(value != null);
		String stripped = value.strip();
		// DB varchar(100)과 같이 코드 포인트로 센다(검증 D4).
		check(!stripped.isEmpty() && stripped.codePointCount(0, stripped.length()) <= MAX_TITLE && stripped.indexOf(0) < 0);
		// 짝 없는 서로게이트는 UTF-8로 못 바꿔 DB에 ?로 저장된다(257 검증 D8). 짝이 맞으면 한 코드 포인트로 묶여 걸리지 않는다.
		check(stripped.codePoints().noneMatch(cp -> cp >= Character.MIN_SURROGATE && cp <= Character.MAX_SURROGATE));
		return stripped;
	}

	private static void check(boolean condition) {
		if (!condition) throw new BusinessException(RecordingError.RECORDING_INVALID);
	}
}
