package com.ssafy.airdrum.auth;

import java.time.Duration;
import java.time.Instant;

import jakarta.persistence.EntityManager;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.system.CapturedOutput;
import org.springframework.boot.test.system.OutputCaptureExtension;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.transaction.annotation.Transactional;

import com.ssafy.airdrum.support.TestPropertyDefaultsInitializer;
import com.ssafy.airdrum.user.AuthUser;
import com.ssafy.airdrum.user.User;
import com.ssafy.airdrum.user.UserRepository;
import com.ssafy.airdrum.user.UserRole;

import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.containsString;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * 설계 문서(88) 3-6, 인수 조건 1·2·9·10·11: 공개 경로, Bearer 인증, 401·403 오류 형식.
 * 로컬 BE/.env에 흔들리지 않도록 이 테스트가 쓰는 제공자 키를 지정한다.
 */
@SpringBootTest(properties = { "GOOGLE_CLIENT_ID=google-id", "GOOGLE_CLIENT_SECRET=google-secret",
		"SSAFY_CLIENT_ID=", "SSAFY_CLIENT_SECRET=",
        "chart.worker.credentials=test-worker=01234567890123456789012345678901" })
@AutoConfigureMockMvc
@Transactional
@ExtendWith(OutputCaptureExtension.class)
class SecurityConfigTest {

	static final String ME = "/api/test-auth/me";
	static final String ADMIN = "/api/test-auth/admin";

	@Autowired
	private MockMvc mvc;

	@Autowired
	private AccessTokenService tokens;

	@Autowired
	private UserRepository users;

	@Autowired
	private EntityManager em;

	@Test
	void protectedPathWithoutTokenIsUnauthorizedProblem() throws Exception {
		unauthorized(mvc.perform(get(ME)), ME, "로그인이 필요합니다.");
	}

	@Test
	void unknownPathIsUnauthorizedBeforeNotFound() throws Exception {
		unauthorized(mvc.perform(get("/api/nothing")), "/api/nothing", "로그인이 필요합니다.");
	}

	@Test
	void publicPathsNeedNoToken() throws Exception {
		mvc.perform(get("/api/auth/google/login")).andExpect(status().isFound());
		mvc.perform(get("/api/auth/kakao/login")).andExpect(status().isNotFound())
				.andExpect(jsonPath("$.code").value("AUTH_PROVIDER_NOT_SUPPORTED"));
		mvc.perform(get("/actuator/health")).andExpect(status().isOk());
		mvc.perform(get("/actuator/health/readiness")).andExpect(status().isOk());
		mvc.perform(get("/v3/api-docs")).andExpect(status().isOk());
		mvc.perform(get("/swagger-ui/index.html")).andExpect(status().isOk());
	}

	@Test
	void internalRequiresServiceAuthentication() throws Exception {
		String path = "/internal/anything";
		unauthorized(mvc.perform(get(path)), path, "인증이 필요합니다.");
		var user = users.saveAndFlush(User.create("내부 인증 확인", null, null));
		unauthorized(mvc.perform(get(path).header(HttpHeaders.AUTHORIZATION, bearer(user, Instant.now()))),
				path, "인증이 필요합니다.");
		mvc.perform(get(path).header(HttpHeaders.AUTHORIZATION, "Bearer 01234567890123456789012345678901"))
				.andExpect(status().isNotFound()).andExpect(jsonPath("$.code").value("NOT_FOUND"));
	}

	@Test
	void publicPathIgnoresBadToken() throws Exception {
		mvc.perform(get("/actuator/health").header(HttpHeaders.AUTHORIZATION, "Bearer broken"))
				.andExpect(status().isOk());
	}

	@Test
	void validTokenOfActiveUserReachesController() throws Exception {
		var user = users.saveAndFlush(User.create("드러머", null, null));

		mvc.perform(get(ME).header(HttpHeaders.AUTHORIZATION, bearer(user, Instant.now())))
				.andExpect(status().isOk())
				.andExpect(jsonPath("$.id").value(user.getId()))
				.andExpect(jsonPath("$.role").value("USER"))
				.andExpect(header().doesNotExist(HttpHeaders.SET_COOKIE))
				.andExpect(header().string(HttpHeaders.CACHE_CONTROL, containsString("no-store")));
	}

	@Test
	void expiredTokenIsUnauthorizedWithExpiredDetail(CapturedOutput output) throws Exception {
		var user = users.saveAndFlush(User.create("드러머", null, null));
		var token = bearer(user, Instant.now().minus(Duration.ofHours(2)));

		unauthorized(mvc.perform(get(ME).header(HttpHeaders.AUTHORIZATION, token)), ME, "액세스 토큰이 만료되었습니다.");
		assertThat(output).contains("401 UNAUTHORIZED").doesNotContain(token.substring("Bearer ".length()));
	}

