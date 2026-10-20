package com.ssafy.airdrum.auth;

import java.time.Duration;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.springframework.boot.test.system.CapturedOutput;
import org.springframework.boot.test.system.OutputCaptureExtension;

import com.ssafy.airdrum.auth.AuthProperties.Attributes;
import com.ssafy.airdrum.auth.AuthProperties.ClientAuthenticationMethod;
import com.ssafy.airdrum.auth.AuthProperties.Provider;
import com.ssafy.airdrum.user.SocialProvider;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatIllegalStateException;

/** 설계 문서 3-6·U2: 키가 있는 제공자만 활성화하고, 콜백 URI는 설정된 기준 주소로 만든다. */
@ExtendWith(OutputCaptureExtension.class)
class OAuth2ProviderRegistryTest {

	@Test
	void configuredProviderIsFoundCaseInsensitivelyWithCallbackUri() {
		var registry = new OAuth2ProviderRegistry(properties("http://localhost:8080/", Map.of("google", google("id", "secret"))));

		var provider = registry.find("GOOGLE").orElseThrow();
		assertThat(provider.key()).isEqualTo("google");
		assertThat(provider.socialProvider()).isEqualTo(SocialProvider.GOOGLE);
		assertThat(provider.clientId()).isEqualTo("id");
		assertThat(provider.redirectUri()).isEqualTo("http://localhost:8080/api/auth/google/callback");
	}

	@Test
	void providerWithBlankClientIdOrSecretIsDisabledWithWarning(CapturedOutput output) {
		var providers = new LinkedHashMap<String, Provider>();
		providers.put("google", google(" ", "g00gle-secret-value"));
		providers.put("ssafy", google("ssafy-client-id-value", ""));
		var registry = new OAuth2ProviderRegistry(properties("http://localhost:8080", providers));

		assertThat(registry.find("google")).isEmpty();
		assertThat(registry.find("ssafy")).isEmpty();
		assertThat(output).contains("google").contains("ssafy").contains("비활성");
		// 키 값은 로그에 남기지 않는다.
		assertThat(output).doesNotContain("g00gle-secret-value").doesNotContain("ssafy-client-id-value");
	}

	@Test
	void unknownProviderIsNotFound() {
		var registry = new OAuth2ProviderRegistry(properties("http://localhost:8080", Map.of("google", google("id", "secret"))));

		assertThat(registry.find("kakao")).isEmpty();
		assertThat(registry.find(null)).isEmpty();
	}

	@Test
	void configuredProviderWithoutRequiredEndpointFailsAtStartup() {
		var broken = new Provider(SocialProvider.GOOGLE, "id", "secret", "https://auth", null, "https://userinfo",
				null, ClientAuthenticationMethod.BASIC, new Attributes("sub", null, null, null, null), false);

		assertThatIllegalStateException()
				.isThrownBy(() -> new OAuth2ProviderRegistry(properties("http://localhost:8080", Map.of("google", broken))))
				.withMessageContaining("google")
				.withMessageContaining("token-uri");
	}

	static Provider google(String clientId, String clientSecret) {
		return new Provider(SocialProvider.GOOGLE, clientId, clientSecret,
				"https://accounts.example.com/auth", "https://accounts.example.com/token",
				"https://accounts.example.com/userinfo", "openid email profile", ClientAuthenticationMethod.BASIC,
				new Attributes("sub", "email", "email_verified", "name", "picture"), false);
	}

	static AuthProperties properties(String redirectBaseUrl, Map<String, Provider> providers) {
		return new AuthProperties("http://localhost:5173", redirectBaseUrl, "/auth/callback", "/login", true,
				Duration.ofMinutes(5), new AuthProperties.Admin(List.of()), providers);
	}

}
