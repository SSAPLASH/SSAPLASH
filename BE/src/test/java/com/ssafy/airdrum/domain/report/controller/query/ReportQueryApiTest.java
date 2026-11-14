package com.ssafy.airdrum.domain.report.controller.query;

import java.time.Instant;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.EnumSource;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;
import org.springframework.test.web.servlet.MockMvc;
import com.ssafy.airdrum.domain.report.dto.ReportResponse;
import com.ssafy.airdrum.domain.report.repository.ReportRepository;
import com.ssafy.airdrum.domain.auth.service.token.AccessTokenService;
import com.ssafy.airdrum.domain.play.support.PlayFixtures;
import com.ssafy.airdrum.support.SignupConsentFixtures;
import com.ssafy.airdrum.domain.user.model.AuthUser;
import com.ssafy.airdrum.domain.user.model.UserRole;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;
import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;
import static org.mockito.ArgumentMatchers.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

/** 실제 인증·업로드·PostgreSQL에서 공개 계약과 읽기 스냅샷을 검사한다. */
@SpringBootTest
@AutoConfigureMockMvc
class ReportQueryApiTest {
    @Autowired MockMvc mvc;
    @Autowired JdbcTemplate db;
    @Autowired AccessTokenService tokens;
    @Autowired JsonMapper json;
    @MockitoSpyBean ReportRepository reports;
    long user, other, song, chart, version;
    UUID play;
    String token, otherToken;

