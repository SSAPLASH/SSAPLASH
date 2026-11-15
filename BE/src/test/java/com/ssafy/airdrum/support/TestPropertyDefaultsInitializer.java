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
				"JWT_SECRET", TEST_JWT_SECRET,
				"report.analysis.dispatch-enabled", "false",
				// 254번: 시작 시 공용 곡 등록은 테스트 DB의 공용 곡 수를 바꾸므로 기본으로 끈다(검사하는 테스트만 켠다).
				"builtin-songs.seed.enabled", "false",
				// 곡 추천 R1: 시작 시 채보 특징 백필은 테스트 DB를 바꾸므로 기본으로 끈다.
				"chart-features.backfill.enabled", "false",
				// 383번: 테스트 컨텍스트는 같은 DB를 쓰고 일부는 10초마다 recover가 돈다. 워커 연락이 없다고 다른 테스트의
				// 대기 작업을 실패시키지 않게 기본으로 끈다(검사하는 테스트만 chart.worker.offline-after-ms로 켠다).
				"CHART_WORKER_OFFLINE_AFTER_MS", "0")));
	}

}
