package com.ssafy.airdrum.domain.report.service.narrative;

import com.ssafy.airdrum.global.worker.WorkerError;

import java.nio.charset.StandardCharsets;
import java.util.UUID;
import com.ssafy.airdrum.global.error.BusinessException;
import com.ssafy.airdrum.domain.play.support.PlayFixtures;
import com.ssafy.airdrum.domain.play.model.PlayJson;
import com.ssafy.airdrum.domain.play.service.upload.PlayUploadService;
import com.ssafy.airdrum.domain.report.repository.AnalysisRepository;
import com.ssafy.airdrum.domain.report.repository.ReportRepository;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import tools.jackson.databind.json.JsonMapper;
import static org.assertj.core.api.Assertions.*;

/** LLM 총평 작업 큐(AI/docs/coach-narrative.md): 총평 저장과 작업 생성, claim·result·failure, 임대 만료, 사실(facts)과 이전 플레이 비교. */
@SpringBootTest
class CoachNarrativeQueueTest {
    private static final String WEAK = """
        [{"fromMs":100.0,"toMs":200.0,"pattern":"MISS_CLUSTER","description":"d","tip":"t","detail":"x","severityLevel":"MEDIUM",
          "causeTags":["MISS"],"pads":["SNARE"],"metrics":{"severity":0.67,"missRate":0.5,"missCount":1,"noteCount":2,"scope":"SEGMENT"}}]
        """;
    private static final String SUMMARY = """
        {"level":"FAIR","text":"규칙 문장이에요.","focusPattern":"MISS_CLUSTER","strengthPad":"KICK","source":"RULE"}
        """;
    @Autowired JdbcTemplate db;
    @Autowired CoachNarrativeQueue queue;
    @Autowired AnalysisRepository analysis;
    @Autowired ReportRepository reports;
    @Autowired PlayUploadService upload;
    @Autowired PlayJson playJson;
    @Autowired JsonMapper json;
    long user, song, chart, version;
    UUID play;

    @BeforeEach void seed() {
        user = db.queryForObject("INSERT INTO users(nickname) VALUES('총평 테스트') RETURNING id", Long.class);
        song = db.queryForObject("INSERT INTO songs(owner_id,title,source) VALUES(?,'곡','MIDI') RETURNING id", Long.class, user);
        chart = db.queryForObject("INSERT INTO charts(song_id,difficulty) VALUES(?,'NORMAL') RETURNING id", Long.class, song);
        version = db.queryForObject("""
            INSERT INTO chart_versions(chart_id,version,notes,timing,notation_status,note_count,generator)
            VALUES(?,1,'[{"noteId":"n1","timeMs":100,"pad":"SNARE"},{"noteId":"n2","timeMs":200,"pad":"KICK"}]',
            '{}','PENDING',2,'MANUAL') RETURNING id
            """, Long.class, chart);
        play = UUID.randomUUID();
    }

    @AfterEach void cleanup() {
        db.update("DELETE FROM play_sessions WHERE user_id=?", user);
        db.update("DELETE FROM chart_versions WHERE id=?", version);
        db.update("DELETE FROM charts WHERE id=?", chart);
        db.update("DELETE FROM songs WHERE id=?", song);
        db.update("DELETE FROM users WHERE id=?", user);
    }

    /** 업로드하고 약점 분석을 DONE으로 만든 뒤 총평을 저장한다(작업이 하나 만들어진다). */
    private UUID analyzedPlay() throws Exception {
        UUID id = UUID.randomUUID();
        String body = PlayFixtures.scored(id, song, version);
        var request = playJson.read(new java.io.ByteArrayInputStream(body.getBytes(StandardCharsets.UTF_8)));
        assertThat(upload.upload(user, request).created()).isTrue();
        var lease = analysis.claim(id);
        assertThat(lease).isNotNull();
        analysis.done(lease, WEAK, "weak-rules-0.3");
        analysis.saveSummary(id, SUMMARY);
        return id;
    }

    private long jobOf(UUID id) {
        return db.queryForObject("SELECT j.id FROM coach_narrative_jobs j JOIN reports r ON r.id=j.report_id WHERE r.play_session_id=?", Long.class, id);
    }

