package com.ssafy.airdrum.domain.auth.config;

import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import com.ssafy.airdrum.domain.user.model.AdminEmailWhitelist;

/** 소셜 로그인 설정 바인딩. 회원 모듈이 쓰는 ADMIN 화이트리스트도 여기 설정으로 만든다. */
@Configuration(proxyBeanMethods = false)
@EnableConfigurationProperties(AuthProperties.class)
class AuthConfiguration {

	@Bean
	AdminEmailWhitelist adminEmailWhitelist(AuthProperties properties) {
		return new AdminEmailWhitelist(properties.admin().emails());
	}

}
