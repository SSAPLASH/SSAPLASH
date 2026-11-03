package com.ssafy.airdrum.common.error;

import java.util.concurrent.atomic.AtomicInteger;

import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import tools.jackson.databind.json.JsonMapper;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 검색어 등 요청 파라미터에 NUL 문자({@code \u0000})가 있으면 컨트롤러·DB 전에 400으로 거절하는지 확인한다.
 * NUL 바이트를 그대로 넘기면 PostgreSQL이 처리하지 못해 500이 된다. ZAP 공격 스캔과 수동 재현
 * ({@code GET /api/v1/sheets?q=a%00b})에서 확인한 결함이다(SECURITY.md 16절).
 */
class NulParameterFilterTest {

	private final NulParameterFilter filter = new NulParameterFilter(new ErrorResponseWriter(JsonMapper.builder().build()));

	@Test
	void requestWithoutNulCharacterReachesController() throws Exception {
		var request = new MockHttpServletRequest("GET", "/api/v1/sheets");
		request.addParameter("q", "정상 검색어");
		var response = new MockHttpServletResponse();
		var calls = new AtomicInteger();

		filter.doFilter(request, response, (req, res) -> calls.incrementAndGet());

		assertThat(calls.get()).isEqualTo(1);
	}

	@Test
	void parameterContainingNulCharacterIsRejectedBeforeReachingController() throws Exception {
		var request = new MockHttpServletRequest("GET", "/api/v1/sheets");
		request.addParameter("q", "a\u0000b");
		var response = new MockHttpServletResponse();

		filter.doFilter(request, response, (req, res) -> {
			throw new AssertionError("NUL 문자가 있으면 컨트롤러까지 가면 안 됨");
		});

		assertThat(response.getStatus()).isEqualTo(400);
		var body = response.getContentAsString();
		assertThat(body).contains("INVALID_INPUT").contains("NUL 문자");
	}

	@Test
	void nulCharacterInAnyParameterNameIsAlsoRejected() throws Exception {
		var request = new MockHttpServletRequest("GET", "/api/v1/songs");
		request.addParameter("source", "BUILTIN");
		request.addParameter("name", "preset\u0000name");
		var response = new MockHttpServletResponse();

		filter.doFilter(request, response, (req, res) -> {
			throw new AssertionError("NUL 문자가 있으면 컨트롤러까지 가면 안 됨");
		});

		assertThat(response.getStatus()).isEqualTo(400);
	}

	@Test
	void multipartRequestsAreNotInspectedForNulParameters() throws Exception {
		// 멀티파트 파싱 전에 getParameterMap()을 부르면 본문 스트림을 먼저 소모해 이후 파싱이 깨질 수 있어 건너뛴다.
		var request = new MockHttpServletRequest("POST", "/api/v1/plays/1/raw");
		request.setContentType("multipart/form-data; boundary=X");
		request.addParameter("q", "a\u0000b");
		var response = new MockHttpServletResponse();
		var calls = new AtomicInteger();

		filter.doFilter(request, response, (req, res) -> calls.incrementAndGet());

		assertThat(calls.get()).isEqualTo(1);
	}

}
