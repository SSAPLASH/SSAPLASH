package com.ssafy.airdrum.domain.play.service.livecoach;

import java.sql.Timestamp;
import java.time.Instant;
import java.util.UUID;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import tools.jackson.databind.json.JsonMapper;
import tools.jackson.databind.node.ObjectNode;
import static org.assertj.core.api.Assertions.*;

/** 습관 설정이 켜진 큐(설계 COACH-001 습관 개인화 3.6): BE가 계산한 습관만 붙고, FE가 보낸 습관은 지운다. */
@SpringBootTest(properties = {"live-coach.llm.enabled=true", "live-coach.habit.enabled=true",
    "live-coach.llm.per-run=10", "live-coach.llm.per-minute=10"})
class LiveCoachQueueHabitTest {
    @Autowired JdbcTemplate db;
    @Autowired LiveCoachQueue queue;
    @Autowired JsonMapper json;
    long user, other, version;

    private static final String LATE = "[{\"pattern\":\"TIMING_LATE\",\"pads\":[],\"metrics\":{\"severity\":0.6}}]";

    @BeforeEach void seed() {
        user = db.queryForObject("INSERT INTO users(nickname) VALUES('습관 코칭') RETURNING id", Long.class);
        other = db.queryForObject("INSERT INTO users(nickname) VALUES('습관 없음') RETURNING id", Long.class);
        long song = db.queryForObject(
            "INSERT INTO songs(owner_id,title,source,status,duration_ms) VALUES(?,'habit-song','MIDI','READY',100000) RETURNING id",
            Long.class, user);
        long chart = db.queryForObject("INSERT INTO charts(song_id,difficulty) VALUES(?,'NORMAL') RETURNING id", Long.class, song);
        version = db.queryForObject("""
            INSERT INTO chart_versions(chart_id,version,notes,timing,notation_status,note_count,generator)
            VALUES(?,1,'[{"noteId":"n1","timeMs":1,"pad":"SNARE"}]'::jsonb,'{}'::jsonb,'READY',1,'MANUAL') RETURNING id
            """, Long.class, chart);
        Instant now = Instant.now();
        for (int i = 0; i < 4; i++) analyzedPlay(user, song, now.minusSeconds(600L * (i + 1)), i < 3 ? LATE : "[]");
        // 다른 사람은 분석된 플레이가 2개뿐이라 습관이 없다
        for (int i = 0; i < 2; i++) analyzedPlay(other, song, now.minusSeconds(600L * (i + 1)), LATE);
    }

    private void analyzedPlay(long userId, long song, Instant endedAt, String weakSegments) {
        UUID id = UUID.randomUUID();
        db.update("""
            INSERT INTO play_sessions(id,user_id,song_id,chart_version_id,mode,input_source,judgement_context,payload_schema_version,payload_hash,accuracy,started_at,ended_at)
            VALUES (?,?,?,?, 'RHYTHM','STICK','{}'::jsonb,1,?,0.8,?,?)
            """, id, userId, song, version, "b".repeat(64), Timestamp.from(endedAt.minusSeconds(60)), Timestamp.from(endedAt));
        db.update("INSERT INTO reports(play_session_id,timing_histogram,pad_stats,weak_segments,generator_version) VALUES (?, '[]'::jsonb, '[]'::jsonb, ?::jsonb, 'test')",
            id, weakSegments);
    }

    @AfterEach void cleanup() {
        db.update("DELETE FROM live_coach_jobs WHERE user_id IN (?, ?)", user, other);
        db.update("DELETE FROM reports WHERE play_session_id IN (SELECT id FROM play_sessions WHERE user_id IN (?, ?))", user, other);
        db.update("DELETE FROM play_sessions WHERE user_id IN (?, ?)", user, other);
        db.update("DELETE FROM chart_versions WHERE chart_id IN (SELECT c.id FROM charts c JOIN songs s ON s.id=c.song_id WHERE s.owner_id=?)", user);
        db.update("DELETE FROM charts WHERE song_id IN (SELECT id FROM songs WHERE owner_id=?)", user);
        db.update("DELETE FROM songs WHERE owner_id=?", user);
        db.update("DELETE FROM users WHERE id IN (?, ?)", user, other);
    }

    private ObjectNode facts(String extra) {
        return (ObjectNode) json.readTree("""
            {"contractVersion":1,"segment":{"index":0,"fromBar":1,"toBar":4},"input":"stick",
             "counts":{"perfect":10,"good":4,"miss":2},"stage":1%s}
            """.formatted(extra));
    }

    @Test void habitFromRecentReportsReplacesClientHabit() {
        // FE가 보낸 습관(빠름)은 버리고, BE가 리포트로 센 습관(4판 중 3판 늦음)을 붙인다
        queue.create(user, UUID.randomUUID(),
            facts(",\"habit\":{\"plays\":9,\"items\":[{\"pattern\":\"TIMING_EARLY\"}]}"));
        var a = queue.claim("worker1", UUID.randomUUID());
        var habit = a.facts().path("habit");
        assertThat(habit.path("plays").asInt()).isEqualTo(4);
        assertThat(habit.path("items")).hasSize(1);
        assertThat(habit.path("items").get(0).path("pattern").asString()).isEqualTo("TIMING_LATE");
        assertThat(habit.path("items").get(0).path("share").asString()).isEqualTo("OFTEN");
        assertThat(habit.toString()).doesNotContain("severity", "habit-song");
    }

    @Test void noHabitWhenTooFewAnalyzedPlays() {
        queue.create(other, UUID.randomUUID(), facts(",\"habit\":{\"plays\":9,\"items\":[]}"));
        var a = queue.claim("worker1", UUID.randomUUID());
        assertThat(a.facts().has("habit")).isFalse();
    }

    @Test void sizeLimitAppliesToClientFactsSoHabitStillFits() {
        // FE 사실이 상한 바로 아래여도 습관을 붙여 넣는다. 상한은 FE가 보낸 부분(habit 제외)에 건다
        var base = facts("");
        int room = LiveCoachQueue.MAX_FACTS_BYTES - json.writeValueAsString(base).getBytes(java.nio.charset.StandardCharsets.UTF_8).length - 20;
        var near = facts(",\"note\":\"" + "x".repeat(room) + "\"");
        assertThat(json.writeValueAsString(near).length()).isLessThanOrEqualTo(LiveCoachQueue.MAX_FACTS_BYTES);
        queue.create(user, UUID.randomUUID(), near);
        var a = queue.claim("worker1", UUID.randomUUID());
        assertThat(a.facts().has("habit")).isTrue();
    }
}