    private String field(UUID id, String sql) {
        return db.queryForObject(sql, String.class, id);
    }

    @Test void savingSummaryCreatesOneQueuedJobAndKeepsKnownFields() throws Exception {
        play = analyzedPlay();
        analysis.saveSummary(play, SUMMARY); // 두 번째 저장은 아무것도 바꾸지 않는다
        assertThat(db.queryForObject("SELECT count(*) FROM coach_narrative_jobs", Long.class)).isEqualTo(1L);
        assertThat(field(play, "SELECT j.status FROM coach_narrative_jobs j JOIN reports r ON r.id=j.report_id WHERE r.play_session_id=?")).isEqualTo("QUEUED");
        var stored = json.readTree(field(play, "SELECT coach_summary::text FROM reports WHERE play_session_id=?"));
        assertThat(stored.path("level").asString()).isEqualTo("FAIR");
        assertThat(stored.path("strengthPad").asString()).isEqualTo("KICK");
        assertThat(stored.path("source").asString()).isEqualTo("RULE");
        assertThat(reports.find(user, play).coachSummary().path("focusPattern").asString()).isEqualTo("MISS_CLUSTER");
    }

    @Test void summaryIsNotSavedBeforeAnalysisIsDone() throws Exception {
        UUID id = UUID.randomUUID();
        var request = playJson.read(new java.io.ByteArrayInputStream(PlayFixtures.scored(id, song, version).getBytes(StandardCharsets.UTF_8)));
        upload.upload(user, request);
        analysis.saveSummary(id, SUMMARY); // 분석이 아직 PENDING이라 저장하지 않는다
        assertThat(db.queryForObject("SELECT count(*) FROM coach_narrative_jobs", Long.class)).isZero();
        assertThat(reports.find(user, id).coachSummary()).isNull();
    }

    @Test void claimBuildsFactsWithoutIdentifiersAndIsIdempotentPerRequest() throws Exception {
        play = analyzedPlay();
        UUID request = UUID.randomUUID();
        var first = queue.claim("worker1", request);
        assertThat(first).isNotNull();
        assertThat(queue.claim("worker1", request).attemptId()).isEqualTo(first.attemptId()); // 같은 요청은 같은 배정
        assertThat(queue.claim("worker2", UUID.randomUUID())).isNull(); // 다른 워커는 가져갈 작업이 없다
        var facts = first.facts();
        assertThat(facts.path("contractVersion").asInt()).isEqualTo(1);
        assertThat(facts.path("level").asString()).isEqualTo("FAIR");
        assertThat(facts.path("focusPattern").asString()).isEqualTo("MISS_CLUSTER");
        assertThat(facts.path("strengthPad").asString()).isEqualTo("KICK");
        assertThat(facts.path("counts").path("perfect").asInt()).isEqualTo(1);
        assertThat(facts.path("counts").path("miss").asInt()).isEqualTo(1);
        assertThat(facts.path("segments").size()).isEqualTo(1);
        var segment = facts.path("segments").get(0);
        assertThat(segment.path("pattern").asString()).isEqualTo("MISS_CLUSTER");
        assertThat(segment.path("severityLevel").asString()).isEqualTo("MEDIUM");
        assertThat(segment.path("scope").asString()).isEqualTo("SEGMENT");
        assertThat(segment.path("metrics").has("scope")).isFalse();
        assertThat(facts.has("history")).isFalse();
        String text = facts.toString();
        assertThat(text).doesNotContain(play.toString()).doesNotContain("playId").doesNotContain("userId").doesNotContain("songId").doesNotContain("hits");
    }

