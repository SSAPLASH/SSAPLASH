package com.ssafy.airdrum.global.error;

import java.util.ArrayList;
import java.util.List;

import jakarta.servlet.http.HttpServletRequest;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.TypeMismatchException;
import org.springframework.context.MessageSourceResolvable;
import org.springframework.core.MethodParameter;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatusCode;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.validation.BindingResult;
import org.springframework.validation.FieldError;
import org.springframework.web.ErrorResponse;
import org.springframework.web.HttpMediaTypeNotAcceptableException;
import org.springframework.web.HttpMediaTypeNotSupportedException;
import org.springframework.web.HttpRequestMethodNotSupportedException;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.MissingServletRequestParameterException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.context.request.ServletWebRequest;
import org.springframework.web.context.request.WebRequest;
import org.springframework.web.method.annotation.HandlerMethodValidationException;
import org.springframework.web.method.annotation.MethodArgumentTypeMismatchException;
import org.springframework.web.multipart.MultipartException;
import org.springframework.web.server.ResponseStatusException;
import org.springframework.web.servlet.NoHandlerFoundException;
import org.springframework.web.servlet.mvc.method.annotation.ResponseEntityExceptionHandler;
import org.springframework.web.servlet.resource.NoResourceFoundException;

/**
 * 모든 컨트롤러의 예외를 {@link ApiErrorResponse}로 바꾼다.
 *
 * <p>Spring MVC가 분류한 예외(없는 경로·메서드·미디어 타입·본문 파싱·검증 실패)는 상위 클래스가 상태를 정하고,
 * {@link #handleExceptionInternal}이 한 곳에서 우리 형식과 한국어 문구로 바꾼다. 이 빈이 있으면 Boot의
 * Problem Details 자동 구성은 물러나므로 {@code spring.mvc.problemdetails.enabled}는 켜지 않는다.
 *
 * <p>로그: 4xx는 WARN 한 줄(스택 없음), 5xx는 ERROR + 스택 1회. 응답에는 예외 클래스·메시지·스택을 내지 않는다.
 */
@RestControllerAdvice
public class GlobalExceptionHandler extends ResponseEntityExceptionHandler {

	private static final Logger log = LoggerFactory.getLogger(GlobalExceptionHandler.class);

	static final String INTERNAL_ERROR_DETAIL = "서버 내부 오류가 발생했습니다.";
	static final String VALIDATION_DETAIL = "입력값을 확인해 주세요.";

	@ExceptionHandler(BusinessException.class)
	public ResponseEntity<ApiErrorResponse> handleBusiness(BusinessException ex, HttpServletRequest request) {
		var body = ApiErrorResponse.of(ex.getErrorCode(), ex.getDetail(), request.getRequestURI());
		logResult(request.getMethod(), request.getRequestURI(), body, ex);
		return respond(body);
	}

	/**
	 * 본문 경계(boundary)가 없거나 형식이 깨진 multipart 요청. 컨테이너·Spring이 파싱 중 던지는
	 * {@link MultipartException}(크기 초과 포함)은 업로드를 보낸 쪽의 잘못이므로 400으로 본다.
	 * ZAP 공격 스캔에서 이 요청들이 처리되지 않아 500으로 나간 것을 확인했다(SECURITY.md 16절).
	 */
	@ExceptionHandler(MultipartException.class)
	public ResponseEntity<ApiErrorResponse> handleMultipart(MultipartException ex, HttpServletRequest request) {
		var body = ApiErrorResponse.of(CommonErrorCode.INVALID_INPUT, "요청 본문(파일 업로드)을 읽을 수 없습니다.",
				request.getRequestURI());
		logResult(request.getMethod(), request.getRequestURI(), body, ex);
		return respond(body);
	}

	/** 분류되지 않은 모든 예외. 내부 정보를 노출하지 않는다. */
	@ExceptionHandler(Exception.class)
	public ResponseEntity<ApiErrorResponse> handleUnexpected(Exception ex, HttpServletRequest request) {
		var body = ApiErrorResponse.of(CommonErrorCode.INTERNAL_ERROR, INTERNAL_ERROR_DETAIL, request.getRequestURI());
		logResult(request.getMethod(), request.getRequestURI(), body, ex);
		return respond(body);
	}

