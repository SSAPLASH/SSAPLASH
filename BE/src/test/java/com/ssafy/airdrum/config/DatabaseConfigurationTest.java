package com.ssafy.airdrum.config;

import java.sql.DriverManager;

import javax.sql.DataSource;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.ApplicationContext;
import org.springframework.core.env.Environment;

import com.zaxxer.hikari.HikariDataSource;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 설계 문서(ACCT-001 회원 스키마) 3-2·3-7: 테스트는 별도 선언 없이 임베디드 PostgreSQL 16을 받고,
 * Flyway가 그 DataSource에 붙으며, 스키마는 Hibernate가 만들지 않고 검증만 한다.
 */
@SpringBootTest
class DatabaseConfigurationTest {

	@Autowired
	private ApplicationContext context;

	@Autowired
	private Environment environment;

	@Test
	void dataSourceIsPostgreSql16WithoutAnyTestDeclaration() throws Exception {
		assertThat(context.getBeanNamesForType(DataSource.class)).isNotEmpty();
		try (var connection = context.getBean(DataSource.class).getConnection()) {
			var meta = connection.getMetaData();
			assertThat(meta.getDatabaseProductName()).isEqualTo("PostgreSQL");
			assertThat(meta.getDatabaseMajorVersion()).isEqualTo(16);
		}
	}

	/** 풀에 남은 연결만 재사용하지 않고 새 TCP 연결도 지정한 루프백으로 성립하는지 확인한다. */
	@Test
	void freshJdbcConnectionsReachEmbeddedPostgresOverIpv4() throws Exception {
		var dataSource = context.getBean(DataSource.class);
		assertThat(dataSource).isInstanceOf(HikariDataSource.class);
		var pool = (HikariDataSource) dataSource;
		assertThat(pool.getJdbcUrl()).startsWith("jdbc:postgresql://127.0.0.1:");
		for (int attempt = 0; attempt < 10; attempt++) {
			try (var connection = DriverManager.getConnection(pool.getJdbcUrl(), pool.getUsername(), pool.getPassword());
					var statement = connection.createStatement();
					var result = statement.executeQuery("SELECT host(inet_server_addr())")) {
				assertThat(result.next()).isTrue();
				assertThat(result.getString(1)).isEqualTo("127.0.0.1");
			}
		}
	}

	/** 설계 문서 U7: DB가 응답하지 않으면 30초(기본)가 아니라 5초 안에 실패한다. */
	@Test
	void connectionWaitIsCappedAtFiveSeconds() {
		var dataSource = context.getBean(DataSource.class);
		assertThat(dataSource).isInstanceOf(HikariDataSource.class);
		assertThat(((HikariDataSource) dataSource).getConnectionTimeout()).isEqualTo(5_000L);
	}

	@Test
	void flywayIsConfiguredOnTheDataSource() {
		assertThat(context.containsBean("flyway")).isTrue();
		assertThat(environment.getProperty("spring.flyway.validate-migration-naming")).isEqualTo("true");
	}

	@Test
	void hibernateOnlyValidatesSchemaAndOpenInViewIsOff() {
		assertThat(environment.getProperty("spring.jpa.hibernate.ddl-auto")).isEqualTo("validate");
		assertThat(environment.getProperty("spring.jpa.open-in-view")).isEqualTo("false");
	}

}
