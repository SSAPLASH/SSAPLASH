package com.ssafy.airdrum.withdrawal;

import java.time.Instant;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.context.annotation.Bean;
import org.springframework.http.HttpHeaders;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.transaction.event.TransactionPhase;
import org.springframework.transaction.event.TransactionalEventListener;

import com.ssafy.airdrum.auth.AccessTokenService;
import com.ssafy.airdrum.user.AuthUser;
import com.ssafy.airdrum.user.User;
import com.ssafy.airdrum.user.UserRepository;
import com.ssafy.airdrum.user.UserStatus;
import com.ssafy.airdrum.user.UserWithdrawnEvent;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/** 탈퇴 설계 위험 3: 커밋 뒤 리스너가 예외를 던져도 이미 커밋된 탈퇴는 204로 끝난다. 실제 커밋이 필요해 테스트 트랜잭션을 쓰지 않는다. */
@SpringBootTest
@AutoConfigureMockMvc
class WithdrawalListenerFailureTest {

	@Autowired
	private MockMvc mvc;

	@Autowired
	private AccessTokenService accessTokens;

	@Autowired
	private UserRepository users;

	@Autowired
	private JdbcTemplate jdbc;

	private Long userId;

	@AfterEach
	void cleanUp() {
		if (userId != null) {
			jdbc.update("delete from users where id = ?", userId);
		}
	}

	@Test
	void failingAfterCommitListenerStillReturnsNoContent() throws Exception {
		var user = users.save(User.create("드러머", null, null));
		userId = user.getId();
		var bearer = "Bearer " + accessTokens.issue(new AuthUser(user.getId(), user.getRole()), Instant.now()).token();

		mvc.perform(delete("/api/users/me").header(HttpHeaders.AUTHORIZATION, bearer))
				.andExpect(status().isNoContent());

		assertThat(users.findById(userId).orElseThrow().getStatus()).isEqualTo(UserStatus.WITHDRAWN);
	}

	@TestConfiguration
	static class Config {

		@Bean
		FailingListener failingListener() {
			return new FailingListener();
		}

	}

	static class FailingListener {

		@TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
		void afterCommit(UserWithdrawnEvent event) {
			throw new IllegalStateException("정리 실패");
		}

	}

}
