package com.ssafy.airdrum.domain.auth.client.oauth;

import java.util.ArrayList;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.TreeMap;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

import com.ssafy.airdrum.domain.auth.config.AuthProperties;
import com.ssafy.airdrum.domain.auth.config.AuthProperties.Provider;

/**
 * 경로 값으로 활성 제공자를 찾는다.
 *
 * <p>client-id·secret이 비어 있는 제공자는 기동 시 WARN 한 줄을 남기고 뺀다(설계 U2). 그 제공자의 로그인 요청은 404다.
 * 키가 있는데 엔드포인트 설정이 빠진 것은 설정 실수이므로 기동을 멈춘다.
 */
@Component
public class OAuth2ProviderRegistry {

	private static final Logger log = LoggerFactory.getLogger(OAuth2ProviderRegistry.class);

	static final String CALLBACK_PATH = "/api/auth/%s/callback";

	private final Map<String, OAuth2Provider> providers;

	public OAuth2ProviderRegistry(AuthProperties properties) {
		var active = new TreeMap<String, OAuth2Provider>();
		var disabled = new ArrayList<String>();
		properties.providers().forEach((rawKey, provider) -> {
			var key = rawKey.toLowerCase(Locale.ROOT);
			if (!provider.hasCredentials()) {
				disabled.add(key);
				return;
			}
			active.put(key, toProvider(key, provider, properties.redirectBaseUrl()));
		});
		disabled.sort(null);
		for (var key : disabled) {
			log.warn("로그인 제공자 {}는 client-id/client-secret이 없어 비활성입니다.", key);
		}
		this.providers = Map.copyOf(active);
	}

	/** @param key 경로 값. 대소문자를 가리지 않는다 */
	public Optional<OAuth2Provider> find(String key) {
		if (key == null) {
			return Optional.empty();
		}
		return Optional.ofNullable(providers.get(key.toLowerCase(Locale.ROOT)));
	}

	private static OAuth2Provider toProvider(String key, Provider provider, String redirectBaseUrl) {
		require(key, "social-provider", provider.socialProvider());
		require(key, "authorization-uri", provider.authorizationUri());
		require(key, "token-uri", provider.tokenUri());
		require(key, "user-info-uri", provider.userInfoUri());
		require(key, "client-authentication-method", provider.clientAuthenticationMethod());
		require(key, "attributes.id", provider.attributes() == null ? null : provider.attributes().id());
		var scope = (provider.scope() == null || provider.scope().isBlank()) ? null : provider.scope().trim();
		return new OAuth2Provider(key, provider.socialProvider(), provider.clientId().trim(),
				provider.clientSecret().trim(), provider.authorizationUri(), provider.tokenUri(),
				provider.userInfoUri(), scope, provider.clientAuthenticationMethod(), provider.attributes(),
				provider.assumeEmailVerified(), redirectBaseUrl + CALLBACK_PATH.formatted(key));
	}

	private static void require(String key, String name, Object value) {
		if (value == null || (value instanceof String text && text.isBlank())) {
			throw new IllegalStateException("로그인 제공자 " + key + "의 설정 auth.providers." + key + "." + name + "이(가) 없습니다.");
		}
	}

}
