package com.ssafy.airdrum.domain.auth.client.oauth;

import java.nio.charset.StandardCharsets;
import java.util.Map;

import org.springframework.core.ParameterizedTypeReference;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Component;
import org.springframework.util.LinkedMultiValueMap;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientException;
import org.springframework.web.client.RestClientResponseException;

import com.ssafy.airdrum.domain.auth.dto.oauth.ProviderUserInfo;
import com.ssafy.airdrum.domain.auth.exception.OAuth2FlowException;
import com.ssafy.airdrum.domain.auth.config.AuthProperties.Attributes;
import com.ssafy.airdrum.domain.auth.config.AuthProperties.ClientAuthenticationMethod;
import com.ssafy.airdrum.domain.auth.exception.OAuth2FlowException.Reason;

/**
 * 제공자 토큰 교환과 사용자 정보 조회(설계 문서 3-5). Google·SSAFY 모두 같은 절차이고 차이는 설정으로 흡수한다.
 *
 * <p>제공자 토큰은 사용자 정보 조회에만 쓰고 저장하지 않는다. 시간 제한은 {@code spring.http.clients.*}가 정한다.
 * 실패 메시지에는 HTTP 상태만 남기고 응답 본문·토큰은 넣지 않는다.
 */
@Component
public class OAuth2Client {

	private static final ParameterizedTypeReference<Map<String, Object>> JSON_OBJECT = new ParameterizedTypeReference<>() {
	};

	private static final MediaType FORM_UTF8 = new MediaType(MediaType.APPLICATION_FORM_URLENCODED, StandardCharsets.UTF_8);

	private final RestClient restClient;

	public OAuth2Client(RestClient.Builder builder) {
		this.restClient = builder.build();
	}

	/** 인가 코드를 access token으로 바꾼다. */
	public String exchangeCode(OAuth2Provider provider, String code) {
		var form = new LinkedMultiValueMap<String, String>();
		form.add("grant_type", "authorization_code");
		form.add("code", code);
		form.add("redirect_uri", provider.redirectUri());
		if (provider.clientAuthenticationMethod() == ClientAuthenticationMethod.POST) {
			form.add("client_id", provider.clientId());
			form.add("client_secret", provider.clientSecret());
		}
		Map<String, Object> body;
		try {
			body = restClient.post()
					.uri(provider.tokenUri())
					.contentType(FORM_UTF8)
					.accept(MediaType.APPLICATION_JSON)
					.headers(headers -> {
						if (provider.clientAuthenticationMethod() == ClientAuthenticationMethod.BASIC) {
							headers.setBasicAuth(provider.clientId(), provider.clientSecret(), StandardCharsets.UTF_8);
						}
					})
					.body(form)
					.retrieve()
					.body(JSON_OBJECT);
		}
		catch (RestClientException ex) {
			throw new OAuth2FlowException(Reason.TOKEN_EXCHANGE_FAILED, describe(ex));
		}
		var accessToken = body == null ? null : body.get("access_token");
		if (!(accessToken instanceof String token) || token.isBlank()) {
			throw new OAuth2FlowException(Reason.TOKEN_EXCHANGE_FAILED, "응답에 access_token이 없습니다.");
		}
		return token;
	}

	/** access token으로 사용자 정보를 조회해 공통 형태로 바꾼다. */
	public ProviderUserInfo fetchUserInfo(OAuth2Provider provider, String accessToken) {
		Map<String, Object> body;
		try {
			body = restClient.get()
					.uri(provider.userInfoUri())
					.accept(MediaType.APPLICATION_JSON)
					.header(HttpHeaders.AUTHORIZATION, "Bearer " + accessToken)
					// SSAFY 명세가 사용자 정보 요청 헤더에 적어 둔 값이다. Google은 무시한다.
					.header(HttpHeaders.CONTENT_TYPE, FORM_UTF8.toString())
					.retrieve()
					.body(JSON_OBJECT);
		}
		catch (RestClientException ex) {
			throw new OAuth2FlowException(Reason.USER_INFO_FAILED, describe(ex));
		}
		return toUserInfo(provider, body == null ? Map.of() : body);
	}

	private static ProviderUserInfo toUserInfo(OAuth2Provider provider, Map<String, Object> body) {
		Attributes attributes = provider.attributes();
		var id = text(body, attributes.id());
		if (id == null) {
			throw new OAuth2FlowException(Reason.USER_INFO_FAILED, "응답에 사용자 식별자(" + attributes.id() + ")가 없습니다.");
		}
		var emailVerified = attributes.emailVerified() == null
				? provider.assumeEmailVerified()
				: Boolean.parseBoolean(text(body, attributes.emailVerified()));
		return new ProviderUserInfo(provider.socialProvider(), id, text(body, attributes.email()), emailVerified,
				text(body, attributes.name()), text(body, attributes.picture()));
	}

	/** 속성 값을 문자열로. 이름이 설정되지 않았거나 값이 없거나 비면 null. 숫자 식별자도 문자열로 읽는다. */
	private static String text(Map<String, Object> body, String attribute) {
		if (attribute == null) {
			return null;
		}
		var value = body.get(attribute);
		if (value == null || value instanceof Map || value instanceof Iterable) {
			return null;
		}
		var text = String.valueOf(value).strip();
		return text.isEmpty() ? null : text;
	}

	private static String describe(RestClientException ex) {
		if (ex instanceof RestClientResponseException response) {
			return "HTTP " + response.getStatusCode().value();
		}
		return ex.getClass().getSimpleName();
	}

}
