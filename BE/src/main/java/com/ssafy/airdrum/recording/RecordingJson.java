package com.ssafy.airdrum.recording;

import java.math.BigDecimal;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Instant;
import java.util.HexFormat;
import java.util.TreeSet;

import org.springframework.stereotype.Component;

import tools.jackson.core.JsonParser;
import tools.jackson.core.JsonToken;
import tools.jackson.core.StreamReadConstraints;
import tools.jackson.core.StreamReadFeature;
import tools.jackson.core.json.JsonFactory;
import tools.jackson.databind.DeserializationContext;
import tools.jackson.databind.DeserializationFeature;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.MapperFeature;
import tools.jackson.databind.ValueDeserializer;
import tools.jackson.databind.cfg.EnumFeature;
import tools.jackson.databind.json.JsonMapper;
import tools.jackson.databind.module.SimpleModule;

import com.ssafy.airdrum.common.error.BusinessException;
import com.ssafy.airdrum.play.PlayJson;

/**
 * 녹음 전용 파서·해시. 플레이 로그({@link PlayJson})와 같은 엄격함을 쓰되 오류 코드를 녹음 것으로 낸다.
 * 다른 API의 Jackson 설정은 바꾸지 않는다.
 */
@Component
class RecordingJson {
	static final int MAX_BYTES = 5 * 1024 * 1024;

	private final JsonMapper mapper = JsonMapper.builder(JsonFactory.builder()
			.streamReadConstraints(StreamReadConstraints.builder().maxNestingDepth(16)
					.maxStringLength(2048).maxNumberLength(64).maxNameLength(128).build())
			.enable(StreamReadFeature.STRICT_DUPLICATE_DETECTION).build())
			.enable(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES)
			.enable(DeserializationFeature.FAIL_ON_TRAILING_TOKENS)
			.enable(EnumFeature.FAIL_ON_NUMBERS_FOR_ENUMS)
			.disable(DeserializationFeature.ACCEPT_FLOAT_AS_INT)
			.disable(MapperFeature.ALLOW_COERCION_OF_SCALARS)
			.addModule(new SimpleModule()
					.addDeserializer(Instant.class, new ValueDeserializer<Instant>() {
						@Override
						public Instant deserialize(JsonParser parser, DeserializationContext context) {
							// 기본 역직렬화는 숫자 epoch도 받으므로 ISO 문자열로 제한한다.
							if (parser.currentToken() != JsonToken.VALUE_STRING) throw invalid();
							return Instant.parse(parser.getString());
						}
					})
					.addDeserializer(String.class, new ValueDeserializer<String>() {
						@Override
						public String deserialize(JsonParser parser, DeserializationContext context) {
							// 숫자·불리언을 문자열로 바꿔 받지 않는다(제목에 1이 오면 거부).
							if (parser.currentToken() != JsonToken.VALUE_STRING) throw invalid();
							return parser.getString();
						}
					}))
			.build();

	/** 본문을 읽는다. 5 MiB를 넘으면 413, 형식이 틀리면 400. null 본문도 400. */
	RecordingRequest read(byte[] bytes) {
		if (bytes.length > MAX_BYTES) throw new BusinessException(RecordingError.RECORDING_TOO_LARGE);
		try {
			var request = mapper.readValue(bytes, RecordingRequest.class);
			if (request == null) throw invalid();
			return request;
		} catch (BusinessException ex) {
			throw ex;
		} catch (Exception ex) {
			throw invalid();
		}
	}

	/** 정규화된 타격 배열을 저장용 JSON으로 쓴다. 상세 조회는 이 문자열을 그대로 돌려준다. */
	String hitsJson(RecordingRequest normalized) {
		return mapper.writeValueAsString(normalized.hits());
	}

	/** 정규화된 요청의 SHA-256. 키 순서·공백·숫자 표기·시간대 표기와 무관하고, 회원이 다르면 다르다. */
	String hash(long user, RecordingRequest normalized) {
		MessageDigest digest = PlayJson.sha256();
		update(digest, "recording:1:" + user + ":");
		canonical(mapper.valueToTree(normalized), digest);
		return HexFormat.of().formatHex(digest.digest());
	}

	private void canonical(JsonNode node, MessageDigest digest) {
		if (node.isObject()) {
			update(digest, "{");
			var fields = new TreeSet<String>();
			node.properties().forEach(e -> {
				if (!e.getValue().isNull()) fields.add(e.getKey());
			});
			for (String key : fields) {
				update(digest, mapper.writeValueAsString(key) + ":");
				canonical(node.get(key), digest);
				update(digest, ",");
			}
			update(digest, "}");
		} else if (node.isArray()) {
			update(digest, "[");
			for (var item : node) {
				canonical(item, digest);
				update(digest, ",");
			}
			update(digest, "]");
		} else if (node.isNumber()) {
			update(digest, new BigDecimal(node.asString()).stripTrailingZeros().toPlainString());
		} else {
			update(digest, mapper.writeValueAsString(node));
		}
	}

	private static void update(MessageDigest digest, String value) {
		digest.update(value.getBytes(StandardCharsets.UTF_8));
	}

	private static BusinessException invalid() {
		return new BusinessException(RecordingError.RECORDING_INVALID);
	}
}