	/**
	 * 상위 클래스의 모든 핸들러가 마지막에 거치는 단일 변환 지점. 상태 코드는 상위 클래스가 정한 값을 유지하고,
	 * 코드·문구만 우리 것으로 바꾼다. 상위 클래스가 만든 {@code body}(ProblemDetail)는 쓰지 않는다.
	 */
	@Override
	protected ResponseEntity<Object> handleExceptionInternal(Exception ex, Object body, HttpHeaders headers,
			HttpStatusCode statusCode, WebRequest request) {
		var servletRequest = ((ServletWebRequest) request).getRequest();
		var path = servletRequest.getRequestURI();

		ErrorCode errorCode = CommonErrorCode.fromStatus(statusCode);
		String detail;
		List<FieldErrorDetail> errors = null;

		if (ex instanceof MethodArgumentNotValidException notValid) {
			errorCode = CommonErrorCode.VALIDATION_FAILED;
			detail = VALIDATION_DETAIL;
			errors = fieldErrors(notValid.getBindingResult());
		}
		else if (ex instanceof HandlerMethodValidationException methodValidation) {
			errorCode = CommonErrorCode.VALIDATION_FAILED;
			detail = VALIDATION_DETAIL;
			errors = parameterErrors(methodValidation);
		}
		else if (ex instanceof HttpMessageNotReadableException) {
			detail = "요청 본문을 읽을 수 없습니다.";
		}
		else if (ex instanceof MissingServletRequestParameterException missing) {
			detail = "필수 파라미터 '" + missing.getParameterName() + "'이(가) 없습니다.";
		}
		else if (ex instanceof MethodArgumentTypeMismatchException mismatch) {
			detail = "파라미터 '" + mismatch.getName() + "'의 형식이 올바르지 않습니다.";
		}
		else if (ex instanceof TypeMismatchException mismatch) {
			var name = mismatch.getPropertyName() == null ? "값" : mismatch.getPropertyName();
			detail = "파라미터 '" + name + "'의 형식이 올바르지 않습니다.";
		}
		else if (ex instanceof NoResourceFoundException || ex instanceof NoHandlerFoundException) {
			detail = "요청한 경로가 없습니다.";
		}
		else if (ex instanceof HttpRequestMethodNotSupportedException notSupported) {
			var supported = notSupported.getSupportedMethods();
			detail = "허용되지 않는 메서드입니다."
					+ (supported == null ? "" : " 허용: " + String.join(", ", supported));
		}
		else if (ex instanceof HttpMediaTypeNotSupportedException) {
			detail = "지원하지 않는 요청 형식입니다.";
		}
		else if (ex instanceof HttpMediaTypeNotAcceptableException) {
			detail = "표현할 수 없는 응답 형식입니다.";
		}
		else if (ex instanceof ErrorResponse errorResponse) {
			detail = errorResponse.getBody().getDetail();
			if ((detail == null || detail.isBlank()) && ex instanceof ResponseStatusException statusException) {
				detail = statusException.getReason();
			}
		}
		else {
			detail = null;
		}

		var apiError = ApiErrorResponse.of(errorCode, statusCode, detail, path, errors);
		logResult(servletRequest.getMethod(), path, apiError, ex);
		return ResponseEntity.status(statusCode)
				.headers(headers)
				.contentType(MediaType.APPLICATION_PROBLEM_JSON)
				.body(apiError);
	}

	private static ResponseEntity<ApiErrorResponse> respond(ApiErrorResponse body) {
		return ResponseEntity.status(body.status())
				.contentType(MediaType.APPLICATION_PROBLEM_JSON)
				.body(body);
	}

	private static void logResult(String method, String path, ApiErrorResponse body, Exception ex) {
		if (body.status() >= 500) {
			log.error("{} {} -> {} {}: {}", method, path, body.status(), body.code(), body.detail(), ex);
		}
		else {
			log.warn("{} {} -> {} {}: {}", method, path, body.status(), body.code(), body.detail());
		}
	}

	/** 본문 검증 실패. 거부된 값은 넣지 않는다. */
	private static List<FieldErrorDetail> fieldErrors(BindingResult bindingResult) {
		var errors = new ArrayList<FieldErrorDetail>();
		for (var error : bindingResult.getFieldErrors()) {
			errors.add(new FieldErrorDetail(error.getField(), error.getDefaultMessage()));
		}
		for (var error : bindingResult.getGlobalErrors()) {
			errors.add(new FieldErrorDetail(error.getObjectName(), error.getDefaultMessage()));
		}
		return errors;
	}

	/** 파라미터(@RequestParam·@PathVariable 등) 제약 실패. 필드명은 요청 파라미터 이름을 쓴다. */
	private static List<FieldErrorDetail> parameterErrors(HandlerMethodValidationException ex) {
		var errors = new ArrayList<FieldErrorDetail>();
		for (var result : ex.getParameterValidationResults()) {
			var parameterName = parameterName(result.getMethodParameter());
			for (MessageSourceResolvable error : result.getResolvableErrors()) {
				var field = (error instanceof FieldError fieldError) ? fieldError.getField() : parameterName;
				errors.add(new FieldErrorDetail(field, error.getDefaultMessage()));
			}
		}
		return errors;
	}

	private static String parameterName(MethodParameter parameter) {
		var requestParam = parameter.getParameterAnnotation(RequestParam.class);
		if (requestParam != null && !requestParam.name().isEmpty()) {
			return requestParam.name();
		}
		if (requestParam != null && !requestParam.value().isEmpty()) {
			return requestParam.value();
		}
		var name = parameter.getParameterName();
		return name != null ? name : "arg" + parameter.getParameterIndex();
	}

}
