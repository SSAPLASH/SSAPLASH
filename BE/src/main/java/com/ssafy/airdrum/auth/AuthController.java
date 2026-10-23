package com.ssafy.airdrum.auth;

import java.net.URI;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.util.UriComponentsBuilder;

import com.ssafy.airdrum.auth.OAuth2FlowException.Reason;
import com.ssafy.airdrum.common.error.BusinessException;
import com.ssafy.airdrum.user.SocialLoginService;
import com.ssafy.airdrum.user.User;
import com.ssafy.airdrum.user.UserNotActiveException;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.headers.Header;
import io.swagger.v3.oas.annotations.media.Content;
import io.swagger.v3.oas.annotations.media.Schema;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import io.swagger.v3.oas.annotations.tags.Tag;

/**
 * 소셜 로그인 시작·콜백(설계 문서 3-3, 4-A~C). 브라우저 내비게이션으로 호출되므로 성공·실패 모두 302다.
 * 없는 제공자만 404 오류 응답이다. 인증 없이 연다(88번 Security 도입 시 permitAll).
 */
@Tag(name = "Auth", description = "소셜 로그인. 브라우저가 직접 이동하는 주소이며 fetch로 호출하지 않는다")
@RestController
@RequestMapping("/api/auth")
public class AuthController {

	private static final Logger log = LoggerFactory.getLogger(AuthController.class);

	private final OAuth2ProviderRegistry providers;
	private final OAuth2StateCookie stateCookie;
	private final OAuth2Client client;
	private final SocialLoginService socialLogin;
	private final LoginSessionIssuer sessionIssuer;
	private final AuthProperties properties;

	public AuthController(OAuth2ProviderRegistry providers, OAuth2StateCookie stateCookie, OAuth2Client client,
			SocialLoginService socialLogin, LoginSessionIssuer sessionIssuer, AuthProperties properties) {
		this.providers = providers;
		this.stateCookie = stateCookie;
		this.client = client;
		this.socialLogin = socialLogin;
		this.sessionIssuer = sessionIssuer;
		this.properties = properties;
	}

	@Operation(summary = "로그인 시작", description = "제공자 동의 화면으로 302 리다이렉트하고 state 쿠키(oauth_state)를 심는다.")
	@ApiResponse(responseCode = "302", description = "제공자 인가 URL로 이동",
			headers = @Header(name = HttpHeaders.LOCATION, description = "제공자 인가 URL"))
	@ApiResponse(responseCode = "404", description = "지원하지 않거나 설정되지 않은 제공자 (AUTH_PROVIDER_NOT_SUPPORTED)",
			content = @Content(mediaType = "application/problem+json"))
	@GetMapping("/{provider}/login")
	public ResponseEntity<Void> login(
			@Parameter(description = "제공자", schema = @Schema(allowableValues = { "google", "ssafy" }))
			@PathVariable String provider, HttpServletResponse response) {
		var oauth2Provider = find(provider);
		var state = stateCookie.issue(response);
		var builder = UriComponentsBuilder.fromUriString(oauth2Provider.authorizationUri())
				.queryParam("response_type", "code")
				.queryParam("client_id", oauth2Provider.clientId())
				.queryParam("redirect_uri", oauth2Provider.redirectUri())
				.queryParam("state", state);
		if (oauth2Provider.scope() != null) {
			builder.queryParam("scope", oauth2Provider.scope());
		}
		return redirect(builder.encode().build().toUri());
	}

	@Operation(summary = "로그인 콜백", description = "제공자가 돌려보내는 주소. 성공하면 FE /auth/callback, 실패하면 "
			+ "FE /login?error={access_denied|oauth_failed}로 302 리다이렉트한다. 토큰은 응답하지 않는다.")
	@ApiResponse(responseCode = "302", description = "FE 로그인 성공·실패 페이지로 이동",
			headers = @Header(name = HttpHeaders.LOCATION, description = "FE 주소"))
	@ApiResponse(responseCode = "404", description = "지원하지 않거나 설정되지 않은 제공자 (AUTH_PROVIDER_NOT_SUPPORTED)",
			content = @Content(mediaType = "application/problem+json"))
	@GetMapping("/{provider}/callback")
	public ResponseEntity<Void> callback(@PathVariable String provider,
			@RequestParam(required = false) String code,
			@RequestParam(required = false) String state,
			@RequestParam(required = false) String error,
			HttpServletRequest request, HttpServletResponse response) {
		var oauth2Provider = find(provider);
		try {
			stateCookie.consume(request, response, state);
			if (error != null) {
				throw OAuth2FlowException.providerError(error);
			}
			if (code == null || code.isBlank()) {
				throw new OAuth2FlowException(Reason.MISSING_PARAMETER, "code");
			}
			var accessToken = client.exchangeCode(oauth2Provider, code);
			var userInfo = client.fetchUserInfo(oauth2Provider, accessToken);
			var user = login(userInfo);
			issueSession(user, response);
			log.info("로그인 성공 provider={} userId={}", oauth2Provider.key(), user.getId());
			return redirect(frontend(properties.loginSuccessPath()));
		}
		catch (OAuth2FlowException ex) {
			log.warn("로그인 실패 provider={} reason={}", oauth2Provider.key(), ex.getMessage());
			return redirect(failure(ex.errorCode()));
		}
		catch (RuntimeException ex) {
			log.error("로그인 처리 중 예상하지 못한 오류 provider={}", oauth2Provider.key(), ex);
			return redirect(failure(OAuth2FlowException.OAUTH_FAILED));
		}
	}

	private OAuth2Provider find(String provider) {
		return providers.find(provider)
				.orElseThrow(() -> new BusinessException(AuthErrorCode.AUTH_PROVIDER_NOT_SUPPORTED,
						"지원하지 않는 로그인 제공자입니다."));
	}

	private User login(ProviderUserInfo userInfo) {
		try {
			return socialLogin.login(userInfo.toSocialProfile());
		}
		catch (UserNotActiveException ex) {
			throw new OAuth2FlowException(Reason.USER_NOT_ACTIVE, "userId=" + ex.getUserId());
		}
	}

	private void issueSession(User user, HttpServletResponse response) {
		try {
			sessionIssuer.issue(user, response);
		}
		catch (RuntimeException ex) {
			log.error("로그인 세션 발급 실패 userId={}", user.getId(), ex);
			throw new OAuth2FlowException(Reason.SESSION_ISSUE_FAILED, "userId=" + user.getId());
		}
	}

	private URI failure(String errorCode) {
		return UriComponentsBuilder.fromUri(frontend(properties.loginFailurePath()))
				.queryParam("error", errorCode)
				.build()
				.toUri();
	}

	private URI frontend(String path) {
		return URI.create(properties.frontendBaseUrl() + path);
	}

	private static ResponseEntity<Void> redirect(URI location) {
		return ResponseEntity.status(HttpStatus.FOUND).location(location).build();
	}

}
