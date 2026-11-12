package com.ssafy.airdrum.domain.report.service.narrative;

import com.ssafy.airdrum.global.worker.WorkerError;

import java.sql.Timestamp;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import java.util.regex.Pattern;
import com.ssafy.airdrum.global.error.BusinessException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;
import tools.jackson.databind.node.ObjectNode;

/**
 * LLM 총평 작업 큐 (AI/docs/coach-narrative.md). GPU 워커가 claim으로 사실(facts)을 가져가 문장을 쓰고 result로 제출하면
 * 리포트의 coach_summary.text를 그 문장으로 덮어쓴다. 실패하거나 임대가 끝나면 규칙 총평이 그대로 남는다.
 * 사실에는 타격 원본·회원 번호·playId를 담지 않는다.
 */
@Service
public class CoachNarrativeQueue {
    /** 임대 시간은 claim SQL의 interval '120 seconds'와 같다. */
    static final int LEASE_SECONDS = 120;
    static final int MAX_TEXT_CHARS = 500;
    private static final int MAX_MODEL_CHARS = 37;
    private static final Pattern CONTROL = Pattern.compile("\\p{Cntrl}");
    private static final Set<String> FAILURE_CODES = Set.of("INPUT_INVALID", "MODEL_FAILED", "OUTPUT_INVALID");
    private final JdbcTemplate db;
    private final JsonMapper json;

    CoachNarrativeQueue(JdbcTemplate db, JsonMapper json) { this.db = db; this.json = json; }

    public record Assignment(long jobId, UUID attemptId, Instant leaseExpiresAt, ObjectNode facts) {}
    public record Status(String status) {}

    @Transactional
    public Assignment claim(String worker, UUID claimRequestId) {
        // 임대가 끝난 작업을 되돌린다. 시도를 다 썼으면 실패로 닫는다.
        db.update("""
            UPDATE coach_narrative_jobs SET status=CASE WHEN attempt_count>=2 THEN 'FAILED' ELSE 'QUEUED' END,
                attempt_id=NULL, lease_expires_at=NULL, updated_at=now()
            WHERE status='RUNNING' AND lease_expires_at<now()
            """);
        // 같은 요청의 재시도는 같은 배정을 돌려준다.
        var same = db.query("""
            SELECT id, report_id, attempt_id, lease_expires_at FROM coach_narrative_jobs
            WHERE status='RUNNING' AND worker_id=? AND claim_request_id=?
            """, (r, n) -> new Picked(r.getLong(1), r.getLong(2), r.getObject(3, UUID.class), r.getTimestamp(4)),
                worker, claimRequestId);
        if (!same.isEmpty()) return assignment(same.getFirst());
        var picked = db.query("""
            UPDATE coach_narrative_jobs SET status='RUNNING', attempt_count=attempt_count+1, attempt_id=gen_random_uuid(),
                worker_id=?, claim_request_id=?, lease_expires_at=now()+interval '120 seconds', updated_at=now()
            WHERE id=(SELECT id FROM coach_narrative_jobs WHERE status='QUEUED' ORDER BY id FOR UPDATE SKIP LOCKED LIMIT 1)
            RETURNING id, report_id, attempt_id, lease_expires_at
            """, (r, n) -> new Picked(r.getLong(1), r.getLong(2), r.getObject(3, UUID.class), r.getTimestamp(4)),
                worker, claimRequestId);
        return picked.isEmpty() ? null : assignment(picked.getFirst());
    }

    @Transactional
    public Status result(long jobId, String worker, UUID attemptId, String text, String model, Long generationMs) {
        if (attemptId == null || text == null || model == null || generationMs == null) throw new BusinessException(WorkerError.INVALID);
        String body = text.strip();
        if (body.isEmpty() || body.length() > MAX_TEXT_CHARS || CONTROL.matcher(body).find()
                || model.isBlank() || model.length() > MAX_MODEL_CHARS || generationMs < 0 || generationMs > 3_600_000L)
            throw new BusinessException(WorkerError.INVALID);
        long reportId = lockRunning(jobId, worker, attemptId);
        int changed = db.update("""
            UPDATE reports SET coach_summary=jsonb_set(jsonb_set(coach_summary,'{text}',to_jsonb(?::text)),'{source}','"LLM"'::jsonb)
            WHERE id=? AND coach_summary IS NOT NULL
            """, body, reportId);
        if (changed == 0) { close(jobId, "FAILED"); throw new BusinessException(WorkerError.CONFLICT); }
        close(jobId, "DONE");
        return new Status("DONE");
    }

