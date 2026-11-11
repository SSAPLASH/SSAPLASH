package com.ssafy.airdrum.domain.recording.dto;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

import io.swagger.v3.oas.annotations.media.Schema;

import com.ssafy.airdrum.domain.chart.dto.ChartResponses.Signature;
import com.ssafy.airdrum.domain.chart.dto.ChartResponses.Tempo;

/** 녹음 응답(256번 설계 3-3절, 257번 3-4절). 시퀀스(hits)와 템포(timing)는 상세에서만 준다. */
public final class RecordingResponses {
	private RecordingResponses() {
	}

	@Schema(description = "녹음 요약")
	public record RecordingSummary(long id, UUID clientKey, String title, String mode, String inputSource,
			@Schema(description = "연결된 플레이 ID. 없거나 플레이가 지워지면 null") UUID playId,
			@Schema(description = "리듬·악보 녹음의 곡·난이도. 자유·박자 녹음은 null", nullable = true) RecordingSong song,
			int hitCount, int durationMs, Instant startedAt, Instant createdAt, Instant updatedAt) {
	}

	/** 녹음이 기억한 채보 버전의 곡(257 v0.7). 제목은 곡의 현재 제목이며 곡을 지워도(소프트 삭제) 보인다. */
	@Schema(description = "녹음한 곡")
	public record RecordingSong(long songId, String title, @Schema(description = "EASY·NORMAL·HARD") String difficulty) {
	}

	@Schema(description = "녹음 상세. 요약 필드와 템포·타격 시퀀스")
	public record RecordingDetail(long id, UUID clientKey, String title, String mode, String inputSource, UUID playId, RecordingSong song,
			int hitCount, int durationMs, Instant startedAt, Instant createdAt, Instant updatedAt,
			@Schema(description = "녹음이 기억한 채보 버전의 템포(플레이가 지워져도 남음). 자유·박자 녹음은 null", nullable = true) RecordingTiming timing,
			@Schema(description = "타격 시퀀스(tMs 오름차순). stickId가 없는 타격은 키를 생략") List<RecordingRequest.Hit> hits) {

		public static RecordingDetail of(RecordingSummary s, RecordingTiming timing, List<RecordingRequest.Hit> hits) {
			return new RecordingDetail(s.id(), s.clientKey(), s.title(), s.mode(), s.inputSource(), s.playId(), s.song(), s.hitCount(),
					s.durationMs(), s.startedAt(), s.createdAt(), s.updatedAt(), timing, hits);
		}
	}

	/**
	 * MIDI 내보내기용 템포(257번 U13 c). 이름·의미는 채보 API의 {@code timing}과 같고, 곡의 현재 BPM이 아니라 녹음 당시 플레이가
	 * 고정한 채보 버전 값이다. {@code offsetMs}는 곡(반주) 0ms 기준 첫 박 위치다.
	 */
	@Schema(description = "녹음에 연결된 플레이의 채보 버전 템포")
	public record RecordingTiming(long songId, long chartVersionId, double bpm, int offsetMs, String timeSignature, Integer ppq,
			List<Tempo> tempoMap, List<Signature> timeSignatureMap) {
	}
}
