package com.ssafy.airdrum.domain.play.service.livecoach;

import com.ssafy.airdrum.domain.play.exception.LiveCoachError;
import com.ssafy.airdrum.global.worker.WorkerError;

import java.sql.Timestamp;
import java.time.Instant;
import java.util.Set;
import java.util.UUID;
import java.util.regex.Pattern;
import com.ssafy.airdrum.global.error.BusinessException;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;
import tools.jackson.databind.node.ObjectNode;

/**
 * 연주 중 LLM 구간 코칭 작업 큐(설계 COACH-001 연주 중 LLM 코칭 3.3·3.4절).
 * 사용자가 구간 사실을 넣고 결과를 조회하며, GPU 워커가 claim으로 가져가 안내 칸 문구(title·sub)를 제출한다.
 * 늦은 답은 쓸모없어서 임대 15초·시도 1번이고, 만들어진 지 오래된 작업은 가져가지 않고 지운다.
 * 사실(facts)에는 타격 원본·playId·곡 정보가 없다. BE는 모양과 크기만 검사하고 내용을 해석하지 않는다.
 * 습관 설정이 켜져 있으면 사용자의 습관 요약(LiveCoachHabit)을 facts.habit에 붙인다. FE가 보낸 habit은 늘 지운다
 * (설계 COACH-001 습관 개인화 3.6).
 */
@Service
public class LiveCoachQueue {
    /** 임대 시간은 claim SQL의 interval '15 seconds'와 같다. */
    static final int LEASE_SECONDS = 15;
    static final int MAX_TITLE = 8;
    /** 안내 칸 보조 문구 상한. 16자로는 구체적인 지시가 들어가지 않아 20자로 늘렸다(V52, QA 2026-11-16). */
    static final int MAX_SUB = 20;
    /** 이보다 오래 기다린 작업은 워커에 주지 않는다(연주는 이미 다음 구간이다). */
    static final int STALE_SECONDS = 30;
    /** 사용자 조회에서 결과를 보여 주는 최대 나이. 이보다 오래되면 410. */
    static final int EXPIRE_SECONDS = 60;
    /** 만들어진 지 이만큼 지난 행은 지운다. */
    static final int PURGE_SECONDS = 300;
    static final int MAX_FACTS_BYTES = 4096;
    private static final int MAX_MODEL_CHARS = 37;
    private static final Pattern CONTROL = Pattern.compile("\\p{Cntrl}");
    private static final Set<String> FAILURE_CODES = Set.of("INPUT_INVALID", "MODEL_FAILED", "OUTPUT_INVALID");

    private final JdbcTemplate db;
    private final JsonMapper json;
    private final boolean enabled;
    private final int perRun;
    private final int perMinute;
    private final LiveCoachHabit habit;
    private final boolean habitEnabled;

    LiveCoachQueue(JdbcTemplate db, JsonMapper json, LiveCoachHabit habit,
                   @Value("${live-coach.llm.enabled:false}") boolean enabled,
                   @Value("${live-coach.llm.per-run:10}") int perRun,
                   @Value("${live-coach.llm.per-minute:6}") int perMinute,
                   @Value("${live-coach.habit.enabled:false}") boolean habitEnabled) {
        this.db = db;
        this.json = json;
        this.habit = habit;
        this.habitEnabled = habitEnabled;
        this.enabled = enabled;
        this.perRun = Math.max(0, perRun);
        this.perMinute = Math.max(0, perMinute);
    }

    public record Assignment(long jobId, UUID attemptId, Instant leaseExpiresAt, JsonNode facts) {}
    public record Status(String status) {}
    public record Created(UUID requestId, Instant expiresAt) {}
    public record Tip(String status, String title, String sub, String model, Integer generationMs) {}

    boolean enabled() { return enabled; }

    // ---------- 사용자 쪽 ----------

    /**
     * 구간 사실을 넣는다. 꺼져 있으면 null(컨트롤러가 204). 상한을 넘으면 429.
     * 크기 상한은 FE가 보낸 사실(habit 제외)에 건다. BE가 붙이는 습관 요약은 항목 2개라 작다.
     */
    @Transactional
    public Created create(long userId, UUID runId, JsonNode facts) {
        if (!enabled) return null;
        if (runId == null || facts == null || !facts.isObject() || facts.path("contractVersion").asInt(0) != 1)
            throw new BusinessException(LiveCoachError.INVALID);
        ObjectNode stored = ((ObjectNode) facts).deepCopy();
        stored.remove("habit");
        if (json.writeValueAsString(stored).getBytes(java.nio.charset.StandardCharsets.UTF_8).length > MAX_FACTS_BYTES)
            throw new BusinessException(LiveCoachError.INVALID);
        db.update("DELETE FROM live_coach_jobs WHERE created_at < now() - make_interval(secs => ?)", PURGE_SECONDS);
        Integer inRun = db.queryForObject("SELECT count(*)::int FROM live_coach_jobs WHERE user_id=? AND run_id=?",
            Integer.class, userId, runId);
        Integer inMinute = db.queryForObject(
            "SELECT count(*)::int FROM live_coach_jobs WHERE user_id=? AND created_at > now() - interval '60 seconds'",
            Integer.class, userId);
        if ((inRun != null && inRun >= perRun) || (inMinute != null && inMinute >= perMinute))
            throw new BusinessException(LiveCoachError.TOO_MANY);
        if (habitEnabled) habit.forUser(userId).ifPresent(h -> stored.set("habit", h));
        String body = json.writeValueAsString(stored);
        return db.queryForObject("""
            INSERT INTO live_coach_jobs(user_id, run_id, facts) VALUES(?, ?, ?::jsonb)
            RETURNING public_id, created_at
            """, (r, n) -> new Created(r.getObject(1, UUID.class),
                r.getTimestamp(2).toInstant().plusSeconds(EXPIRE_SECONDS)), userId, runId, body);
    }

