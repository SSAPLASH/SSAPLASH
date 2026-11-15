package com.ssafy.airdrum.domain.report.repository;

import java.util.List;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;
import tools.jackson.databind.json.JsonMapper;
import tools.jackson.databind.node.ObjectNode;

@Repository
public class AnalysisRepository {
    private final JdbcTemplate db;
    private final JsonMapper json;
    public AnalysisRepository(JdbcTemplate db, JsonMapper json) { this.db = db; this.json = json; }
    public record Lease(UUID playId, UUID token, int attempts) {}
    public record Hit(int seq, double tMs, Integer stickId, String pad, String baselinePad, String predictedPad,
                      Integer velocity, Float peakAccel, String judgement, String matchedNoteId, Double deltaMs) {}

    // 짧은 단일 SQL로 시도 횟수와 임대를 함께 획득한다. HTTP 호출 중 DB 잠금을 유지하지 않는다.
    public Lease claim(UUID playId) {
        UUID token = UUID.randomUUID();
        return db.query("""
            UPDATE reports SET analysis_attempt_count=analysis_attempt_count+1, analysis_lease_token=?,
                analysis_lease_until=now()+interval '60 seconds', analysis_next_attempt_at=NULL
            WHERE play_session_id=? AND analysis_status='PENDING' AND analysis_attempt_count<2
                AND (analysis_lease_until IS NULL OR analysis_lease_until<now())
                AND (analysis_next_attempt_at IS NULL OR analysis_next_attempt_at<=now())
            RETURNING analysis_attempt_count
            """, (r,n) -> new Lease(playId, token, r.getInt(1)), token, playId).stream().findFirst().orElse(null);
    }
    public List<UUID> recoverable() {
        // 마지막 시도 중 프로세스가 종료된 경우 재시도 예산을 늘리지 않는다.
        db.update("""
            UPDATE reports SET analysis_status='FAILED', analysis_lease_token=NULL, analysis_lease_until=NULL
            WHERE analysis_status='PENDING' AND analysis_attempt_count>=2 AND analysis_lease_until<now()
            """);
        return db.queryForList("""
            SELECT play_session_id FROM reports WHERE analysis_status='PENDING' AND analysis_attempt_count<2
            AND (analysis_lease_until IS NULL OR analysis_lease_until<now())
            AND (analysis_next_attempt_at IS NULL OR analysis_next_attempt_at<=now()) ORDER BY id LIMIT 100
            """, UUID.class);
    }
    public ObjectNode request(UUID playId) {
        var rows = db.query("""
            SELECT s.song_id,s.chart_version_id,s.mode,s.judgement_context::text,c.difficulty
            FROM play_sessions s JOIN chart_versions v ON v.id=s.chart_version_id
            JOIN charts c ON c.id=v.chart_id WHERE s.id=?
            """, (r,n) -> {
            ObjectNode body=json.createObjectNode();
            body.put("playId",playId.toString()); body.put("songId",r.getLong(1));
            body.put("chartVersionId",r.getLong(2)); body.put("mode",r.getString(3));
            var context = json.readTree(r.getString(4));
            body.set("timingWindows",context.path("timingWindows"));
            body.put("playbackRate",context.path("playbackRate").asDouble(1.0));
            body.put("difficulty",r.getString(5)); return body;
        }, playId);
        if (rows.isEmpty()) return null;
        var hits=db.query("""
            SELECT seq,t_ms,stick_id,pad,baseline_pad,predicted_pad,velocity,peak_accel,judgement,matched_note_id,delta_ms
            FROM hits WHERE play_session_id=? ORDER BY seq
            """, (r,n) -> new Hit(r.getInt(1),r.getDouble(2),r.getObject(3,Integer.class),r.getString(4),
                r.getString(5),r.getString(6),r.getObject(7,Integer.class),r.getObject(8,Float.class),
                r.getString(9),r.getString(10),r.getObject(11,Double.class)), playId);
        rows.getFirst().set("hits",json.valueToTree(hits));
        return rows.getFirst();
    }
    public void done(Lease lease, String segments, String analyzerVersion) {
        int updated=db.update("""
            UPDATE reports SET weak_segments=?::jsonb, generator_version=generator_version || '+' || ?,
                analysis_status='DONE',analysis_lease_token=NULL,analysis_lease_until=NULL,analysis_next_attempt_at=NULL
            WHERE play_session_id=? AND analysis_status='PENDING' AND analysis_lease_token=?
              AND length(generator_version)+1+length(?)<=50
            """,segments,analyzerVersion,lease.playId(),lease.token(),analyzerVersion);
        if(updated==0) failure(lease,false);
    }
    /** 분석이 DONE일 때만 총평을 저장하고 LLM 총평 작업을 하나 만든다. 이미 있으면 아무것도 하지 않는다. */
    public void saveSummary(UUID playId, String summary) {
        int saved=db.update("""
            UPDATE reports SET coach_summary=?::jsonb
            WHERE play_session_id=? AND analysis_status='DONE' AND coach_summary IS NULL
            """,summary,playId);
        if(saved==1) db.update("""
            INSERT INTO coach_narrative_jobs(report_id) SELECT id FROM reports WHERE play_session_id=?
            ON CONFLICT (report_id) DO NOTHING
            """,playId);
    }
    public void failure(Lease lease, boolean retryable) {
        db.update("""
            UPDATE reports SET analysis_status=CASE WHEN ? AND analysis_attempt_count<2 THEN 'PENDING' ELSE 'FAILED' END,
                analysis_next_attempt_at=CASE WHEN ? AND analysis_attempt_count<2 THEN now()+interval '2 seconds' ELSE NULL END,
                analysis_lease_token=NULL,analysis_lease_until=NULL
            WHERE play_session_id=? AND analysis_status='PENDING' AND analysis_lease_token=?
            """,retryable,retryable,lease.playId(),lease.token());
    }
}