    @BeforeEach void seed() {
        user = db.queryForObject("INSERT INTO users(nickname) VALUES('리포트 본인') RETURNING id", Long.class);
        SignupConsentFixtures.complete(db, user);
        other = db.queryForObject("INSERT INTO users(nickname) VALUES('리포트 타인') RETURNING id", Long.class);
        SignupConsentFixtures.complete(db, other);
        token = tokens.issue(new AuthUser(user, UserRole.USER), Instant.now()).token();
        otherToken = tokens.issue(new AuthUser(other, UserRole.USER), Instant.now()).token();
        play = UUID.randomUUID();
        song = db.queryForObject("INSERT INTO songs(owner_id,title,source) VALUES(?,'리포트 곡','MIDI') RETURNING id", Long.class, user);
        chart = db.queryForObject("INSERT INTO charts(song_id,difficulty) VALUES(?,'NORMAL') RETURNING id", Long.class, song);
        version = db.queryForObject("""
                INSERT INTO chart_versions(chart_id,version,notes,timing,notation_status,note_count,generator)
                VALUES(?,1,'[{"noteId":"n1","timeMs":100,"pad":"SNARE"},{"noteId":"n2","timeMs":200,"pad":"KICK"}]',
                '{}','PENDING',2,'MANUAL') RETURNING id
                """, Long.class, chart);
    }
    @AfterEach void cleanup() {
        db.update("DELETE FROM play_sessions WHERE user_id IN (?,?)", user, other);
        db.update("DELETE FROM chart_versions WHERE id=?", version);
        db.update("DELETE FROM charts WHERE id=?", chart);
        db.update("DELETE FROM songs WHERE id=?", song);
        db.update("DELETE FROM users WHERE id IN (?,?)", user, other);
    }
    @ParameterizedTest
    @ValueSource(strings = {"RHYTHM", "SHEET"})
    void uploadThenReadWithoutRawOrAiAndReplayPreservesReport(String mode) throws Exception {
        String body = PlayFixtures.scored(play, song, version).replace("RHYTHM", mode);
        uploadBody(body, 201);
        var report = read("");
        assertThat(report.get("playId").asText()).isEqualTo(play.toString());
        assertThat(report.get("score").asInt()).isEqualTo(100);
        assertThat(report.get("accuracy").asDouble()).isEqualTo(50);
        assertThat(report.get("maxCombo").asInt()).isEqualTo(1);
        assertThat(report.get("judgementCounts").get("miss").asInt()).isEqualTo(1);
        assertThat(report.get("mode").asText()).isEqualTo(mode);
        assertThat(report.get("inputSource").asText()).isEqualTo("KEYBOARD");
        assertThat(report.get("analysisStatus").asText()).isEqualTo("PENDING");
        assertThat(report.get("weakSegments").isNull()).isTrue();
        assertThat(report.get("recommendedDrills").isNull()).isTrue();
        assertThat(report.get("endReason").isNull()).isTrue();
        assertThat(report.get("generatorVersion").asText()).isEqualTo("BE_REPORT_V1");
        assertThat(Instant.parse(report.get("generatedAt").asText())).isBeforeOrEqualTo(Instant.now());
        var pads = report.get("padStats");
        assertThat(pads.size()).isEqualTo(9);
        assertThat(pads.get(1).get("pad").asText()).isEqualTo("SNARE");
        assertThat(pads.get(1).get("accuracy").asDouble()).isEqualTo(100);
        assertThat(pads.get(1).get("meanDeltaMs").asDouble()).isEqualTo(0.13);
        assertThat(pads.get(0).get("accuracy").isNull()).isTrue();
        assertThat(pads.get(7).get("accuracy").asDouble()).isZero();
        assertThat(pads.get(7).get("meanVelocity").isNull()).isTrue();
        assertThat(pads.get(7).get("sampleCount").asInt()).isZero();
        assertThat(db.queryForObject("SELECT raw_log_status FROM play_sessions WHERE id=?", String.class, play)).isEqualTo("PENDING");
        verify(reports, never()).notes(anyLong(), any(), anyInt(), anyInt());
        uploadBody(body, 200);
        assertThat(read("")).isEqualTo(report);
        var notes = read("/notes").get("items");
        assertThat(notes.size()).isEqualTo(2);
        assertThat(notes.get(1).get("velocity").isNull()).isTrue();
        assertThat(notes.get(1).get("deltaMs").isNull()).isTrue();
        assertThat(notes.get(1).get("matchedNoteId").asText()).isEqualTo("n2");
    }
    @Test void slowSheetGoodUsesActualDeltaAndReportRangeUsesChartTime() throws Exception {
        String body = PlayFixtures.scored(play, song, version).replace("RHYTHM", "SHEET")
                .replace("\"playbackRate\":1", "\"playbackRate\":0.7")
                .replace("\"tMs\":100.125", "\"tMs\":121").replace("\"deltaMs\":0.125", "\"deltaMs\":30")
                .replace("\"judgement\":\"PERFECT\"", "\"judgement\":\"GOOD\"")
                .replace("\"score\":100,\"accuracy\":50", "\"score\":60,\"accuracy\":30")
                .replace("\"perfect\":1,\"good\":0", "\"perfect\":0,\"good\":1");
        uploadBody(body.replace("\"tMs\":121", "\"tMs\":130"), 400);
        uploadBody(body.replace("\"tMs\":200", "\"tMs\":201"), 400);
        uploadBody(body, 201);
        assertThat(read("").get("playbackRate").asDouble()).isEqualTo(0.7);
        var hits = read("/notes?fromMs=100&toMs=200").get("items");
        assertThat(hits.size()).isEqualTo(1);
        assertThat(hits.get(0).get("deltaMs").asDouble()).isEqualTo(30);
        assertThat(read("/notes?fromMs=90&toMs=100").get("items").size()).isZero();
    }
    @Test void reportCarriesThePlayedSongAndChart() throws Exception {
        upload();
        var report = read("");
        assertThat(report.get("songId").asLong()).isEqualTo(song);
        db.update("UPDATE play_sessions SET judgement_context=judgement_context - 'playbackRate' WHERE id=?", play);
        assertThat(read("").get("playbackRate").asDouble()).isEqualTo(1);
        assertThat(report.get("chartId").asLong()).isEqualTo(chart);
        assertThat(report.get("difficulty").asText()).isEqualTo("NORMAL");
    }
    @Test void deletedSongKeepsItsIdInTheReport() throws Exception {
        upload();
        db.update("UPDATE songs SET deleted_at=now() WHERE id=?", song);
        assertThat(read("").get("songId").asLong()).isEqualTo(song);
    }
    @Test void legacyReportAndHitAreReadUsingTheCanonicalName() throws Exception {
        upload();
        db.update("UPDATE reports SET pad_stats=(replace(pad_stats::text, '\"SMALL_TOM\"', '\"HI_TOM\"')::jsonb - 8) WHERE play_session_id=?", play);
        db.update("UPDATE hits SET pad='HI_TOM' WHERE play_session_id=? AND seq=0", play);
        var pads = read("").get("padStats");
        assertThat(pads.size()).isEqualTo(8);
        assertThat(pads.get(2).get("pad").asText()).isEqualTo("SMALL_TOM");
        assertThat(read("/notes").get("items").get(0).get("pad").asText()).isEqualTo("SMALL_TOM");
        assertThat(db.queryForObject("SELECT pad FROM hits WHERE play_session_id=? AND seq=0",String.class,play)).isEqualTo("HI_TOM");
    }
    @ParameterizedTest
    @EnumSource(ReportResponse.AnalysisStatus.class)
    void reportReturnsPersistedAnalysisStatus(ReportResponse.AnalysisStatus analysisStatus) throws Exception {
        upload();
        db.update("UPDATE reports SET analysis_status=? WHERE play_session_id=?", analysisStatus.name(), play);

        assertThat(read("").get("analysisStatus").asText()).isEqualTo(analysisStatus.name());
    }
    @Test void originalCountsDeterminePercentAndNotRoundedStoredRatio() throws Exception {
        upload();
        db.update("""
                UPDATE reports SET pad_stats=jsonb_set(pad_stats,'{1}',
                '{"pad":"SNARE","accuracy":0.9999,"meanDeltaMs":0,"meanVelocity":0,
                "judgementCounts":{"perfect":1,"good":1,"miss":1},"sampleCount":2}'::jsonb)
                WHERE play_session_id=?
                """, play);
        var snare = read("").get("padStats").get(1);
        assertThat(snare.get("accuracy").asDouble()).isEqualTo(53.33);
        assertThat(snare.get("meanDeltaMs").isNull()).isFalse();
        assertThat(snare.get("meanDeltaMs").asDouble()).isZero();
        assertThat(snare.get("meanVelocity").asDouble()).isZero();
    }
    @Test void padPercentUsesTheScoreRuleOfThePlay() throws Exception {
        // GOOD 80점(SCORE_V2)으로 친 기록은 리포트 패드 정확도도 같은 규칙: (100 + 80) / 3
        upload();
        db.update("""
                UPDATE play_sessions SET judgement_context=jsonb_set(judgement_context,'{judgementVersion}','"SCORE_V2"') WHERE id=?
                """, play);
        db.update("""
                UPDATE reports SET pad_stats=jsonb_set(pad_stats,'{1}',
                '{"pad":"SNARE","accuracy":0.6,"meanDeltaMs":0,"meanVelocity":0,
                "judgementCounts":{"perfect":1,"good":1,"miss":1},"sampleCount":2}'::jsonb)
                WHERE play_session_id=?
                """, play);
        assertThat(read("").get("padStats").get(1).get("accuracy").asDouble()).isEqualTo(60.00);
    }
    @Test void abortedPlayKeepsWholeChartAndEvaluatedPadDenominatorsSeparate() throws Exception {
        // 검증 가능한 100노트 채보 중 첫 노트 하나만 평가한 중단 플레이.
        db.update("""
                UPDATE chart_versions SET note_count=100,notes=(SELECT jsonb_agg(jsonb_build_object(
                    'noteId','n'||i,'timeMs',i*100,'pad','SNARE')) FROM generate_series(1,100) i) WHERE id=?
                """, version);
        var root = (tools.jackson.databind.node.ObjectNode) json.readTree(PlayFixtures.scored(play, song, version));
        ((tools.jackson.databind.node.ArrayNode) root.get("hits")).remove(1);
        var summary = (tools.jackson.databind.node.ObjectNode) root.get("summary");
        summary.put("accuracy", 1);
        ((tools.jackson.databind.node.ObjectNode) summary.get("judgementCounts")).put("miss", 0);
        root.putObject("clientMeta").put("endReason", "ABORTED").put("lastSongTimeMs", 150).put("elapsedActiveMs", 150);
        uploadBody(root.toString(), 201);
        var result = read("");
        assertThat(result.get("endReason").asText()).isEqualTo("ABORTED");
        assertThat(result.get("accuracy").asDouble()).isEqualTo(1);
        assertThat(result.get("padStats").get(1).get("accuracy").asDouble()).isEqualTo(100);
        assertThat(result.get("padStats").get(1).get("sampleCount").asInt()).isEqualTo(1);
    }
    @Test void sparseSequencesUseLastReturnedCursorAndKeepTimeAndMissNulls() throws Exception {
        upload();
        db.update("UPDATE hits SET seq=9 WHERE play_session_id=? AND seq=1", play);
        db.update("""
                INSERT INTO hits(play_session_id,seq,t_ms,pad,judgement,matched_note_id,delta_ms,velocity)
                VALUES(?,4,100.125,'SNARE','GOOD','n3',30,80),(?,2,50,'SNARE',NULL,NULL,NULL,75)
                """, play, play);
        var first = read("/notes?limit=2");
        assertThat(first.get("items").size()).isEqualTo(2);
        assertThat(first.get("items").get(0).get("seq").asInt()).isZero();
        assertThat(first.get("items").get(1).get("seq").asInt()).isEqualTo(4);
        assertThat(first.get("nextAfterSeq").asInt()).isEqualTo(4);
        var last = read("/notes?limit=2&afterSeq=4");
        assertThat(last.get("items").size()).isEqualTo(1);
        assertThat(last.get("items").get(0).get("seq").asInt()).isEqualTo(9);
        assertThat(last.get("items").get(0).get("velocity").isNull()).isTrue();
        assertThat(last.get("nextAfterSeq").isNull()).isTrue();
        assertThat(read("/notes?afterSeq=2147483647").get("items").size()).isZero();
    }
    @Test void defaultAndMaximumPageSizesAndEmptyResults() throws Exception {
        upload();
        db.update("DELETE FROM hits WHERE play_session_id=?", play);
        assertThat(read("/notes").get("items").size()).isZero();
        assertThat(read("/notes").get("nextAfterSeq").isNull()).isTrue();
        db.update("""
                INSERT INTO hits(play_session_id,seq,t_ms,pad,judgement,matched_note_id,delta_ms,velocity)
                SELECT ?,i,i,'SNARE','PERFECT','note-'||i,0,80 FROM generate_series(0,1000) i
                """, play);
        var defaults = read("/notes");
        assertThat(defaults.get("items").size()).isEqualTo(500);
        assertThat(defaults.get("nextAfterSeq").asInt()).isEqualTo(499);
        var max = read("/notes?limit=1000");
        assertThat(max.get("items").size()).isEqualTo(1000);
        assertThat(max.get("nextAfterSeq").asInt()).isEqualTo(999);
        assertThat(read("/notes?limit=1000&afterSeq=999").get("items").size()).isEqualTo(1);
        assertThat(read("/notes?limit=1000&afterSeq=999").get("nextAfterSeq").isNull()).isTrue();
    }
    @ParameterizedTest
    @ValueSource(strings = {"afterSeq=-1", "afterSeq=2147483648", "afterSeq=x", "afterSeq=0.5",
            "limit=0", "limit=-1", "limit=1001", "limit=2147483648", "limit=x"})
    void invalidPageParametersAre400(String query) throws Exception {
        upload();
        mvc.perform(get(path()+"/notes?"+query).header("Authorization", "Bearer "+token))
                .andExpect(status().isBadRequest()).andExpect(content().contentTypeCompatibleWith("application/problem+json"));
    }
    @ParameterizedTest
    @ValueSource(strings = {"", "/notes"})
    void authenticationOwnershipAndMissingReportHaveStableCodes(String suffix) throws Exception {
        upload();
        mvc.perform(get(path()+suffix)).andExpect(status().isUnauthorized());
        mvc.perform(get(path()+suffix).header("Authorization", "Bearer invalid")).andExpect(status().isUnauthorized());
        mvc.perform(get(path()+suffix).header("Authorization", "Bearer "+otherToken))
                .andExpect(status().isNotFound()).andExpect(jsonPath("$.code").value("PLAY_NOT_FOUND"));
        mvc.perform(get("/api/v1/plays/"+UUID.randomUUID()+"/report"+suffix).header("Authorization", "Bearer "+token))
                .andExpect(status().isNotFound()).andExpect(jsonPath("$.code").value("PLAY_NOT_FOUND"));
        mvc.perform(get("/api/v1/plays/not-a-uuid/report"+suffix).header("Authorization", "Bearer "+token))
                .andExpect(status().isBadRequest());
        db.update("DELETE FROM reports WHERE play_session_id=?", play);
        uploadBody(PlayFixtures.scored(play, song, version), 200);
        mvc.perform(get(path()+suffix).header("Authorization", "Bearer "+token))
                .andExpect(status().isNotFound()).andExpect(jsonPath("$.code").value("REPORT_NOT_FOUND"));
        db.update("UPDATE users SET status='WITHDRAWN',withdrawn_at=now() WHERE id=?", user);
        mvc.perform(get(path()+suffix).header("Authorization", "Bearer "+token)).andExpect(status().isUnauthorized());
    }
    @ParameterizedTest
    @ValueSource(strings = {"FREE", "TEMPO"})
    void nonScoredModesHaveNoReport(String mode) throws Exception {
        uploadBody(PlayFixtures.free(play).replace("FREE", mode), 201);
        for (String suffix : new String[]{"", "/notes"})
            mvc.perform(get(path()+suffix).header("Authorization", "Bearer "+token))
                    .andExpect(status().isNotFound()).andExpect(jsonPath("$.code").value("REPORT_NOT_FOUND"));
    }
    @Test void aiArraysArePreservedAndDeletedSongDoesNotBlockRead() throws Exception {
        upload();
        db.update("UPDATE songs SET deleted_at=now() WHERE id=?", song);
        db.update("UPDATE reports SET weak_segments='[]',recommended_drills=NULL WHERE play_session_id=?", play);
        assertThat(read("").get("weakSegments").isArray()).isTrue();
        assertThat(read("").get("weakSegments").size()).isZero();
        assertThat(read("").get("recommendedDrills").isNull()).isTrue();
        db.update("""
                UPDATE reports SET analysis_status='DONE',
                weak_segments='[{"fromMs":100,"toMs":200,"description":"박자를 확인하세요."}]',
                recommended_drills='[{"name":"기본 박자 연습"}]',generator_version='AI_TEST'
                WHERE play_session_id=?
                """, play);
        var before = read("");
        uploadBody(PlayFixtures.scored(play, song, version), 200);
        assertThat(read("")).isEqualTo(before);
        assertThat(before.get("weakSegments").get(0).get("description").asText()).isEqualTo("박자를 확인하세요.");
        assertThat(before.get("recommendedDrills").get(0).get("name").asText()).isEqualTo("기본 박자 연습");
        assertThat(before.get("analysisStatus").asText()).isEqualTo("DONE");
        assertThat(read("/notes").get("items").size()).isEqualTo(2);
    }
    /** AI가 항목에 더한 선택 필드(tip)는 BE가 모르는 필드여도 저장된 그대로 응답에 나온다. */
    @Test void segmentTipStoredByAiIsReturnedUnchanged() throws Exception {
        upload();
        String tip = "놓친 부분만 따로 떼어 느린 템포로 반복해 보세요. 한 번에 한 마디씩 익히면 곡 전체가 쉬워져요.";
        db.update("""
                UPDATE reports SET analysis_status='DONE',generator_version='BE_REPORT_V1+weak-rules-0.2',
                weak_segments='[{"fromMs":7000,"toMs":12000,"pattern":"MISS_CLUSTER","description":"7~12초 구간에서 노트의 40%%를 놓쳤어요.",
                "tip":"%s","causeTags":["MISS","CLUSTER"],"pads":["SNARE"],"metrics":{"severity":0.67,"scope":"SEGMENT"}},
                {"fromMs":0,"toMs":100,"pattern":"SOMETHING_NEW","description":"새 패턴이에요.","causeTags":[],"pads":[],"metrics":{"severity":0.1}}]'
                WHERE play_session_id=?
                """.formatted(tip), play);
        var report = read("");
        assertThat(report.get("weakSegments").size()).isEqualTo(2);
        assertThat(report.get("weakSegments").get(0).get("tip").asText()).isEqualTo(tip);
        assertThat(report.get("weakSegments").get(0).get("description").asText()).isEqualTo("7~12초 구간에서 노트의 40%를 놓쳤어요.");
        assertThat(report.get("weakSegments").get(1).has("tip")).isFalse();
        assertThat(report.get("generatorVersion").asText()).isEqualTo("BE_REPORT_V1+weak-rules-0.2");
    }
    @ParameterizedTest
    @ValueSource(strings = {"", "/notes"})
    void deletionBetweenAccessCheckAndDataReadUsesOneSnapshot(String suffix) throws Exception {
        upload();
        doAnswer(i -> {
            i.callRealMethod();
            CompletableFuture.runAsync(() -> db.update("DELETE FROM play_sessions WHERE id=?", play))
                    .get(5, TimeUnit.SECONDS);
            return null;
        }).when(reports).requireReport(user, play);
        var result = read(suffix);
        if (suffix.isEmpty()) assertThat(result.get("score").asInt()).isEqualTo(100);
        else assertThat(result.get("items").size()).isEqualTo(2);
        mvc.perform(get(path()+suffix).header("Authorization", "Bearer "+token))
                .andExpect(status().isNotFound()).andExpect(jsonPath("$.code").value("PLAY_NOT_FOUND"));
    }
    private String path() { return "/api/v1/plays/"+play+"/report"; }
    private void upload() throws Exception { uploadBody(PlayFixtures.scored(play, song, version), 201); }
    private void uploadBody(String body, int expected) throws Exception {
        mvc.perform(post("/api/v1/plays").header("Authorization", "Bearer "+token)
                .contentType("application/json").content(body)).andExpect(status().is(expected));
    }
    private JsonNode read(String suffix) throws Exception {
        return json.readTree(mvc.perform(get(path()+suffix).header("Authorization", "Bearer "+token))
                .andExpect(status().isOk()).andReturn().getResponse().getContentAsString());
    }
}
