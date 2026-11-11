package com.ssafy.airdrum.global.error;

import java.io.IOException;
import java.nio.charset.StandardCharsets;

import jakarta.servlet.http.HttpServletResponse;

import org.springframework.http.MediaType;
import org.springframework.stereotype.Component;
import tools.jackson.databind.json.JsonMapper;

/**
 * Spring MVC 밖(서블릿 필터, Security 진입점·접근 거부 핸들러)에서 전역 핸들러와 같은 오류 응답을 쓴다.
 * 자체 JSON을 만들지 말고 이 클래스를 주입받아 쓴다.
 */
@Component
public class ErrorResponseWriter {

	private final JsonMapper jsonMapper;

	public ErrorResponseWriter(JsonMapper jsonMapper) {
		this.jsonMapper = jsonMapper;
	}

	/**
	 * @param response 응답. 이미 커밋된 응답에는 쓸 수 없다
	 * @param errorCode 오류 코드. 상태·제목·code를 정한다
	 * @param detail 한국어 설명. null이면 제목을 쓴다
	 * @param path 요청 경로({@code instance}). 쿼리 문자열 제외
	 */
	public void write(HttpServletResponse response, ErrorCode errorCode, String detail, String path) throws IOException {
		var body = ApiErrorResponse.of(errorCode, detail, path);
		response.setStatus(errorCode.status().value());
		response.setCharacterEncoding(StandardCharsets.UTF_8.name());
		response.setContentType(MediaType.APPLICATION_PROBLEM_JSON_VALUE);
		response.getWriter().write(jsonMapper.writeValueAsString(body));
		response.getWriter().flush();
	}

}
