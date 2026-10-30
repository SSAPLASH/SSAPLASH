package com.ssafy.airdrum.telemetry;

import java.io.IOException;
import java.io.InputStream;
import java.time.Instant;
import java.time.format.DateTimeParseException;

import org.springframework.stereotype.Component;

import tools.jackson.core.JacksonException;
import tools.jackson.core.JsonParser;
import tools.jackson.core.JsonToken;
import tools.jackson.core.StreamReadConstraints;
import tools.jackson.core.StreamReadFeature;
import tools.jackson.core.json.JsonFactory;
import tools.jackson.databind.DeserializationContext;
import tools.jackson.databind.DeserializationFeature;
import tools.jackson.databind.MapperFeature;
import tools.jackson.databind.ValueDeserializer;
import tools.jackson.databind.cfg.EnumFeature;
import tools.jackson.databind.json.JsonMapper;
import tools.jackson.databind.module.SimpleModule;

import com.ssafy.airdrum.common.error.BusinessException;
import com.ssafy.airdrum.common.error.CommonErrorCode;

/**
 * 텔레메트리 배치 전용 파서. 다른 API의 Jackson 설정을 바꾸지 않는다.
 *
 * <p>본문을 상한 + 1바이트까지만 읽어 Content-Length 없는 요청도 128 KiB에서 끊는다. 계약 밖 필드·타입 변환·중복 키는
 * 거절하며, 오류 detail에는 JSON 위치만 담고 값은 담지 않는다.
 */
@Component
public class TelemetryJson {

	public static final int MAX_BYTES = 128 * 1024;

	private final JsonMapper mapper = JsonMapper.builder(JsonFactory.builder()
			.streamReadConstraints(StreamReadConstraints.builder().maxNestingDepth(8)
					.maxStringLength(4096).maxNumberLength(64).maxNameLength(64).build())
			.enable(StreamReadFeature.STRICT_DUPLICATE_DETECTION).build())
			.enable(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES)
			.enable(DeserializationFeature.FAIL_ON_TRAILING_TOKENS)
			.enable(EnumFeature.FAIL_ON_NUMBERS_FOR_ENUMS)
			.disable(DeserializationFeature.ACCEPT_FLOAT_AS_INT)
			.disable(MapperFeature.ALLOW_COERCION_OF_SCALARS)
			.addModule(new SimpleModule().addDeserializer(Instant.class, new ValueDeserializer<Instant>() {
				@Override
				public Instant deserialize(JsonParser parser, DeserializationContext context) {
					// 기본 역직렬화는 숫자 epoch도 받으므로 계약의 ISO-8601 문자열로 제한한다.
					if (parser.currentToken() != JsonToken.VALUE_STRING) {
						return (Instant) context.handleUnexpectedToken(Instant.class, parser);
					}
					try {
						return Instant.parse(parser.getString());
					}
					catch (DateTimeParseException ex) {
						throw context.weirdStringException(parser.getString(), Instant.class, "ISO-8601 시각이 아닙니다");
					}
				}
			})).build();

	/**
	 * @param contentLength 요청 헤더의 길이. 모르면 음수
	 */
	public TelemetryBatchRequest read(InputStream input, long contentLength) {
		if (contentLength > MAX_BYTES) {
			throw new BusinessException(TelemetryErrorCode.TELEMETRY_BATCH_TOO_LARGE);
		}
		byte[] bytes;
		try {
			bytes = input.readNBytes(MAX_BYTES + 1);
		}
		catch (IOException ex) {
			throw new BusinessException(CommonErrorCode.INVALID_INPUT, "요청 본문을 읽을 수 없습니다.");
		}
		if (bytes.length > MAX_BYTES) {
			throw new BusinessException(TelemetryErrorCode.TELEMETRY_BATCH_TOO_LARGE);
		}
		try {
			return mapper.readValue(bytes, TelemetryBatchRequest.class);
		}
		catch (JacksonException ex) {
			throw new BusinessException(CommonErrorCode.INVALID_INPUT, "요청 본문을 읽을 수 없습니다." + location(ex));
		}
	}

	/** {@code events[3].pad} 형식의 위치. 구문 오류처럼 위치가 없으면 빈 문자열. */
	private static String location(JacksonException ex) {
		var path = new StringBuilder();
		for (var reference : ex.getPath()) {
			if (reference.getPropertyName() != null) {
				if (!path.isEmpty()) path.append('.');
				path.append(reference.getPropertyName());
			}
			else if (reference.getIndex() >= 0) {
				path.append('[').append(reference.getIndex()).append(']');
			}
		}
		return path.isEmpty() ? "" : " 위치: " + path;
	}

}
