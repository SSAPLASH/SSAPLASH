package com.ssafy.airdrum.auth;

import org.springframework.core.MethodParameter;
import org.springframework.web.bind.support.WebDataBinderFactory;
import org.springframework.web.context.request.NativeWebRequest;
import org.springframework.web.method.support.HandlerMethodArgumentResolver;
import org.springframework.web.method.support.ModelAndViewContainer;

import com.ssafy.airdrum.common.error.BusinessException;
import com.ssafy.airdrum.common.error.CommonErrorCode;
import com.ssafy.airdrum.user.AuthUser;

/**
 * 컨트롤러 인자 {@link AuthUser}에 인증된 회원을 넣는다. 인증되지 않은 요청이 여기까지 오는 것은 공개 경로에서
 * {@code AuthUser}를 선언한 경우뿐이며 401로 끝낸다.
 */
class AuthUserArgumentResolver implements HandlerMethodArgumentResolver {

	@Override
	public boolean supportsParameter(MethodParameter parameter) {
		return parameter.getParameterType() == AuthUser.class;
	}

	@Override
	public AuthUser resolveArgument(MethodParameter parameter, ModelAndViewContainer mavContainer,
			NativeWebRequest webRequest, WebDataBinderFactory binderFactory) {
		return CurrentAuthUser.find().orElseThrow(() -> new BusinessException(CommonErrorCode.UNAUTHORIZED,
				SecurityProblemHandlers.LOGIN_REQUIRED));
	}

}
