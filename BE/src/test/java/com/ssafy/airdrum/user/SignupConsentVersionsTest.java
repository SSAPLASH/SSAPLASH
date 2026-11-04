package com.ssafy.airdrum.user;

import org.junit.jupiter.api.Test;

import com.ssafy.airdrum.common.error.BusinessException;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/** 가입 동의의 허용 판 검증: 설정이 비어 있으면 검사하지 않고, 설정된 항목만 정확히 일치하는 판을 받는다. */
class SignupConsentVersionsTest {

	private static SignupConsentRequest request(String terms, String privacy, String data) {
		return new SignupConsentRequest(terms, privacy, new DataConsentInput(true, data));
	}

	@Test
	void emptyConfigurationAcceptsAnyVersionLikeBefore() {
		var versions = new SignupConsentVersions("", "", "");

		assertThatCode(() -> versions.check(request("아무 판", "x", "y"))).doesNotThrowAnyException();
		assertThatCode(() -> new SignupConsentVersions(null, null, null).check(request("a", "b", "c"))).doesNotThrowAnyException();
		assertThatCode(() -> new SignupConsentVersions("  ", " , ,", ",").check(request("a", "b", "c"))).doesNotThrowAnyException();
	}

	@Test
	void configuredVersionsAreAcceptedExactly() {
		var versions = new SignupConsentVersions("2026-11-02", "2026-11-02", "2026-11-02");

		assertThatCode(() -> versions.check(request("2026-11-02", "2026-11-02", "2026-11-02"))).doesNotThrowAnyException();
	}

	@Test
	void unknownOrObsoleteVersionIsRejectedPerField() {
		var versions = new SignupConsentVersions("t-2", "p-2", "d-2");

		assertRejected(versions, request("t-1", "p-2", "d-2"), "termsVersion");
		assertRejected(versions, request("t-2", "p-1", "d-2"), "privacyVersion");
		assertRejected(versions, request("t-2", "p-2", "d-1"), "dataConsent.version");
		assertRejected(versions, request("임의의 문자열", "p-2", "d-2"), "termsVersion");
	}

	@Test
	void severalVersionsMayBeAllowedDuringARollout() {
		var versions = new SignupConsentVersions("t-1, t-2 ,t-3", "p-1", "d-1");

		for (String terms : new String[] { "t-1", "t-2", "t-3" }) {
			assertThatCode(() -> versions.check(request(terms, "p-1", "d-1"))).doesNotThrowAnyException();
		}
		assertRejected(versions, request("t-4", "p-1", "d-1"), "termsVersion");
	}

	@Test
	void matchingIsCaseSensitiveAndIgnoresSurroundingSpacesOfTheSentVersion() {
		var versions = new SignupConsentVersions("V1", "V1", "V1");

		assertRejected(versions, request("v1", "V1", "V1"), "termsVersion");
		assertThatCode(() -> versions.check(request(" V1 ", "V1", "V1"))).doesNotThrowAnyException();
	}

	@Test
	void onlyConfiguredFieldsAreChecked() {
		var versions = new SignupConsentVersions("t-1", "", "");

		assertThatCode(() -> versions.check(request("t-1", "아무거나", "아무거나"))).doesNotThrowAnyException();
		assertRejected(versions, request("t-2", "아무거나", "아무거나"), "termsVersion");
	}

	@Test
	void missingVersionIsRejectedWhenTheFieldIsConfigured() {
		var versions = new SignupConsentVersions("t-1", "p-1", "d-1");

		assertRejected(versions, new SignupConsentRequest("t-1", "p-1", null), "dataConsent.version");
		assertRejected(versions, new SignupConsentRequest(null, "p-1", new DataConsentInput(true, "d-1")), "termsVersion");
	}

	@Test
	void theErrorDoesNotEchoTheSentVersion() {
		var versions = new SignupConsentVersions("t-1", "", "");

		assertThatThrownBy(() -> versions.check(request("비밀스러운-판-값", "p", "d"))).isInstanceOf(BusinessException.class)
				.hasMessageNotContaining("비밀스러운-판-값");
	}

	@Test
	void parseDropsBlanksAndDuplicates() {
		assertThat(SignupConsentVersions.parse(" a, b ,,a ,  ")).containsExactlyInAnyOrder("a", "b");
		assertThat(SignupConsentVersions.parse(null)).isEmpty();
	}

	private static void assertRejected(SignupConsentVersions versions, SignupConsentRequest request, String field) {
		assertThatThrownBy(() -> versions.check(request)).isInstanceOf(BusinessException.class)
				.satisfies(ex -> assertThat(((BusinessException) ex).getErrorCode())
						.isEqualTo(UserErrorCode.SIGNUP_CONSENT_VERSION_INVALID))
				.hasMessageContaining(field);
	}

}
