package com.ssafy.airdrum.domain.auth.service.oauth;

import jakarta.servlet.http.HttpServletResponse;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import com.ssafy.airdrum.domain.auth.client.oauth.OAuth2Client;
import com.ssafy.airdrum.domain.auth.client.oauth.OAuth2Provider;
import com.ssafy.airdrum.domain.auth.exception.OAuth2FlowException;
import com.ssafy.airdrum.domain.auth.service.token.LoginSessionIssuer;
import com.ssafy.airdrum.domain.auth.exception.OAuth2FlowException.Reason;
import com.ssafy.airdrum.domain.user.service.social.SocialLoginService;
import com.ssafy.airdrum.domain.user.entity.User;
import com.ssafy.airdrum.domain.user.exception.UserNotActiveException;

/** 제공자 코드 교환부터 회원 로그인과 세션 발급까지의 OAuth 콜백 흐름. */
@Service
public class OAuth2LoginService {
	private static final Logger log = LoggerFactory.getLogger("com.ssafy.airdrum.auth.AuthController");
	private final OAuth2Client client;
	private final SocialLoginService socialLogin;
	private final LoginSessionIssuer sessionIssuer;
	public OAuth2LoginService(OAuth2Client client, SocialLoginService socialLogin, LoginSessionIssuer sessionIssuer) {
		this.client = client; this.socialLogin = socialLogin; this.sessionIssuer = sessionIssuer;
	}
	public User login(OAuth2Provider provider, String code, HttpServletResponse response) {
		var accessToken = client.exchangeCode(provider, code);
		var userInfo = client.fetchUserInfo(provider, accessToken);
		User user;
		try {
			user = socialLogin.login(userInfo.toSocialProfile());
		} catch (UserNotActiveException ex) {
			throw new OAuth2FlowException(Reason.USER_NOT_ACTIVE, "userId=" + ex.getUserId());
		}
		try {
			sessionIssuer.issue(user, response);
		} catch (RuntimeException ex) {
			log.error("로그인 세션 발급 실패 userId={}", user.getId(), ex);
			throw new OAuth2FlowException(Reason.SESSION_ISSUE_FAILED, "userId=" + user.getId());
		}
		return user;
	}
}