    @Transactional
    public Status failure(long jobId, String worker, UUID attemptId, String code, boolean retryable, String summary) {
        if (attemptId == null || code == null || !FAILURE_CODES.contains(code) || (retryable && !"MODEL_FAILED".equals(code))
                || summary == null || summary.length() > 200 || summary.indexOf('\n') >= 0 || summary.indexOf('\r') >= 0)
            throw new BusinessException(WorkerError.INVALID);
        lockRunning(jobId, worker, attemptId);
        int attempts = db.queryForObject("SELECT attempt_count FROM coach_narrative_jobs WHERE id=?", Integer.class, jobId);
        String next = retryable && attempts < 2 ? "QUEUED" : "FAILED";
        close(jobId, next);
        return new Status(next);
    }

    /** 이 워커가 이 시도로 임대 중인 작업이어야 한다. 아니면 409. 리포트 번호를 돌려준다. */
    private long lockRunning(long jobId, String worker, UUID attemptId) {
        var rows = db.query("""
            SELECT report_id FROM coach_narrative_jobs
            WHERE id=? AND status='RUNNING' AND worker_id=? AND attempt_id=? AND lease_expires_at>now() FOR UPDATE
            """, (r, n) -> r.getLong(1), jobId, worker, attemptId);
        if (rows.isEmpty()) throw new BusinessException(WorkerError.CONFLICT);
        return rows.getFirst();
    }

    private void close(long jobId, String status) {
        db.update("""
            UPDATE coach_narrative_jobs SET status=?, attempt_id=NULL, lease_expires_at=NULL, updated_at=now() WHERE id=?
            """, status, jobId);
    }

    /** 행만 읽어 둔 배정. 사실(facts)은 결과 집합을 닫은 뒤에 만든다(읽는 도중 다른 쿼리를 돌리지 않는다). */
    private record Picked(long jobId, long reportId, UUID attemptId, Timestamp lease) {}

    private Assignment assignment(Picked p) {
        return new Assignment(p.jobId(), p.attemptId(), p.lease().toInstant(), facts(p.reportId()));
    }

    // ---------- 사실 만들기 ----------

    /** 저장된 리포트에서 사실을 만든다. 타격 원본·회원 번호·playId·songId는 담지 않는다. */
    ObjectNode facts(long reportId) {
        var row = db.query("""
            SELECT r.coach_summary::text, r.weak_segments::text, s.judgement_counts::text, s.user_id, s.song_id,
                   s.started_at, s.id
            FROM reports r JOIN play_sessions s ON s.id=r.play_session_id WHERE r.id=?
            """, (r, n) -> new Source(r.getString(1), r.getString(2), r.getString(3), r.getLong(4),
                r.getObject(5, Long.class), r.getTimestamp(6), r.getObject(7, UUID.class)), reportId).stream().findFirst()
            .orElseThrow(() -> new BusinessException(WorkerError.UNAVAILABLE));
        JsonNode summary = json.readTree(row.summary());
        ObjectNode facts = json.createObjectNode();
        facts.put("contractVersion", 1);
        facts.put("level", summary.path("level").asString("FAIR"));
        if (summary.path("focusPattern").isString()) facts.put("focusPattern", summary.path("focusPattern").asString());
        facts.set("counts", counts(json.readTree(row.counts())));
        if (summary.path("strengthPad").isString()) facts.put("strengthPad", summary.path("strengthPad").asString());
        var segments = facts.putArray("segments");
        if (row.segments() != null) {
            for (JsonNode s : json.readTree(row.segments())) {
                if (segments.size() >= 5) break;
                segments.add(segment(s));
            }
        }
        if (row.songId() != null) history(row).ifPresent(h -> facts.set("history", h));
        return facts;
    }

