package com.ssafy.airdrum.common.error;

import jakarta.validation.Valid;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;

import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartException;
import org.springframework.web.server.ResponseStatusException;

/**
 * 전역 예외 처리기를 검증하기 위해 예외 종류별로 실패하는 테스트 전용 컨트롤러.
 * 테스트 소스에만 있으며, 같은 패키지 아래라 전체 컨텍스트 테스트에도 함께 뜬다(운영 JAR에는 포함되지 않는다).
 */
@RestController
@RequestMapping("/probe")
public class ErrorProbeController {

	public record ProbeRequest(@NotBlank String name, @Min(1) int size) {
	}

	@GetMapping("/business/domain")
	public void domainBusinessError() {
		throw new BusinessException(ProbeErrorCode.PROBE_NOT_FOUND, "프로브 7이 없습니다.");
	}

	@GetMapping("/business/common")
	public void commonBusinessError() {
		throw new BusinessException(CommonErrorCode.CONFLICT);
	}

	@PostMapping("/valid")
	public ProbeRequest validateBody(@Valid @RequestBody ProbeRequest request) {
		return request;
	}

	@GetMapping("/param")
	public int requiredParam(@RequestParam int size) {
		return size;
	}

	@GetMapping("/range")
	public int constrainedParam(@RequestParam @Min(1) int value) {
		return value;
	}

	@GetMapping("/boom")
	public void unexpectedError() {
		throw new IllegalStateException("비밀 내부 메시지");
	}

	@GetMapping("/status")
	public void springStatusError() {
		throw new ResponseStatusException(HttpStatus.CONFLICT, "이미 있음");
	}

	/** 경계(boundary) 없음·크기 초과 등 멀티파트 파싱 실패를 흉내낸다. 실제 재현은 NulParameterFilterTest 및 수동 curl로 확인했다. */
	@PostMapping("/multipart")
	public void multipartParsingFailure() {
		throw new MultipartException("요청 본문이 올바른 멀티파트 형식이 아닙니다.");
	}

}
