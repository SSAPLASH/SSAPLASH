package com.ssafy.airdrum.global.worker;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import java.time.Instant;
import java.util.Map;
import java.util.UUID;
import com.ssafy.airdrum.domain.auth.service.token.AccessTokenService;
import com.ssafy.airdrum.support.SignupConsentFixtures;
import com.ssafy.airdrum.domain.user.model.AuthUser;
import com.ssafy.airdrum.domain.user.model.UserRole;
import org.junit.jupiter.api.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.web.servlet.MockMvc;
import tools.jackson.databind.json.JsonMapper;

/** 사용자 및 내부 워커 경로의 인증과 코칭 컨트롤러 연결을 검증한다. */
@SpringBootTest(properties={"auth.jwt.secret=test-only-jwt-secret-0123456789ab", "auth.refresh-token.store=memory",
    "chart.worker.credentials=worker1=01234567890123456789012345678901,worker2=abcdefghijklmnopqrstuvwxyzABCDEF",
    "live-coach.llm.enabled=true"})
@AutoConfigureMockMvc
class CoachingAuthenticationApiTest {
    static final String T1="01234567890123456789012345678901", T2="abcdefghijklmnopqrstuvwxyzABCDEF";
    @Autowired MockMvc mvc;
    @Autowired JdbcTemplate db;
    @Autowired AccessTokenService tokens;
    @Autowired JsonMapper json;
    long user;
    @BeforeEach void setup() {
        user=db.queryForObject("INSERT INTO users(nickname) VALUES ('코칭 테스트') RETURNING id", Long.class);
        SignupConsentFixtures.complete(db, user);
    }
    @AfterEach void clean() {
        db.update("DELETE FROM live_coach_jobs WHERE user_id=?",user);
        db.update("DELETE FROM users WHERE id=?",user);
    }
    @Test void coachingWorkerMappingsUseSharedAuthentication() throws Exception {
        for (String path : java.util.List.of("/internal/v1/live-coach-jobs/claim", "/internal/v1/coach-narratives/claim")) {
            String body=json.writeValueAsString(Map.of("workerId", "worker1", "claimRequestId", UUID.randomUUID()));
            mvc.perform(post(path).contentType(MediaType.APPLICATION_JSON).content(body)).andExpect(status().isUnauthorized());
            mvc.perform(post(path).header("Authorization", "Bearer "+T2).contentType(MediaType.APPLICATION_JSON).content(body))
                .andExpect(status().isBadRequest()).andExpect(jsonPath("$.code").value("WORKER_INVALID"));
            mvc.perform(post(path).header("Authorization", "Bearer "+T1).contentType(MediaType.APPLICATION_JSON).content(body))
                .andExpect(status().isNoContent());
        }
    }
    @Test void liveCoachUserMappingUsesUserAuthentication() throws Exception {
        String path="/api/v1/live-coach/segments";
        String body=json.writeValueAsString(Map.of("runId", UUID.randomUUID(), "facts", Map.of("contractVersion", 1)));
        mvc.perform(post(path).contentType(MediaType.APPLICATION_JSON).content(body)).andExpect(status().isUnauthorized());
        String token=tokens.issue(new AuthUser(user,UserRole.USER),Instant.now()).token();
        String response=mvc.perform(post(path).header("Authorization", "Bearer "+token).contentType(MediaType.APPLICATION_JSON).content(body))
            .andExpect(status().isAccepted()).andReturn().getResponse().getContentAsString();
        String id=json.readTree(response).path("requestId").asString();
        mvc.perform(get(path+"/"+id).header("Authorization", "Bearer "+token))
            .andExpect(status().isAccepted()).andExpect(jsonPath("$.status").value("QUEUED"));
    }
}