    @Test void resultOverwritesOnlyTextAndSourceAndClosesTheJob() throws Exception {
        play = analyzedPlay();
        var job = queue.claim("worker1", UUID.randomUUID());
        assertThat(queue.result(job.jobId(), "worker1", job.attemptId(), "  코치가 쓴 문장이에요.  ", "gemma3:4b", 1200L).status()).isEqualTo("DONE");
        var stored = json.readTree(field(play, "SELECT coach_summary::text FROM reports WHERE play_session_id=?"));
        assertThat(stored.path("text").asString()).isEqualTo("코치가 쓴 문장이에요.");
        assertThat(stored.path("source").asString()).isEqualTo("LLM");
        assertThat(stored.path("level").asString()).isEqualTo("FAIR");
        assertThat(stored.path("focusPattern").asString()).isEqualTo("MISS_CLUSTER");
        assertThat(field(play, "SELECT j.status FROM coach_narrative_jobs j JOIN reports r ON r.id=j.report_id WHERE r.play_session_id=?")).isEqualTo("DONE");
        assertThatThrownBy(() -> queue.result(job.jobId(), "worker1", job.attemptId(), "또 제출", "m", 1L)) // 이미 닫힌 작업
            .isInstanceOf(BusinessException.class).extracting(e -> ((BusinessException) e).getErrorCode()).isEqualTo(WorkerError.CONFLICT);
    }

    @Test void resultRejectsWrongAttemptWrongWorkerAndInvalidText() throws Exception {
        play = analyzedPlay();
        var job = queue.claim("worker1", UUID.randomUUID());
        assertCode(() -> queue.result(job.jobId(), "worker1", UUID.randomUUID(), "문장이에요.", "m", 1L), WorkerError.CONFLICT);
        assertCode(() -> queue.result(job.jobId(), "worker2", job.attemptId(), "문장이에요.", "m", 1L), WorkerError.CONFLICT);
        assertCode(() -> queue.result(job.jobId(), "worker1", job.attemptId(), "가".repeat(501), "m", 1L), WorkerError.INVALID);
        assertCode(() -> queue.result(job.jobId(), "worker1", job.attemptId(), "   ", "m", 1L), WorkerError.INVALID);
        assertCode(() -> queue.result(job.jobId(), "worker1", job.attemptId(), "줄\n바꿈", "m", 1L), WorkerError.INVALID);
        assertCode(() -> queue.result(job.jobId(), "worker1", job.attemptId(), "문장이에요.", "", 1L), WorkerError.INVALID);
        assertCode(() -> queue.result(job.jobId(), "worker1", job.attemptId(), "문장이에요.", "m", -1L), WorkerError.INVALID);
        // 거절된 제출은 작업과 총평을 바꾸지 않는다
        assertThat(field(play, "SELECT j.status FROM coach_narrative_jobs j JOIN reports r ON r.id=j.report_id WHERE r.play_session_id=?")).isEqualTo("RUNNING");
        assertThat(json.readTree(field(play, "SELECT coach_summary::text FROM reports WHERE play_session_id=?")).path("source").asString()).isEqualTo("RULE");
    }

    @Test void retryableFailureRequeuesOnceThenFailsAndKeepsRuleSummary() throws Exception {
        play = analyzedPlay();
        var first = queue.claim("worker1", UUID.randomUUID());
        assertThat(queue.failure(first.jobId(), "worker1", first.attemptId(), "MODEL_FAILED", true, "로컬 모델 서버 오류").status()).isEqualTo("QUEUED");
        var second = queue.claim("worker1", UUID.randomUUID());
        assertThat(second.jobId()).isEqualTo(first.jobId());
        assertThat(second.attemptId()).isNotEqualTo(first.attemptId());
        assertThat(db.queryForObject("SELECT attempt_count FROM coach_narrative_jobs WHERE id=?", Integer.class, second.jobId())).isEqualTo(2);
        assertThat(queue.failure(second.jobId(), "worker1", second.attemptId(), "MODEL_FAILED", true, "다시 실패").status()).isEqualTo("FAILED"); // 시도를 다 썼다
        assertThat(queue.claim("worker1", UUID.randomUUID())).isNull();
        assertThat(json.readTree(field(play, "SELECT coach_summary::text FROM reports WHERE play_session_id=?")).path("source").asString()).isEqualTo("RULE");
    }

    @Test void failureValidatesCodeRetryableAndSummary() throws Exception {
        play = analyzedPlay();
        var job = queue.claim("worker1", UUID.randomUUID());
        assertCode(() -> queue.failure(job.jobId(), "worker1", job.attemptId(), "WHATEVER", false, "x"), WorkerError.INVALID);
        assertCode(() -> queue.failure(job.jobId(), "worker1", job.attemptId(), "OUTPUT_INVALID", true, "x"), WorkerError.INVALID); // 재시도는 MODEL_FAILED만
        assertCode(() -> queue.failure(job.jobId(), "worker1", job.attemptId(), "MODEL_FAILED", false, "a\nb"), WorkerError.INVALID);
        assertCode(() -> queue.failure(job.jobId(), "worker1", job.attemptId(), "MODEL_FAILED", false, "x".repeat(201)), WorkerError.INVALID);
        assertThat(queue.failure(job.jobId(), "worker1", job.attemptId(), "OUTPUT_INVALID", false, "가드레일 거절").status()).isEqualTo("FAILED");
    }

