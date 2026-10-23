package com.ssafy.airdrum.auth;

import java.nio.charset.StandardCharsets;
import java.time.Clock;

import javax.crypto.SecretKey;
import javax.crypto.spec.SecretKeySpec;

import org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication;
import org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication.Type;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.annotation.Order;
import org.springframework.http.HttpMethod;
import org.springframework.security.config.annotation.method.configuration.EnableMethodSecurity;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configurers.AbstractHttpConfigurer;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.oauth2.jose.jws.MacAlgorithm;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.security.oauth2.jwt.JwtEncoder;
import org.springframework.security.oauth2.jwt.JwtIssuerValidator;
import org.springframework.security.oauth2.jwt.NimbusJwtDecoder;
import org.springframework.security.oauth2.jwt.NimbusJwtEncoder;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.authentication.UsernamePasswordAuthenticationFilter;

/**
 * API 보안 구성(설계 문서(88) 3-6). 세션 없이 Bearer access 토큰으로 인증하고, 공개 경로 외에는 모두 인증이 필요하다.
 * ADMIN 전용 API는 경로 규칙이 아니라 {@code @PreAuthorize("hasRole('ADMIN')")}로 표시한다.
 *
 * <p>{@code /internal/**}(AI 워커)는 이 체인에서 열어 두고, 그 인증은 BE2가 더 높은 우선순위의 별도 체인
 * ({@code securityMatcher("/internal/**")}, {@code @Order(1)})으로 붙인다.
 */
@Configuration(proxyBeanMethods = false)
@EnableMethodSecurity
class SecurityConfig {

	static final int API_CHAIN_ORDER = 2;

	/** 웹이 아닌 컨텍스트(배치·일부 테스트)에서는 만들지 않는다. 토큰 발급·검증 빈은 그대로 쓸 수 있다. */
	@Bean
	@Order(API_CHAIN_ORDER)
	@ConditionalOnWebApplication(type = Type.SERVLET)
	SecurityFilterChain apiSecurityFilterChain(HttpSecurity http, AuthenticationService authentication,
			SecurityProblemHandlers problems) throws Exception {
		http
				.csrf(AbstractHttpConfigurer::disable)
				.formLogin(AbstractHttpConfigurer::disable)
				.httpBasic(AbstractHttpConfigurer::disable)
				.logout(AbstractHttpConfigurer::disable)
				.requestCache(AbstractHttpConfigurer::disable)
				.sessionManagement(session -> session.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
				.authorizeHttpRequests(authorize -> authorize
						.requestMatchers(HttpMethod.OPTIONS, "/**").permitAll()
						.requestMatchers(HttpMethod.GET, "/api/auth/*/login", "/api/auth/*/callback").permitAll()
						.requestMatchers(HttpMethod.POST, "/api/auth/refresh", "/api/auth/logout").permitAll()
						.requestMatchers("/actuator/health/**", "/v3/api-docs/**", "/swagger-ui/**", "/swagger-ui.html")
						.permitAll()
						.requestMatchers("/internal/**").permitAll()
						// 공개 경로 처리 중 오류가 오류 페이지로 넘어가도 401로 바뀌지 않게 한다.
						.requestMatchers("/error").permitAll()
						.anyRequest().authenticated())
				.exceptionHandling(exceptions -> exceptions
						.authenticationEntryPoint(problems)
						.accessDeniedHandler(problems))
				.addFilterBefore(new AccessTokenAuthenticationFilter(authentication),
						UsernamePasswordAuthenticationFilter.class);
		return http.build();
	}

	/** 이 빈이 있으면 Boot의 기본 사용자(generated password) 자동 구성이 물러난다. */
	@Bean
	static JwtDecoder jwtDecoder(AuthProperties properties) {
		var decoder = NimbusJwtDecoder.withSecretKey(secretKey(properties)).macAlgorithm(MacAlgorithm.HS256).build();
		// 만료는 AccessTokenService가 Clock으로 따로 본다. 여기서는 서명·발급자만 검증한다.
		decoder.setJwtValidator(new JwtIssuerValidator(properties.jwt().issuer()));
		return decoder;
	}

	@Bean
	static JwtEncoder jwtEncoder(AuthProperties properties) {
		return NimbusJwtEncoder.withSecretKey(secretKey(properties)).build();
	}

	@Bean
	Clock authClock() {
		return Clock.systemUTC();
	}

	private static SecretKey secretKey(AuthProperties properties) {
		return new SecretKeySpec(properties.jwt().secret().getBytes(StandardCharsets.UTF_8), "HmacSHA256");
	}

}
