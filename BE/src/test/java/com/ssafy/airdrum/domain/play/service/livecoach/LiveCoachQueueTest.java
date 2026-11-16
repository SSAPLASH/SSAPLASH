package com.ssafy.airdrum.domain.play.service.livecoach;

import com.ssafy.airdrum.domain.play.exception.LiveCoachError;
import com.ssafy.airdrum.global.worker.WorkerError;

import java.util.UUID;
import com.ssafy.airdrum.global.error.BusinessException;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;
import static org.assertj.core.api.Assertions.*;

/** 연주 중 LLM 구간 코칭 큐(설계 3.3·3.4): 요청·조회·상한·만료, 워커 claim·result·failure, 오래된 작업. */
@SpringBootTest(properties = {"live-coach.llm.enabled=true", "live-coach.llm.per-run=3", "live-coach.llm.per-minute=5"})
class LiveCoachQueueTest {
    @Autowired JdbcTemplate db;
    @Autowired LiveCoachQueue queue;
    @Autowired JsonMapper json;
    long user, other;

    @BeforeEach void seed() {
        user = db.queryForObject("INSERT INTO users(nickname) VALUES('구간 코칭') RETURNING id", Long.class);
        other = db.queryForObject("INSERT INTO users(nickname) VALUES('다른 사람') RETURNING id", Long.class);
    }

    @AfterEach void cleanup() {
        db.update("DELETE FROM live_coach_jobs WHERE user_id IN (?, ?)", user, other);
        db.update("DELETE FROM users WHERE id IN (?, ?)", user, other);
    }

    private JsonNode facts() {
        return json.readTree("""
            {"contractVersion":1,"segment":{"index":0,"fromBar":1,"toBar":4},"input":"stick",
             "counts":{"perfect":10,"good":4,"miss":2},"stage":1}
            """);
    }

    private static final UUID RUN = UUID.randomUUID();

    @Test void requestClaimResultAndFind() {
        var created = queue.create(user, RUN, facts());
        assertThat(created.requestId()).isNotNull();
        assertThat(queue.find(user, created.requestId()).status()).isEqualTo("QUEUED");

        var a = queue.claim("worker1", UUID.randomUUID());
        assertThat(a).isNotNull();
        assertThat(a.facts().path("segment").path("toBar").asInt()).isEqualTo(4);
        assertThat(queue.find(user, created.requestId()).status()).isEqualTo("RUNNING");

        assertThat(queue.result(a.jobId(), "worker1", a.attemptId(), " 스틱을 낮게 ", "높이는 주먹 하나만큼", "gemma3:4b", 1100L).status())
            .isEqualTo("DONE");
        var tip = queue.find(user, created.requestId());
        assertThat(tip).isEqualTo(new LiveCoachQueue.Tip("DONE", "스틱을 낮게", "높이는 주먹 하나만큼", "gemma3:4b", 1100));
    }

    @Test void claimIsIdempotentForTheSameRequest() {
        queue.create(user, RUN, facts());
        UUID claim = UUID.randomUUID();
        var a = queue.claim("worker1", claim);
        assertThat(queue.claim("worker1", claim).attemptId()).isEqualTo(a.attemptId());
        assertThat(queue.claim("worker1", UUID.randomUUID())).isNull();
    }

    @Test void othersCannotSeeTheResult() {
        var created = queue.create(user, RUN, facts());
        assertThatThrownBy(() -> queue.find(other, created.requestId()))
            .isInstanceOfSatisfying(BusinessException.class, e -> assertThat(e.getErrorCode()).isEqualTo(LiveCoachError.NOT_FOUND));
    }

    @Test void perRunAndPerMinuteLimits() {
        for (int i = 0; i < 3; i++) queue.create(user, RUN, facts());
        assertThatThrownBy(() -> queue.create(user, RUN, facts()))
            .isInstanceOfSatisfying(BusinessException.class, e -> assertThat(e.getErrorCode()).isEqualTo(LiveCoachError.TOO_MANY));
        // 다른 판이어도 1분 상한(5)은 남는다
        queue.create(user, UUID.randomUUID(), facts());
        queue.create(user, UUID.randomUUID(), facts());
        assertThatThrownBy(() -> queue.create(user, UUID.randomUUID(), facts()))
            .isInstanceOfSatisfying(BusinessException.class, e -> assertThat(e.getErrorCode()).isEqualTo(LiveCoachError.TOO_MANY));
    }

    @Test void invalidFactsAreRejected() {
        assertThatThrownBy(() -> queue.create(user, RUN, json.readTree("{\"contractVersion\":2}")))
            .isInstanceOfSatisfying(BusinessException.class, e -> assertThat(e.getErrorCode()).isEqualTo(LiveCoachError.INVALID));
        assertThatThrownBy(() -> queue.create(user, null, facts())).isInstanceOf(BusinessException.class);
        String big = "{\"contractVersion\":1,\"pad\":\"" + "x".repeat(LiveCoachQueue.MAX_FACTS_BYTES) + "\"}";
        assertThatThrownBy(() -> queue.create(user, RUN, json.readTree(big))).isInstanceOf(BusinessException.class);
    }

