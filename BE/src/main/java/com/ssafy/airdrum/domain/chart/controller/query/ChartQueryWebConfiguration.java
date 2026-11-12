package com.ssafy.airdrum.domain.chart.controller.query;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.method.HandlerMethod;
import org.springframework.web.servlet.HandlerInterceptor;
import org.springframework.web.servlet.config.annotation.InterceptorRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;
import com.ssafy.airdrum.domain.chart.service.query.ChartQueryAccess;
import com.ssafy.airdrum.global.error.BusinessException;
import com.ssafy.airdrum.global.error.CommonErrorCode;
import com.ssafy.airdrum.global.web.QueryAuthenticated;

/** 인증 연결 전에는 차단하며, 인증은 경로·쿼리 바인딩보다 먼저 수행한다. */
@Configuration(proxyBeanMethods = false)
public class ChartQueryWebConfiguration implements WebMvcConfigurer {
	private final ObjectProvider<ChartQueryUserResolver> resolver;
	private final ObjectProvider<ChartQueryAccess> access;
	public ChartQueryWebConfiguration(ObjectProvider<ChartQueryUserResolver> resolver, ObjectProvider<ChartQueryAccess> access) {
		this.resolver = resolver; this.access = access;
	}
	@Override
	public void addInterceptors(InterceptorRegistry registry) {
		registry.addInterceptor(new HandlerInterceptor() {
			@Override
			public boolean preHandle(HttpServletRequest request, HttpServletResponse response, Object handler) {
				if (!(handler instanceof HandlerMethod method)
						|| !method.getBeanType().isAnnotationPresent(QueryAuthenticated.class))
					return true;
				response.setHeader("Cache-Control", "private, no-store");
				var identity = resolver.getIfAvailable();
				if (identity == null) throw new BusinessException(CommonErrorCode.UNAUTHORIZED);
				long userId = identity.requireUserId(request);
				access.getObject().requireActive(userId);
				request.setAttribute(QueryAuthenticated.USER_ID, userId);
				return true;
			}
		});
	}
}
