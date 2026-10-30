package com.ssafy.airdrum.auth;

import java.time.Duration;

import org.junit.jupiter.api.Test;
import org.springframework.boot.autoconfigure.context.ConfigurationPropertiesAutoConfiguration;
import org.springframework.boot.autoconfigure.AutoConfigurations;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;

import com.ssafy.airdrum.auth.AuthProperties.RefreshToken;
import com.ssafy.airdrum.auth.AuthProperties.RefreshToken.Store;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatIllegalStateException;
import static org.assertj.core.api.Assertions.assertThatNoException;

/** 설계 문서(88) 3-2, 인수 조건 15: JWT 서명 키 가드와 토큰 설정 기본값. */
class AuthTokenPropertiesTest {

	static final String SECRET_32 = "0123456789abcdef0123456789abcdef";

	private final ApplicationContextRunner runner = new ApplicationContextRunner()
			.withConfiguration(AutoConfigurations.of(ConfigurationPropertiesAutoConfiguration.class))
			.withUserConfiguration(AuthConfiguration.class);

	@Test
	void secretMustBeAtLeast32Bytes() {
		for (var secret : new String[] { null, "", "   ", SECRET_32.substring(1) }) {
			assertThatIllegalStateException().isThrownBy(() -> new AuthProperties.Jwt(secret, null))
					.withMessageContaining("JWT_SECRET")
					.withMessageContaining("32바이트");
		}
		assertThatNoException().isThrownBy(() -> new AuthProperties.Jwt(SECRET_32, null));
		// 한글 11자는 33바이트(UTF-8)라 통과한다. 글자 수가 아니라 바이트로 센다.
		assertThatNoException().isThrownBy(() -> new AuthProperties.Jwt("가나다라마바사아자차카", null));
	}

	@Test
	void secretIsNeverPartOfTheMessage() {
		var shortSecret = "very-secret-but-short";
		assertThatIllegalStateException().isThrownBy(() -> new AuthProperties.Jwt(shortSecret, null))
				.withMessageNotContaining(shortSecret);
	}

	@Test
	void tokenDefaults() {
		var jwt = new AuthProperties.Jwt(SECRET_32, null);
		assertThat(jwt.issuer()).isEqualTo("airdrum-api");
		var refresh = new RefreshToken(null, null);
		assertThat(refresh.ttl()).isEqualTo(Duration.ofDays(14));
		assertThat(refresh.store()).isEqualTo(Store.REDIS);
	}

	@Test
	void contextFailsWithoutSecret() {
		runner.run(context -> {
			assertThat(context).hasFailed();
			assertThat(context.getStartupFailure()).rootCause().hasMessageContaining("JWT_SECRET");
		});
	}

	@Test
	void contextBindsTokenSettings() {
		runner.withPropertyValues("auth.jwt.secret=" + SECRET_32, "auth.access-token-ttl=10m",
				"auth.refresh-token.ttl=1d", "auth.refresh-token.store=memory").run(context -> {
					var properties = context.getBean(AuthProperties.class);
					assertThat(properties.jwt().secret()).isEqualTo(SECRET_32);
					assertThat(properties.accessTokenTtl()).isEqualTo(Duration.ofMinutes(10));
					assertThat(properties.refreshToken().ttl()).isEqualTo(Duration.ofDays(1));
					assertThat(properties.refreshToken().store()).isEqualTo(Store.MEMORY);
				});
	}

	@Test
	void accessTokenTtlDefaultsTo30Minutes() {
		runner.withPropertyValues("auth.jwt.secret=" + SECRET_32).run(context -> {
			var properties = context.getBean(AuthProperties.class);
			assertThat(properties.accessTokenTtl()).isEqualTo(Duration.ofMinutes(30));
			assertThat(properties.refreshToken().store()).isEqualTo(Store.REDIS);
		});
	}

}