    @Test void failedAndExpiredRequestsAreGone() {
        var failed = queue.create(user, RUN, facts());
        var a = queue.claim("worker1", UUID.randomUUID());
        assertThat(queue.failure(a.jobId(), "worker1", a.attemptId(), "OUTPUT_INVALID", "가드레일 거절").status()).isEqualTo("FAILED");
        assertThatThrownBy(() -> queue.find(user, failed.requestId()))
            .isInstanceOfSatisfying(BusinessException.class, e -> assertThat(e.getErrorCode()).isEqualTo(LiveCoachError.GONE));

        var old = queue.create(user, RUN, facts());
        db.update("UPDATE live_coach_jobs SET created_at=now()-interval '2 minutes' WHERE public_id=?", old.requestId());
        assertThatThrownBy(() -> queue.find(user, old.requestId()))
            .isInstanceOfSatisfying(BusinessException.class, e -> assertThat(e.getErrorCode()).isEqualTo(LiveCoachError.GONE));
    }

    @Test void staleQueuedJobsAreNotHandedOut() {
        var created = queue.create(user, RUN, facts());
        db.update("UPDATE live_coach_jobs SET created_at=now()-interval '40 seconds' WHERE public_id=?", created.requestId());
        assertThat(queue.claim("worker1", UUID.randomUUID())).isNull();
        assertThat(db.queryForObject("SELECT status FROM live_coach_jobs WHERE public_id=?", String.class, created.requestId()))
            .isEqualTo("FAILED");
    }

    @Test void resultIsValidatedAndNeedsALiveLease() {
        queue.create(user, RUN, facts());
        var a = queue.claim("worker1", UUID.randomUUID());
        assertThatThrownBy(() -> queue.result(a.jobId(), "worker1", a.attemptId(), "스틱을 아주 많이 낮게", "", "m", 1L))
            .isInstanceOf(BusinessException.class);
        assertThatThrownBy(() -> queue.result(a.jobId(), "worker1", a.attemptId(), "낮게", "x".repeat(21), "m", 1L))
            .isInstanceOf(BusinessException.class);
        assertThatThrownBy(() -> queue.result(a.jobId(), "worker2", a.attemptId(), "낮게", "", "m", 1L))
            .isInstanceOfSatisfying(BusinessException.class, e -> assertThat(e.getErrorCode()).isEqualTo(WorkerError.CONFLICT));
        db.update("UPDATE live_coach_jobs SET lease_expires_at=now()-interval '1 second' WHERE id=?", a.jobId());
        assertThatThrownBy(() -> queue.result(a.jobId(), "worker1", a.attemptId(), "낮게", "", "m", 1L))
            .isInstanceOfSatisfying(BusinessException.class, e -> assertThat(e.getErrorCode()).isEqualTo(WorkerError.CONFLICT));
    }

    @Test void twentyCharSubIsAcceptedAndStored() {
        // V52: 보조 문구 상한 20자. 검증 상한과 DB 열 크기가 같아야 저장 단계에서 깨지지 않는다
        queue.create(user, RUN, facts());
        var a = queue.claim("worker1", UUID.randomUUID());
        var sub = "미드탐보다 왼쪽을 조금 더 세게 쳐요";
        assertThat(sub).hasSize(LiveCoachQueue.MAX_SUB);
        queue.result(a.jobId(), "worker1", a.attemptId(), "스몰탐은 왼쪽", sub, "m", 1L);
        assertThat(db.queryForObject("SELECT sub FROM live_coach_jobs WHERE id=?", String.class, a.jobId())).isEqualTo(sub);
    }

    @Test void disabledQueueAcceptsNothing() {
        var off = new LiveCoachQueue(db, json, null, false, 10, 6, false);
        assertThat(off.create(user, RUN, facts())).isNull();
        assertThat(off.enabled()).isFalse();
    }

    @Test void clientHabitIsDroppedWhenHabitIsOff() {
        // 습관 설정이 꺼져 있으면(기본) FE가 보낸 habit을 지우고 나머지는 그대로 넣는다
        var withHabit = (tools.jackson.databind.node.ObjectNode) facts();
        withHabit.set("habit", json.readTree("{\"plays\":9,\"items\":[{\"pattern\":\"TIMING_LATE\",\"share\":\"OFTEN\"}]}"));
        withHabit.set("playedPads", json.readTree("[\"KICK\",\"SNARE\"]"));
        queue.create(user, RUN, withHabit);
        var a = queue.claim("worker1", UUID.randomUUID());
        assertThat(a.facts().has("habit")).isFalse();
        assertThat(a.facts().path("playedPads")).hasSize(2);
        assertThat(a.facts().path("segment").path("toBar").asInt()).isEqualTo(4);
    }
}
