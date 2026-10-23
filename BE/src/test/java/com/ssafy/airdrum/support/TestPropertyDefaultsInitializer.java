package com.ssafy.airdrum.support;

import java.util.Map;

import org.springframework.context.ApplicationContextInitializer;
import org.springframework.context.ConfigurableApplicationContext;
import org.springframework.core.env.MapPropertySource;

/**
 * 모든 테스트 컨텍스트에 토큰·Redis 기본값을 넣는다({@code META-INF/spring.factories}로 등록).
 *
 * <p>테스트는 Redis 없이 돈다(CI 러너가 Windows shell executor). 그래서 refresh 저장소는 메모리로, Redis 헬스 검사는
 * 끈 채로 고정한다. 로컬 BE/.env의 값에 흔들리지 않도록 이 둘은 가장 높은 우선순위로 둔다.
 * 서명 키는 환경변수 이름({@code JWT_SECRET})으로 가장 낮은 우선순위에 두어, 테스트가 필요하면 바꿀 수 있게 한다.
 */
public class TestPropertyDefaultsInitializer implements ApplicationContextInitializer<ConfigurableApplicationContext> {

	/** 테스트 전용 서명 키(32바이트). 운영 키와 무관하다. */
	public static final String TEST_JWT_SECRET = "test-only-jwt-secret-0123456789ab";

	@Override
	public void initialize(ConfigurableApplicationContext context) {
		var sources = context.getEnvironment().getPropertySources();
		sources.addFirst(new MapPropertySource("testForcedDefaults", Map.of(
				"auth.refresh-token.store", "memory",
				"management.health.redis.enabled", "false")));
		sources.addLast(new MapPropertySource("testFallbackDefaults", Map.of(
				"JWT_SECRET", TEST_JWT_SECRET)));
	}

}
