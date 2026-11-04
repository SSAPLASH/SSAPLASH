package com.ssafy.airdrum.user;

import java.time.Instant;
import java.time.temporal.ChronoUnit;

import jakarta.persistence.EntityManager;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.data.jpa.test.autoconfigure.DataJpaTest;
import org.springframework.data.domain.PageRequest;
import org.springframework.jdbc.core.JdbcTemplate;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatIllegalStateException;

/** 탈퇴 설계 3-2, 인수 조건 6·8: 상태 전이가 V1 제약을 통과하고, 잠금 조회·탈퇴 회원 조회·연동 삭제가 동작한다. */
@DataJpaTest
class UserWithdrawalPersistenceTest {

	private static final Instant NOW = Instant.parse("2026-10-27T03:00:00.123456789Z");

	@Autowired
	private UserRepository users;

	@Autowired
	private SocialAccountRepository socialAccounts;

	@Autowired
	private EntityManager em;

	@Autowired
	private JdbcTemplate jdbc;

	@Test
	void withdrawRecordsStatusAndTimeWithinCheckConstraint() {
		var user = users.save(User.create("드러머", "drummer@example.com", null));

		user.withdraw(NOW);
		em.flush();
		em.clear();

		var found = users.findById(user.getId()).orElseThrow();
		assertThat(found.getStatus()).isEqualTo(UserStatus.WITHDRAWN);
		assertThat(found.getWithdrawnAt()).isEqualTo(NOW.truncatedTo(ChronoUnit.MICROS));
	}

	/** 인수 조건 10(153): 상태 전이와 같은 UPDATE로 개인정보 컬럼을 비운다. 닉네임은 NOT NULL이라 대체 문구다. */
	@Test
	void withdrawClearsPersonalInformation() {
		var user = users.save(User.create("드러머", "drummer@example.com", "https://cdn.example.com/p.png"));

		user.withdraw(NOW);
		em.flush();
		em.clear();

		var found = users.findById(user.getId()).orElseThrow();
		assertThat(found.getNickname()).isEqualTo(User.WITHDRAWN_NICKNAME).isEqualTo("탈퇴한 사용자");
		assertThat(found.getEmail()).isNull();
		assertThat(found.getProfileImageUrl()).isNull();
		assertThat(found.getStatus()).isEqualTo(UserStatus.WITHDRAWN);
	}

	/** 가입 동의 설계 4-5(U1): 탈퇴하면 동의 컬럼 7개를 같은 UPDATE로 비우고, 그 행은 CHECK를 통과한다. */
	@Test
	void withdrawClearsAllConsentColumns() {
		var user = users.save(User.create("드러머", null, null));
		em.flush();
		jdbc.update("""
				UPDATE users SET terms_version = 't1', terms_agreed_at = now(), privacy_version = 'p1',
				  privacy_agreed_at = now(), data_consent = true, data_consent_at = now(), data_consent_version = 'd1'
				WHERE id = ?
				""", user.getId());
		em.clear();
		var consented = users.findById(user.getId()).orElseThrow();
		assertThat(consented.isSignupCompleted()).isTrue();

		consented.withdraw(NOW);
		em.flush();
		em.clear();

		var row = jdbc.queryForMap("""
				SELECT terms_version, terms_agreed_at, privacy_version, privacy_agreed_at,
				  data_consent, data_consent_at, data_consent_version
				FROM users WHERE id = ?
				""", user.getId());
		assertThat(row).hasSize(7);
		assertThat(row.values()).containsOnlyNulls();
		var found = users.findById(user.getId()).orElseThrow();
		assertThat(found.isSignupCompleted()).isFalse();
		assertThat(found.getTermsVersion()).isNull();
		assertThat(found.getPrivacyAgreedAt()).isNull();
		assertThat(found.getDataConsentVersion()).isNull();
	}

	@Test
	void withdrawingTwiceIsRejected() {
		var user = User.create("드러머", null, null);
		user.withdraw(NOW);

		assertThatIllegalStateException().isThrownBy(() -> user.withdraw(NOW));
	}

	@Test
	void findByIdForUpdateReturnsUser() {
		var user = users.save(User.create("드러머", null, null));
		em.flush();
		em.clear();

		assertThat(users.findByIdForUpdate(user.getId())).hasValueSatisfying(
				found -> assertThat(found.getId()).isEqualTo(user.getId()));
		assertThat(users.findByIdForUpdate(-1L)).isEmpty();
	}

	@Test
	void findWithdrawnIdsReturnsOnlyWithdrawnInWithdrawnAtOrder() {
		var active = users.save(User.create("활성", null, null));
		var later = users.save(User.create("나중", null, null));
		var earlier = users.save(User.create("먼저", null, null));
		var old = users.save(User.create("오래전", null, null));
		later.withdraw(NOW.plusSeconds(60));
		earlier.withdraw(NOW);
		old.withdraw(NOW.minusSeconds(3600));
		em.flush();

		var ids = users.findWithdrawnIds(NOW.minusSeconds(1), PageRequest.of(0, 10));

		assertThat(ids).containsExactly(earlier.getId(), later.getId()).doesNotContain(active.getId(), old.getId());
		assertThat(users.findWithdrawnIds(NOW.minusSeconds(1), PageRequest.of(0, 1))).containsExactly(earlier.getId());
	}

	@Test
	void deleteAllByUserIdRemovesOnlyThatUsersConnections() {
		var target = users.save(User.create("대상", null, null));
		var other = users.save(User.create("남", null, null));
		socialAccounts.save(SocialAccount.connect(target, SocialProvider.GOOGLE, "g-target", null));
		socialAccounts.save(SocialAccount.connect(other, SocialProvider.GOOGLE, "g-other", null));

		var deleted = socialAccounts.deleteAllByUserId(target.getId());

		assertThat(deleted).isEqualTo(1);
		assertThat(socialAccounts.findByUserIdOrderByConnectedAtAsc(target.getId())).isEmpty();
		assertThat(socialAccounts.findByUserIdOrderByConnectedAtAsc(other.getId())).hasSize(1);
	}

}
