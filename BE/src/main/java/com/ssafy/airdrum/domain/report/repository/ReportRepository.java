package com.ssafy.airdrum.domain.report.repository;

import java.util.UUID;
import java.util.Arrays;
import java.util.List;
import com.ssafy.airdrum.domain.report.dto.ReportNotesResponse;
import com.ssafy.airdrum.domain.report.dto.ReportResponse;
import com.ssafy.airdrum.domain.report.exception.ReportErrorCode;
import com.ssafy.airdrum.domain.report.model.ReportAggregate;
import com.ssafy.airdrum.domain.report.model.ScoreRule;
import com.ssafy.airdrum.global.error.BusinessException;
import com.ssafy.airdrum.domain.report.model.ReportAggregate.Counts;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.json.JsonMapper;

@Repository
public class ReportRepository {
	private final JdbcTemplate db;
	private final JsonMapper json;
	public ReportRepository(JdbcTemplate db, JsonMapper json) { this.db = db; this.json = json; }
	/** 소유자와 리포트 존재 여부만 읽는다. 노트 페이지 조회에 통계 JSON을 읽지 않는다. */
	public void requireReport(long userId, UUID playId) {
		var rows = db.query("""
			SELECT s.mode,r.id FROM play_sessions s LEFT JOIN reports r ON r.play_session_id=s.id
			WHERE s.id=? AND s.user_id=?
			""", (r,n) -> ("RHYTHM".equals(r.getString(1)) || "SHEET".equals(r.getString(1)))
					&& r.getObject(2) != null, playId, userId);
		if (rows.isEmpty()) throw new BusinessException(ReportErrorCode.PLAY_NOT_FOUND);
		if (!rows.getFirst()) throw new BusinessException(ReportErrorCode.REPORT_NOT_FOUND);
	}
	public ReportResponse find(long userId, UUID playId) {
		return db.query("""
			SELECT r.id,s.id AS play_id,s.score,s.accuracy,s.max_combo,s.judgement_counts::text,
				r.timing_histogram::text,r.pad_stats::text,s.mode,s.input_source,s.client_meta->>'endReason' AS end_reason,
				r.analysis_status,r.weak_segments::text,r.recommended_drills::text,r.generator_version,r.generated_at,
				r.coach_summary::text,s.song_id,v.chart_id,c.difficulty,s.judgement_context->>'judgementVersion' AS judgement_version,
				COALESCE((s.judgement_context->>'playbackRate')::numeric, 1) AS playback_rate
			FROM play_sessions s JOIN reports r ON r.play_session_id=s.id
			LEFT JOIN chart_versions v ON v.id=s.chart_version_id LEFT JOIN charts c ON c.id=v.chart_id
			WHERE s.id=? AND s.user_id=?
			""", (r,n) -> {
				// 그 기록의 점수 규칙. 판정 기록은 업로드 검증을 거쳐 아는 버전만 있다(모르면 처음 규칙 V1)
				ScoreRule rule = ScoreRule.of(r.getString("judgement_version")).orElse(ScoreRule.SCORE_V1);
				return new ReportResponse(r.getLong("id"), r.getObject("play_id", UUID.class),
				r.getInt("score"), r.getBigDecimal("accuracy"), r.getInt("max_combo"),
				json.readValue(r.getString("judgement_counts"), Counts.class),
				json.readValue(r.getString("timing_histogram"), ReportAggregate.TimingHistogram.class),
				Arrays.stream(json.readValue(r.getString("pad_stats"), ReportAggregate.PadStats[].class))
						.map(p -> ReportResponse.PadStats.from(p, rule)).toList(),
				r.getString("mode"), r.getString("input_source"), r.getString("end_reason"),
				ReportResponse.AnalysisStatus.valueOf(r.getString("analysis_status")),
				r.getString("weak_segments") == null ? null : json.readTree(r.getString("weak_segments")),
				r.getString("recommended_drills") == null ? null : json.readTree(r.getString("recommended_drills")),
				r.getString("generator_version"), r.getTimestamp("generated_at").toInstant(),
				r.getString("coach_summary") == null ? null : json.readTree(r.getString("coach_summary")),
				r.getObject("song_id", Long.class), r.getObject("chart_id", Long.class), r.getString("difficulty"), r.getDouble("playback_rate"));
			}, playId, userId)
				.stream().findFirst().orElseThrow(() -> new BusinessException(ReportErrorCode.REPORT_NOT_FOUND));
	}
	public List<ReportNotesResponse.Item> notes(long userId, UUID playId, int afterSeq, int fetchSize) {
		return notes(userId, playId, afterSeq, fetchSize, null, null);
	}
	/** fromMs 이상 toMs 미만인 노트만. 노트 시각은 PERFECT·GOOD이 t_ms-delta_ms*playbackRate, MISS가 t_ms다. 둘 다 null이면 전체. */
	public List<ReportNotesResponse.Item> notes(long userId, UUID playId, int afterSeq, int fetchSize, Double fromMs, Double toMs) {
		return db.query("""
			SELECT h.seq,h.matched_note_id,h.t_ms,h.pad,h.judgement,h.delta_ms,h.velocity
			FROM hits h JOIN play_sessions s ON s.id=h.play_session_id
			CROSS JOIN LATERAL (SELECT h.t_ms - COALESCE(h.delta_ms, 0)
				    * COALESCE((s.judgement_context->>'playbackRate')::double precision, 1) AS note_ms) note
			WHERE s.id=? AND s.user_id=? AND h.judgement IS NOT NULL AND h.seq>?
				AND (?::double precision IS NULL OR note.note_ms>=?::double precision)
				AND (?::double precision IS NULL OR note.note_ms<?::double precision)
			ORDER BY h.seq LIMIT ?
			""", (r,n) -> new ReportNotesResponse.Item(r.getInt(1),r.getString(2),r.getDouble(3),
					"HI_TOM".equals(r.getString(4)) ? "SMALL_TOM" : r.getString(4),
					r.getString(5),r.getObject(6,Double.class),r.getObject(7,Integer.class)), playId,userId,afterSeq,
				fromMs,fromMs,toMs,toMs,fetchSize);
	}
	/** 세션·hits와 동일 트랜잭션에서만 저장한다. 재전송은 이 경로에 진입하지 않는다. */
	@Transactional(propagation = Propagation.MANDATORY)
	public void insert(UUID playId, ReportAggregate report) {
		db.update("""
			INSERT INTO reports(play_session_id,timing_histogram,pad_stats,generator_version,analysis_status)
			VALUES (?,?::jsonb,?::jsonb,?,'PENDING')
			""", playId, json.writeValueAsString(report.timingHistogram()),
				json.writeValueAsString(report.padStats()), ReportAggregate.GENERATOR_VERSION);
	}
}