	@Test
	void invalidTokensAreUnauthorizedWithInvalidDetail(CapturedOutput output) throws Exception {
		var user = users.saveAndFlush(User.create("드러머", null, null));
		var otherKey = "Bearer " + AccessTokenServiceTest.service("another-secret-0123456789abcdefgh", null, Instant.now())
				.issue(new AuthUser(user.getId(), UserRole.USER), Instant.now()).token();

		for (var value : new String[] { otherKey, "Bearer ", "Bearer abc.def.ghi", "Basic dXNlcjpwYXNz", "abc" }) {
			unauthorized(mvc.perform(get(ME).header(HttpHeaders.AUTHORIZATION, value)), ME,
					"액세스 토큰이 올바르지 않습니다.");
		}
		assertThat(output).doesNotContain(otherKey.substring("Bearer ".length()));
	}

	@Test
	void withdrawnUserTokenIsUnauthorized() throws Exception {
		var user = users.saveAndFlush(User.create("탈퇴", null, null));
		var token = bearer(user, Instant.now());
		em.createNativeQuery("update users set status = 'WITHDRAWN', withdrawn_at = now() where id = :id")
				.setParameter("id", user.getId())
				.executeUpdate();
		em.clear();

		unauthorized(mvc.perform(get(ME).header(HttpHeaders.AUTHORIZATION, token)), ME, "사용할 수 없는 계정입니다.");
	}

	@Test
	void roleComesFromDatabaseOnEveryRequest() throws Exception {
		var user = users.saveAndFlush(User.create("드러머", null, null));
		var token = bearer(user, Instant.now());
		user.changeRole(UserRole.ADMIN);
		em.flush();

		mvc.perform(get(ADMIN).header(HttpHeaders.AUTHORIZATION, token))
				.andExpect(status().isOk())
				.andExpect(jsonPath("$.role").value("ADMIN"));
	}

	@Test
	void adminOnlyEndpointForbidsUser(CapturedOutput output) throws Exception {
		var user = users.saveAndFlush(User.create("드러머", null, null));

		mvc.perform(get(ADMIN).header(HttpHeaders.AUTHORIZATION, bearer(user, Instant.now())))
				.andExpect(status().isForbidden())
				.andExpect(content().contentTypeCompatibleWith(MediaType.APPLICATION_PROBLEM_JSON))
				.andExpect(jsonPath("$.code").value("FORBIDDEN"))
				.andExpect(jsonPath("$.status").value(403))
				.andExpect(jsonPath("$.detail").value("권한이 없습니다."))
				.andExpect(jsonPath("$.instance").value(ADMIN));
		assertThat(output).contains("403 FORBIDDEN").doesNotContain("ERROR");
	}

	@Test
	void noGeneratedPasswordOrSession(CapturedOutput output) throws Exception {
		assertThat(output).doesNotContain("generated security password");
		mvc.perform(get(ME)).andExpect(header().doesNotExist(HttpHeaders.SET_COOKIE));
	}

	@Test
	void contextUsesTestSecret() {
		var issued = tokens.issue(new AuthUser(1L, UserRole.USER), Instant.now());
		var verifier = AccessTokenServiceTest.service(TestPropertyDefaultsInitializer.TEST_JWT_SECRET, null, Instant.now());
		assertThat(verifier.verify(issued.token()).userId()).isEqualTo(1L);
	}

	private String bearer(User user, Instant issuedAt) {
		var service = AccessTokenServiceTest.service(TestPropertyDefaultsInitializer.TEST_JWT_SECRET, null, issuedAt);
		return "Bearer " + service.issue(new AuthUser(user.getId(), user.getRole()), issuedAt).token();
	}

	private static void unauthorized(ResultActions result, String path, String detail) throws Exception {
		result.andExpect(status().isUnauthorized())
				.andExpect(content().contentTypeCompatibleWith(MediaType.APPLICATION_PROBLEM_JSON))
				.andExpect(header().string(HttpHeaders.WWW_AUTHENTICATE, "Bearer"))
				.andExpect(jsonPath("$.code").value("UNAUTHORIZED"))
				.andExpect(jsonPath("$.status").value(401))
				.andExpect(jsonPath("$.detail").value(detail))
				.andExpect(jsonPath("$.instance").value(path));
	}

}
