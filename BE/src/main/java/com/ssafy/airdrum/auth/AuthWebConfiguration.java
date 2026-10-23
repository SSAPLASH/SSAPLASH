package com.ssafy.airdrum.auth;

import java.util.List;

import org.springdoc.core.utils.SpringDocUtils;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.method.support.HandlerMethodArgumentResolver;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

import com.ssafy.airdrum.user.AuthUser;

/** 컨트롤러 인자 {@link AuthUser} 해석기를 등록한다. OpenAPI 문서에는 이 인자를 파라미터로 내지 않는다. */
@Configuration(proxyBeanMethods = false)
class AuthWebConfiguration implements WebMvcConfigurer {

	static {
		SpringDocUtils.getConfig().addRequestWrapperToIgnore(AuthUser.class);
	}

	@Override
	public void addArgumentResolvers(List<HandlerMethodArgumentResolver> resolvers) {
		resolvers.add(new AuthUserArgumentResolver());
	}

}