    @Test void expiredLeaseReturnsTheJobAndTheLastAttemptFailsIt() throws Exception {
        play = analyzedPlay();
        var first = queue.claim("worker1", UUID.randomUUID());
        db.update("UPDATE coach_narrative_jobs SET lease_expires_at=now()-interval '1 second' WHERE id=?", first.jobId());
        assertCode(() -> queue.result(first.jobId(), "worker1", first.attemptId(), "늦은 제출이에요.", "m", 1L), WorkerError.CONFLICT); // 임대가 끝난 제출
        var second = queue.claim("worker2", UUID.randomUUID()); // 다른 워커가 이어받는다
        assertThat(second).isNotNull();
        assertThat(second.jobId()).isEqualTo(first.jobId());
        db.update("UPDATE coach_narrative_jobs SET lease_expires_at=now()-interval '1 second' WHERE id=?", second.jobId());
        assertThat(queue.claim("worker3", UUID.randomUUID())).isNull(); // 시도 2번을 다 써서 실패로 닫힌다
        assertThat(db.queryForObject("SELECT status FROM coach_narrative_jobs WHERE id=?", String.class, second.jobId())).isEqualTo("FAILED");
    }

    @Test void factsIncludeThePreviousPlayOfTheSameSongOnlyForLaterPlays() throws Exception {
        UUID earlier = analyzedPlay();
        db.update("UPDATE play_sessions SET started_at=started_at-interval '1 day', ended_at=ended_at-interval '1 day' WHERE id=?", earlier);
        UUID later = analyzedPlay();
        var first = queue.claim("worker1", UUID.randomUUID()); // 먼저 만들어진 작업 = 이전 플레이
        assertThat(first.facts().has("history")).isFalse(); // 가장 오래된 플레이는 비교할 기록이 없다
        queue.failure(first.jobId(), "worker1", first.attemptId(), "INPUT_INVALID", false, "시험");
        var second = queue.claim("worker1", UUID.randomUUID());
        var history = second.facts().path("history");
        assertThat(history.path("sameSongPlays").asInt()).isEqualTo(1);
        assertThat(history.path("previous").path("counts").path("perfect").asInt()).isEqualTo(1);
        assertThat(history.path("previous").path("counts").path("miss").asInt()).isEqualTo(1);
        assertThat(history.path("previous").path("topPatterns").get(0).asString()).isEqualTo("MISS_CLUSTER");
        assertThat(second.facts().toString()).doesNotContain(earlier.toString()).doesNotContain(later.toString());
    }

    @Test void notesCanBeFilteredToASegmentByNoteTime() throws Exception {
        play = analyzedPlay();
        // PERFECT 노트는 100ms(100.125-0.125), MISS 노트는 200ms. fromMs 이상 toMs 미만.
        assertThat(reports.notes(user, play, -1, 10, null, null)).hasSize(2);
        assertThat(reports.notes(user, play, -1, 10, 0.0, 150.0)).extracting("judgement").containsExactly("PERFECT");
        assertThat(reports.notes(user, play, -1, 10, 150.0, 250.0)).extracting("judgement").containsExactly("MISS");
        assertThat(reports.notes(user, play, -1, 10, 100.0, 200.0)).extracting("judgement").containsExactly("PERFECT"); // toMs는 미포함
        assertThat(reports.notes(user, play, -1, 10, 300.0, 400.0)).isEmpty();
    }

    private static void assertCode(org.assertj.core.api.ThrowableAssert.ThrowingCallable call, WorkerError expected) {
        assertThatThrownBy(call).isInstanceOf(BusinessException.class)
            .extracting(e -> ((BusinessException) e).getErrorCode()).isEqualTo(expected);
    }
}
