package com.ssafy.airdrum.play;

import java.io.InputStream;
import java.math.BigDecimal;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Instant;
import java.util.HexFormat;
import org.springframework.stereotype.Component;
import tools.jackson.core.JsonParser;
import tools.jackson.core.JsonToken;
import tools.jackson.core.json.JsonFactory;
import tools.jackson.core.StreamReadConstraints;
import tools.jackson.core.StreamReadFeature;
import tools.jackson.databind.DeserializationFeature;
import tools.jackson.databind.DeserializationContext;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.node.ObjectNode;
import tools.jackson.databind.MapperFeature;
import tools.jackson.databind.ValueDeserializer;
import tools.jackson.databind.cfg.EnumFeature;
import tools.jackson.databind.json.JsonMapper;
import tools.jackson.databind.module.SimpleModule;
import com.ssafy.airdrum.common.error.BusinessException;

/** 로그 전용 파서. 다른 API의 Jackson 설정을 바꾸지 않는다. */
@Component
public class PlayJson {
	public static final int SUMMARY_BYTES = 5 * 1024 * 1024;
	public static final int MAX_HITS = 50_000;
	private final JsonMapper mapper = JsonMapper.builder(JsonFactory.builder()
			.streamReadConstraints(StreamReadConstraints.builder().maxNestingDepth(16)
					.maxStringLength(2048).maxNumberLength(64).maxNameLength(128).build())
			.enable(StreamReadFeature.STRICT_DUPLICATE_DETECTION).build())
			.enable(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES)
			.enable(DeserializationFeature.FAIL_ON_TRAILING_TOKENS)
			.enable(EnumFeature.FAIL_ON_NUMBERS_FOR_ENUMS)
			.disable(DeserializationFeature.ACCEPT_FLOAT_AS_INT)
			.disable(MapperFeature.ALLOW_COERCION_OF_SCALARS)
			.addModule(new SimpleModule().addDeserializer(Instant.class, new ValueDeserializer<Instant>() {
				@Override
				public Instant deserialize(JsonParser parser, DeserializationContext context) {
					// Instant 기본 역직렬화는 숫자 epoch도 받으므로 로그 계약의 ISO 시각으로 제한한다.
					if (parser.currentToken() != JsonToken.VALUE_STRING)
						throw new BusinessException(PlayErrorCode.PLAY_PAYLOAD_INVALID);
					return Instant.parse(parser.getString());
				}
			})).build();
	public JsonMapper mapper() { return mapper; }
	public PlayUploadRequest read(InputStream input) {
		try {
			byte[] bytes = input.readNBytes(SUMMARY_BYTES + 1);
			if (bytes.length > SUMMARY_BYTES) throw new BusinessException(PlayErrorCode.PLAY_UPLOAD_TOO_LARGE);
			var tree = mapper.readTree(bytes);
			rejectAliasCollision(tree.path("calibration").path("pads"));
			rejectAliasCollision(tree.path("kitPresetSnapshot").path("pads"));
			// 원본 숫자를 직접 역직렬화해 트리의 실수 정밀도 변환을 피한다.
			return mapper.readValue(bytes, PlayUploadRequest.class);
		} catch (BusinessException ex) { throw ex; }
		catch (Exception ex) { throw new BusinessException(PlayErrorCode.PLAY_PAYLOAD_INVALID); }
	}
	public String write(Object value) { return value == null ? null : mapper.writeValueAsString(value); }
	public String hash(long userId, PlayUploadRequest request) {
		return hash(userId, mapper.valueToTree(request));
	}
	/** 기존 v1 해시는 패드의 이전 이름을 사용했다. 다른 문자열 필드는 건드리지 않는다. */
	public String legacyHash(long userId, PlayUploadRequest request) {
		ObjectNode tree = mapper.valueToTree(request);
		for (var hit : tree.path("hits")) {
			legacyValue(hit, "pad"); legacyValue(hit, "baselinePad"); legacyValue(hit, "predictedPad");
		}
		legacyKeys(tree.path("calibration").path("pads"));
		legacyKeys(tree.path("kitPresetSnapshot").path("pads"));
		legacyMapping(tree.path("kitPresetSnapshot").path("keyBindings"));
		legacyMapping(tree.path("judgementContext").path("padMapping"));
		return hash(userId, tree);
	}
	private void rejectAliasCollision(JsonNode node) {
		if (node.isObject() && node.has("HI_TOM") && node.has("SMALL_TOM"))
			throw new BusinessException(PlayErrorCode.PLAY_PAYLOAD_INVALID);
	}
	private void legacyKeys(JsonNode node) {
		if (node instanceof ObjectNode object && object.has("SMALL_TOM")) {
			var value = object.remove("SMALL_TOM"); object.set("HI_TOM", value);
		}
	}
	private void legacyMapping(JsonNode node) {
		if (node instanceof ObjectNode object) {
			var keys = new java.util.ArrayList<String>();
			object.properties().forEach(e -> keys.add(e.getKey()));
			keys.forEach(key -> legacyValue(object, key));
		}
	}
	private void legacyValue(JsonNode node, String key) {
		if (node instanceof ObjectNode object && "SMALL_TOM".equals(object.path(key).asString())) object.put(key, "HI_TOM");
	}
	private String hash(long userId, JsonNode tree) {
		var digest = sha256();
		digest.update(("play:1:" + userId + ":").getBytes(StandardCharsets.UTF_8));
		canonical(tree, digest);
		return HexFormat.of().formatHex(digest.digest());
	}
	private void canonical(JsonNode node, MessageDigest digest) {
		if (node.isObject()) {
			update(digest, "{");
			var fields = new java.util.TreeSet<String>();
			node.properties().forEach(e -> fields.add(e.getKey()));
			for (String key : fields) { update(digest, mapper.writeValueAsString(key) + ":"); canonical(node.get(key), digest); update(digest, ","); }
			update(digest, "}");
		} else if (node.isArray()) {
			update(digest, "["); for (var item : node) { canonical(item, digest); update(digest, ","); } update(digest, "]");
		} else if (node.isNumber()) {
			update(digest, new BigDecimal(node.asString()).stripTrailingZeros().toPlainString());
		} else update(digest, mapper.writeValueAsString(node));
	}
	private static void update(MessageDigest digest, String value) { digest.update(value.getBytes(StandardCharsets.UTF_8)); }
	public static MessageDigest sha256() {
		try { return MessageDigest.getInstance("SHA-256"); }
		catch (NoSuchAlgorithmException ex) { throw new IllegalStateException(ex); }
	}
}
