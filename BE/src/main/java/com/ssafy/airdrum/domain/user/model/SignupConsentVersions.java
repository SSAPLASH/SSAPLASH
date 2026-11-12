package com.ssafy.airdrum.domain.user.model;

import java.util.Arrays;
import java.util.Set;
import java.util.stream.Collectors;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import com.ssafy.airdrum.domain.user.dto.SignupConsentRequest;
import com.ssafy.airdrum.domain.user.exception.UserErrorCode;
import com.ssafy.airdrum.global.error.BusinessException;

/**
 * 가입 동의로 저장할 수 있는 약관·개인정보·데이터 활용 안내의 판 목록(허용 판 검증).
 *
 * <p>화면(FE)은 사용자에게 보여 주는 안내일 뿐이라 동의 API는 화면 없이도 호출할 수 있다. 그래서 서버가 "어떤 판에 동의했는가"라는
 * 기록이 유효한 판만 남도록 허용 판을 확인한다. 이 검사는 사용자가 스스로 API를 부르는 것을 막지는 못한다.
 *
 * <p>설정은 환경 변수다. 쉼표로 여러 판을 줄 수 있어(판을 바꾸는 배포 중에는 옛 판과 새 판을 함께 허용한다) 각 항목은 앞뒤 공백을
 * 무시하고 대소문자를 구분해 정확히 일치해야 한다. **비어 있으면 그 항목은 검사하지 않는다**(지금까지의 동작). 그래서 코드를
 * 배포해도 동작은 바뀌지 않고, 서버 설정에 판을 넣는 순간부터 검사가 켜진다.
 */
@Component
public class SignupConsentVersions {

	public static final String DETAIL = "허용되지 않은 동의 판입니다.";

	private final Set<String> terms;

	private final Set<String> privacy;

	private final Set<String> data;

	public SignupConsentVersions(@Value("${SIGNUP_CONSENT_TERMS_VERSIONS:}") String terms,
			@Value("${SIGNUP_CONSENT_PRIVACY_VERSIONS:}") String privacy,
			@Value("${SIGNUP_CONSENT_DATA_VERSIONS:}") String data) {
		this.terms = parse(terms);
		this.privacy = parse(privacy);
		this.data = parse(data);
	}

	/**
	 * 허용 목록이 설정된 항목의 판이 목록에 없으면 422 {@code SIGNUP_CONSENT_VERSION_INVALID}.
	 * 응답과 로그에는 보낸 판 값을 담지 않고 어느 항목인지만 알린다.
	 */
	public void check(SignupConsentRequest request) {
		require(terms, request.termsVersion(), "termsVersion");
		require(privacy, request.privacyVersion(), "privacyVersion");
		require(data, request.dataConsent() == null ? null : request.dataConsent().version(), "dataConsent.version");
	}

	private static void require(Set<String> allowed, String version, String field) {
		if (allowed.isEmpty()) {
			return;
		}
		if (version == null || !allowed.contains(version.strip())) {
			throw new BusinessException(UserErrorCode.SIGNUP_CONSENT_VERSION_INVALID, DETAIL + " (" + field + ")");
		}
	}

	public static Set<String> parse(String value) {
		if (value == null || value.isBlank()) {
			return Set.of();
		}
		return Arrays.stream(value.split(",")).map(String::strip).filter(item -> !item.isEmpty())
				.collect(Collectors.toUnmodifiableSet());
	}

}