    /** 자기 요청의 결과. 없거나 남의 것이면 404, 실패·만료면 410, 기다리는 중이면 status만. */
    public Tip find(long userId, UUID requestId) {
        var rows = db.query("""
            SELECT status, title, sub, model, generation_ms, created_at < now() - make_interval(secs => ?)
            FROM live_coach_jobs WHERE public_id=? AND user_id=?
            """, (r, n) -> new Object[] {r.getString(1), r.getString(2), r.getString(3), r.getString(4),
                r.getObject(5, Integer.class), r.getBoolean(6)}, EXPIRE_SECONDS, requestId, userId);
        if (rows.isEmpty()) throw new BusinessException(LiveCoachError.NOT_FOUND);
        Object[] row = rows.getFirst();
        String status = (String) row[0];
        boolean expired = (Boolean) row[5];
        if ("FAILED".equals(status) || expired) throw new BusinessException(LiveCoachError.GONE);
        if (!"DONE".equals(status)) return new Tip(status, null, null, null, null);
        return new Tip(status, (String) row[1], (String) row[2], (String) row[3], (Integer) row[4]);
    }

    // ---------- 워커 쪽 ----------

    @Transactional
    public Assignment claim(String worker, UUID claimRequestId) {
        // 임대가 끝난 작업과 너무 오래 기다린 작업은 실패로 닫는다(시도는 1번이다)
        db.update("""
            UPDATE live_coach_jobs SET status='FAILED', attempt_id=NULL, lease_expires_at=NULL, updated_at=now()
            WHERE (status='RUNNING' AND lease_expires_at<now())
               OR (status='QUEUED' AND created_at < now() - make_interval(secs => ?))
            """, STALE_SECONDS);
        var same = db.query("""
            SELECT id, attempt_id, lease_expires_at, facts::text FROM live_coach_jobs
            WHERE status='RUNNING' AND worker_id=? AND claim_request_id=?
            """, (r, n) -> new Picked(r.getLong(1), r.getObject(2, UUID.class), r.getTimestamp(3), r.getString(4)),
            worker, claimRequestId);
        if (!same.isEmpty()) return assignment(same.getFirst());
        var picked = db.query("""
            UPDATE live_coach_jobs SET status='RUNNING', attempt_id=gen_random_uuid(), worker_id=?, claim_request_id=?,
                lease_expires_at=now()+interval '15 seconds', updated_at=now()
            WHERE id=(SELECT id FROM live_coach_jobs WHERE status='QUEUED' ORDER BY id FOR UPDATE SKIP LOCKED LIMIT 1)
            RETURNING id, attempt_id, lease_expires_at, facts::text
            """, (r, n) -> new Picked(r.getLong(1), r.getObject(2, UUID.class), r.getTimestamp(3), r.getString(4)),
            worker, claimRequestId);
        return picked.isEmpty() ? null : assignment(picked.getFirst());
    }

    @Transactional
    public Status result(long jobId, String worker, UUID attemptId, String title, String sub, String model, Long generationMs) {
        if (attemptId == null || title == null || model == null || generationMs == null) throw new BusinessException(WorkerError.INVALID);
        String t = title.strip();
        String s = sub == null ? "" : sub.strip();
        if (t.isEmpty() || t.length() > MAX_TITLE || s.length() > MAX_SUB || CONTROL.matcher(t + s).find()
                || model.isBlank() || model.length() > MAX_MODEL_CHARS || generationMs < 0 || generationMs > 60_000L)
            throw new BusinessException(WorkerError.INVALID);
        lockRunning(jobId, worker, attemptId);
        db.update("""
            UPDATE live_coach_jobs SET status='DONE', title=?, sub=?, model=?, generation_ms=?,
                attempt_id=NULL, lease_expires_at=NULL, updated_at=now() WHERE id=?
            """, t, s, model, generationMs.intValue(), jobId);
        return new Status("DONE");
    }

    @Transactional
    public Status failure(long jobId, String worker, UUID attemptId, String code, String summary) {
        if (attemptId == null || code == null || !FAILURE_CODES.contains(code)
                || summary == null || summary.length() > 200 || summary.indexOf('\n') >= 0 || summary.indexOf('\r') >= 0)
            throw new BusinessException(WorkerError.INVALID);
        lockRunning(jobId, worker, attemptId);
        db.update("""
            UPDATE live_coach_jobs SET status='FAILED', attempt_id=NULL, lease_expires_at=NULL, updated_at=now() WHERE id=?
            """, jobId);
        return new Status("FAILED");
    }

    private void lockRunning(long jobId, String worker, UUID attemptId) {
        var rows = db.query("""
            SELECT id FROM live_coach_jobs
            WHERE id=? AND status='RUNNING' AND worker_id=? AND attempt_id=? AND lease_expires_at>now() FOR UPDATE
            """, (r, n) -> r.getLong(1), jobId, worker, attemptId);
        if (rows.isEmpty()) throw new BusinessException(WorkerError.CONFLICT);
    }

    private record Picked(long jobId, UUID attemptId, Timestamp lease, String facts) {}

    private Assignment assignment(Picked p) {
        ObjectNode facts = (ObjectNode) json.readTree(p.facts());
        return new Assignment(p.jobId(), p.attemptId(), p.lease().toInstant(), facts);
    }
}
