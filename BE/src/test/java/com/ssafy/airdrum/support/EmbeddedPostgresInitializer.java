package com.ssafy.airdrum.support;

import java.io.IOException;
import java.io.UncheckedIOException;
import java.util.Map;

import org.springframework.context.ApplicationContextInitializer;
import org.springframework.context.ConfigurableApplicationContext;
import org.springframework.core.env.MapPropertySource;

import io.zonky.test.db.postgres.embedded.EmbeddedPostgres;

/**
 * 모든 테스트 컨텍스트에 임베디드 PostgreSQL 16을 DataSource로 넣는다.
 *
 * <p>{@code META-INF/spring.factories}로 등록되어 테스트 클래스에 따로 선언하지 않아도 적용된다.
 * PostgreSQL은 JVM당 한 번만 띄우고 모든 컨텍스트가 같은 DB를 쓴다. 스키마는 각 컨텍스트의 Flyway가
 * 적용하며(이미 적용된 버전은 건너뜀), 데이터는 각 테스트가 트랜잭션 롤백으로 정리한다.
 */
public class EmbeddedPostgresInitializer implements ApplicationContextInitializer<ConfigurableApplicationContext> {

	private static final String PROPERTY_SOURCE_NAME = "embeddedPostgres";

	private static final String USER = "postgres";

	@Override
	public void initialize(ConfigurableApplicationContext context) {
		var postgres = Holder.INSTANCE;
		context.getEnvironment().getPropertySources().addFirst(new MapPropertySource(PROPERTY_SOURCE_NAME, Map.of(
				// localhost 해석에 의존하지 않고 테스트 서버의 IPv4 루프백에 연결한다.
				"spring.datasource.url", "jdbc:postgresql://127.0.0.1:" + postgres.getPort() + "/" + USER,
				"spring.datasource.username", USER,
				// 임베디드 서버는 trust 인증이라 값은 쓰이지 않는다. yaml의 ${DB_PASSWORD}를 가리는 용도다.
				"spring.datasource.password", USER,
				// 임베디드 PG에는 확장이 없다. V8·V30은 별도 timescaleTest에서 실제 컨테이너로 검증한다.
				// target은 복사본에 실제로 있는 최신 버전 V51이다.
				"spring.flyway.locations", "classpath:db/test-migration",
				"spring.flyway.target", "51",
				"play.withdrawn-cleanup.enabled", "false",
				// @DataJpaTest가 DataSource를 내장 DB(H2 등)로 바꾸지 않게 한다.
				"spring.test.database.replace", "none")));
	}

	/** 처음 쓰일 때 서버를 띄우고 JVM 종료 시 정지한다. */
	private static final class Holder {

		private static final EmbeddedPostgres INSTANCE = start();

		private static EmbeddedPostgres start() {
			try {
				var postgres = EmbeddedPostgres.builder()
						.setServerConfig("listen_addresses", "127.0.0.1")
						// 캐시된 컨텍스트(최대 32개)마다 Hikari가 10개씩 연결을 잡는다. 기본 100이면 컨텍스트 10개를 넘을 때 접속이 거절된다.
						.setServerConfig("max_connections", "400")
						.start();
				Runtime.getRuntime().addShutdownHook(new Thread(() -> {
					try {
						postgres.close();
					}
					catch (IOException ignored) {
						// JVM 종료 중이라 정리 실패는 무시한다.
					}
				}, "embedded-postgres-shutdown"));
				return postgres;
			}
			catch (IOException e) {
				throw new UncheckedIOException("임베디드 PostgreSQL을 시작하지 못했습니다.", e);
			}
		}

	}

}