    private record Source(String summary, String segments, String counts, long userId, Long songId,
                          Timestamp startedAt, UUID playId) {}

    private ObjectNode counts(JsonNode counts) {
        ObjectNode out = json.createObjectNode();
        out.put("perfect", counts.path("perfect").asInt(0));
        out.put("good", counts.path("good").asInt(0));
        out.put("miss", counts.path("miss").asInt(0));
        return out;
    }

    private ObjectNode segment(JsonNode s) {
        ObjectNode out = json.createObjectNode();
        out.put("pattern", s.path("pattern").asString(""));
        JsonNode metrics = s.path("metrics");
        out.put("severityLevel", s.path("severityLevel").isString() ? s.path("severityLevel").asString()
                : level(metrics.path("severity").asDouble(0)));
        var pads = out.putArray("pads");
        for (JsonNode p : s.path("pads")) if (p.isString()) pads.add(p.asString());
        out.put("fromMs", s.path("fromMs").asDouble());
        out.put("toMs", s.path("toMs").asDouble());
        out.put("scope", "SEGMENT".equals(metrics.path("scope").asString()) ? "SEGMENT" : "WHOLE");
        ObjectNode m = json.createObjectNode();
        for (var e : metrics.properties()) {
            if (!"scope".equals(e.getKey()) && (e.getValue().isNumber() || e.getValue().isString())) m.set(e.getKey(), e.getValue());
        }
        out.set("metrics", m);
        return out;
    }

    /** AI의 severityLevel 기준과 같다(0.4 미만 LOW, 0.7 미만 MEDIUM, 그 이상 HIGH). 단계가 없는 옛 항목을 위한 보정이다. */
    static String level(double severity) { return severity >= 0.7 ? "HIGH" : severity >= 0.4 ? "MEDIUM" : "LOW"; }

    /** 같은 사용자·같은 곡의 이전 플레이. 바로 직전 리포트의 판정 개수와 상위 약점만 담는다. */
    private java.util.Optional<ObjectNode> history(Source now) {
        Integer plays = db.queryForObject("""
            SELECT count(*)::int FROM play_sessions p JOIN reports r ON r.play_session_id=p.id
            WHERE p.user_id=? AND p.song_id=? AND p.started_at<? AND p.id<>? AND p.judgement_counts IS NOT NULL
            """, Integer.class, now.userId(), now.songId(), now.startedAt(), now.playId());
        if (plays == null || plays < 1) return java.util.Optional.empty();
        var prev = db.query("""
            SELECT p.judgement_counts::text, r.weak_segments::text FROM play_sessions p JOIN reports r ON r.play_session_id=p.id
            WHERE p.user_id=? AND p.song_id=? AND p.started_at<? AND p.id<>? AND p.judgement_counts IS NOT NULL
            ORDER BY p.started_at DESC LIMIT 1
            """, (r, n) -> new String[] {r.getString(1), r.getString(2)}, now.userId(), now.songId(), now.startedAt(), now.playId());
        if (prev.isEmpty()) return java.util.Optional.empty();
        ObjectNode out = json.createObjectNode();
        out.put("sameSongPlays", plays);
        ObjectNode previous = out.putObject("previous");
        previous.set("counts", counts(json.readTree(prev.getFirst()[0])));
        var top = previous.putArray("topPatterns");
        if (prev.getFirst()[1] != null) {
            List<JsonNode> found = new ArrayList<>();
            json.readTree(prev.getFirst()[1]).forEach(found::add);
            found.sort(Comparator.comparingDouble((JsonNode s) -> s.path("metrics").path("severity").asDouble(0)).reversed());
            Set<String> seen = new LinkedHashSet<>();
            for (JsonNode s : found) if (s.path("pattern").isString()) seen.add(s.path("pattern").asString());
            seen.stream().limit(3).forEach(top::add);
        }
        return java.util.Optional.of(out);
    }
}
