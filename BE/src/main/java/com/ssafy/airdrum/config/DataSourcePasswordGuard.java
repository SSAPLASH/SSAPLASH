package com.ssafy.airdrum.config;

import org.springframework.beans.factory.config.BeanFactoryPostProcessor;
import org.springframework.beans.factory.config.ConfigurableListableBeanFactory;
import org.springframework.context.EnvironmentAware;
import org.springframework.core.env.Environment;
import org.springframework.stereotype.Component;

/**
 * DB 비밀번호가 없으면 빈을 만들기 전에 기동을 멈춘다.
 *
 * <p>Boot의 속성 바인딩은 해석하지 못한 {@code ${DB_PASSWORD}}를 문자 그대로 비밀번호로 넘긴다.
 * 그러면 DB 인증 실패나 연결 오류처럼 보여 원인을 찾기 어렵다. 이 검사는 그보다 먼저,
 * 원인을 그대로 적은 메시지로 실패시킨다. 비밀번호 값은 메시지·로그에 남기지 않는다.
 */
@Component
public class DataSourcePasswordGuard implements BeanFactoryPostProcessor, EnvironmentAware {

	static final String PROPERTY = "spring.datasource.password";

	private static final String MESSAGE = "DB 비밀번호가 설정되지 않았습니다. 환경변수 DB_PASSWORD를 지정하세요.";

	private Environment environment;

	@Override
	public void setEnvironment(Environment environment) {
		this.environment = environment;
	}

	@Override
	public void postProcessBeanFactory(ConfigurableListableBeanFactory beanFactory) {
		String password;
		try {
			password = environment.getProperty(PROPERTY);
		}
		catch (IllegalArgumentException unresolvedPlaceholder) {
			throw new IllegalStateException(MESSAGE);
		}
		if (password == null || password.isBlank()) {
			throw new IllegalStateException(MESSAGE);
		}
	}

}
