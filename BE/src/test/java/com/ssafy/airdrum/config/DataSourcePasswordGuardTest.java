package com.ssafy.airdrum.config;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.support.DefaultListableBeanFactory;
import org.springframework.mock.env.MockEnvironment;

import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatIllegalStateException;

/**
 * 설계 문서 6장 "DB_PASSWORD 없이 기동하면 DataSource 생성 전에 명확한 오류로 중단".
 * Boot의 속성 바인딩은 해석 못 한 자리표시자를 문자 그대로 넘기므로 별도로 막는다.
 */
class DataSourcePasswordGuardTest {

	@Test
	void failsWithClearMessageWhenDbPasswordIsNotSet() {
		var environment = new MockEnvironment()
				.withProperty("spring.datasource.password", "${DB_PASSWORD}");

		assertThatIllegalStateException()
				.isThrownBy(() -> guard(environment).postProcessBeanFactory(new DefaultListableBeanFactory()))
				.withMessageContaining("DB_PASSWORD");
	}

	@Test
	void failsWhenPasswordIsBlank() {
		var environment = new MockEnvironment()
				.withProperty("spring.datasource.password", "${DB_PASSWORD}")
				.withProperty("DB_PASSWORD", " ");

		assertThatIllegalStateException()
				.isThrownBy(() -> guard(environment).postProcessBeanFactory(new DefaultListableBeanFactory()))
				.withMessageContaining("DB_PASSWORD");
	}

	@Test
	void failsWhenPasswordPropertyIsAbsent() {
		assertThatIllegalStateException()
				.isThrownBy(() -> guard(new MockEnvironment()).postProcessBeanFactory(new DefaultListableBeanFactory()))
				.withMessageContaining("DB_PASSWORD");
	}

	@Test
	void passesWhenPasswordIsResolved() {
		var environment = new MockEnvironment()
				.withProperty("spring.datasource.password", "${DB_PASSWORD}")
				.withProperty("DB_PASSWORD", "secret");

		assertThatCode(() -> guard(environment).postProcessBeanFactory(new DefaultListableBeanFactory()))
				.doesNotThrowAnyException();
	}

	private static DataSourcePasswordGuard guard(MockEnvironment environment) {
		var guard = new DataSourcePasswordGuard();
		guard.setEnvironment(environment);
		return guard;
	}

}
