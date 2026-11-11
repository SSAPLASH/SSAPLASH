package com.ssafy.airdrum.domain.recording.model;

import java.math.BigDecimal;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Instant;
import java.util.HexFormat;
import java.util.List;
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

import com.ssafy.airdrum.domain.recording.dto.RecordingRequest;
import com.ssafy.airdrum.domain.recording.exception.RecordingError;
import com.ssafy.airdrum.global.error.BusinessException;
import com.ssafy.airdrum.domain.play.model.PlayJson;

/**
 * 녹음 전용 파서·해시. 플레이 로그({@link PlayJson})와 같은 엄격함을 쓰되 오류 코드를 녹음 것으로 낸다.
 * 다른 API의 Jackson 설정은 바꾸지 않는다.
 */
@Component
public class RecordingJson {
	public static final int MAX_BYTES = 5 * 1024 * 1024;

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
	public RecordingRequest read(byte[] bytes) {
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
	public String hitsJson(RecordingRequest normalized) {
		return mapper.writeValueAsString(normalized.hits());
	}

	/**
	 * 저장된 타격 배열을 읽는다. 요청 매퍼의 숫자 길이 제한(64자)을 쓰면 안 된다: jsonb는 1e-70 같은 아주 작은 수를
	 * 지수 없이 긴 소수로 풀어 저장해(4.9e-324는 약 330자) 받아들인 녹음을 다시 읽지 못하게 된다(257 검증 D7).
	 * 우리가 쓴 데이터만 읽으므로 제한을 넉넉히 둔다. Hit의 stickId 생략 규칙은 어노테이션이라 그대로 적용된다.
	 */
	public List<RecordingRequest.Hit> readHits(String stored) {
		return STORED.readValue(stored, STORED.getTypeFactory().constructCollectionType(List.class, RecordingRequest.Hit.class));
	}

	private static final JsonMapper STORED = JsonMapper.builder(JsonFactory.builder()
			.streamReadConstraints(StreamReadConstraints.builder().maxNumberLength(1000).build()).build()).build();

	/** 정규화된 요청의 SHA-256. 키 순서·공백·숫자 표기·시간대 표기와 무관하고, 회원이 다르면 다르다. */
	public String hash(long user, RecordingRequest normalized) {
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
