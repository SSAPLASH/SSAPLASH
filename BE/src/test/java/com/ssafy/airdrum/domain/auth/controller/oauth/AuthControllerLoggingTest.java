package com.ssafy.airdrum.domain.auth.controller.oauth;

import java.util.Optional;

import ch.qos.logback.classic.Logger;
import ch.qos.logback.classic.spi.ILoggingEvent;
import ch.qos.logback.core.read.ListAppender;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.slf4j.LoggerFactory;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;

import com.ssafy.airdrum.domain.auth.client.oauth.OAuth2Provider;
import com.ssafy.airdrum.domain.auth.client.oauth.OAuth2ProviderRegistry;
import com.ssafy.airdrum.domain.auth.config.AuthProperties;
import com.ssafy.airdrum.domain.auth.cookie.OAuth2StateCookie;
import com.ssafy.airdrum.domain.auth.exception.OAuth2FlowException;
import com.ssafy.airdrum.domain.auth.service.oauth.OAuth2LoginService;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class AuthControllerLoggingTest {

	private static final String UNTRUSTED = "untrusted-secret\nforged-log-line";
	private final OAuth2ProviderRegistry providers = mock(OAuth2ProviderRegistry.class);
	private final OAuth2StateCookie stateCookie = mock(OAuth2StateCookie.class);
	private final OAuth2LoginService login = mock(OAuth2LoginService.class);
	private final AuthProperties properties = mock(AuthProperties.class);
	private final OAuth2Provider provider = mock(OAuth2Provider.class);
	private final Logger logger = (Logger) LoggerFactory.getLogger(AuthController.class);
	private final ListAppender<ILoggingEvent> logs = new ListAppender<>();
	private AuthController controller;

	@BeforeEach
	void setUp() {
		when(providers.find("google")).thenReturn(Optional.of(provider));
		when(provider.key()).thenReturn("google");
		when(properties.frontendBaseUrl()).thenReturn("http://localhost:5173");
		when(properties.loginFailurePath()).thenReturn("/login");
		controller = new AuthController(providers, stateCookie, login, properties);
		logs.start();
		logger.addAppender(logs);
	}

	@AfterEach
	void tearDown() {
		logger.detachAppender(logs);
		logs.stop();
	}

	@Test
	void providerErrorIsNeverRetainedOrLoggedAndRedirectMappingIsPreserved() {
		var ex = OAuth2FlowException.providerError(UNTRUSTED);
		assertThat(ex.getMessage()).isEqualTo("PROVIDER_ERROR");
		assertThat(ex.errorCode()).isEqualTo("oauth_failed");
		assertThat(OAuth2FlowException.providerError("access_denied").errorCode()).isEqualTo("access_denied");

		var response = controller.callback("google", null, "state", UNTRUSTED,
				new MockHttpServletRequest(), new MockHttpServletResponse());
		assertThat(response.getHeaders().getLocation().toString()).isEqualTo("http://localhost:5173/login?error=oauth_failed");
		var denied = controller.callback("google", null, "state", "access_denied",
				new MockHttpServletRequest(), new MockHttpServletResponse());
		assertThat(denied.getHeaders().getLocation().toString()).isEqualTo("http://localhost:5173/login?error=access_denied");
		assertThat(logs.list).hasSize(2).allSatisfy(event -> {
			assertThat(event.getFormattedMessage()).contains("reason=PROVIDER_ERROR").doesNotContain(UNTRUSTED);
			assertThat(event.getThrowableProxy()).isNull();
		});
	}

	@Test
	void unexpectedExceptionMessageAndCauseAreNotLogged() {
		when(login.login(any(), any(), any())).thenThrow(new IllegalStateException(UNTRUSTED,
				new IllegalArgumentException(UNTRUSTED)));
		var response = controller.callback("google", "code", "state", null,
				new MockHttpServletRequest(), new MockHttpServletResponse());
		assertThat(response.getHeaders().getLocation().toString()).isEqualTo("http://localhost:5173/login?error=oauth_failed");
		assertThat(logs.list).singleElement().satisfies(event -> {
			assertThat(event.getFormattedMessage()).contains("reason=UNEXPECTED_ERROR").doesNotContain(UNTRUSTED);
			assertThat(event.getThrowableProxy()).isNull();
		});
	}
}
