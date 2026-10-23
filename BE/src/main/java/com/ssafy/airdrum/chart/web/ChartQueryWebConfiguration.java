package com.ssafy.airdrum.chart.web;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.method.HandlerMethod;
import org.springframework.web.servlet.HandlerInterceptor;
import org.springframework.web.servlet.config.annotation.InterceptorRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;
import com.ssafy.airdrum.chart.ChartQueryAccess;
import com.ssafy.airdrum.common.error.BusinessException;
import com.ssafy.airdrum.common.error.CommonErrorCode;
import com.ssafy.airdrum.song.SongQueryController;

/** 인증 연결 전에는 차단하며, 인증은 경로·쿼리 바인딩보다 먼저 수행한다. */
@Configuration(proxyBeanMethods = false)
public class ChartQueryWebConfiguration implements WebMvcConfigurer {
	public static final String USER_ID = "com.ssafy.airdrum.chart.query.userId";
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
						|| (method.getBeanType() != SongQueryController.class && method.getBeanType() != ChartQueryController.class))
					return true;
				response.setHeader("Cache-Control", "private, no-store");
				var identity = resolver.getIfAvailable();
				if (identity == null) throw new BusinessException(CommonErrorCode.UNAUTHORIZED);
				long userId = identity.requireUserId(request);
				access.getObject().requireActive(userId);
				request.setAttribute(USER_ID, userId);
				return true;
			}
		});
	}
}
