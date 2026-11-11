package com.ssafy.airdrum.domain.user.model;

import java.util.Arrays;
import java.util.List;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

/** 설계 문서 3-6·3-7, 인수 조건 8: 공백·대소문자를 무시하고 검증된 이메일만 ADMIN으로 본다. */
class AdminEmailWhitelistTest {

	private final AdminEmailWhitelist whitelist = new AdminEmailWhitelist(List.of(" Admin@Example.com ", "", "ops@ssafy.com"));

	@Test
	void verifiedEmailInListIsAdminIgnoringCaseAndSpaces() {
		assertThat(whitelist.isAdmin("admin@example.com", true)).isTrue();
		assertThat(whitelist.isAdmin(" OPS@SSAFY.COM", true)).isTrue();
	}

	@Test
	void unverifiedEmailIsNotAdminEvenIfListed() {
		assertThat(whitelist.isAdmin("admin@example.com", false)).isFalse();
	}

	@Test
	void unknownOrMissingEmailIsNotAdmin() {
		assertThat(whitelist.isAdmin("someone@example.com", true)).isFalse();
		assertThat(whitelist.isAdmin(null, true)).isFalse();
		assertThat(whitelist.isAdmin("  ", true)).isFalse();
	}

	@Test
	void emptyOrNullListMeansNoAdmin() {
		assertThat(new AdminEmailWhitelist(List.of()).isAdmin("admin@example.com", true)).isFalse();
		assertThat(new AdminEmailWhitelist(null).isAdmin("admin@example.com", true)).isFalse();
		assertThat(new AdminEmailWhitelist(Arrays.asList((String) null)).isAdmin("admin@example.com", true)).isFalse();
	}

}
