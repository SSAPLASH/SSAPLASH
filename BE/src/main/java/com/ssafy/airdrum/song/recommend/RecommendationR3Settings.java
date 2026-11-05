package com.ssafy.airdrum.song.recommend;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.Arrays;
import java.util.HexFormat;
import java.util.Set;
import java.util.stream.Collectors;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/**
 * R3 설정. 기본값은 모두 꺼짐이고, 꺼져 있으면 추천은 R1과 완전히 같다(설계 문서 부록 C.4).
 * 비밀 값은 저장소 밖의 환경 변수로만 받고 로그·응답에 쓰지 않는다.
 */
@Component
public class RecommendationR3Settings {
	private final boolean enabled;
	private final int rolloutPercent, maxAgeDays;
	private final double relevanceWeight;
	private final Set<String> acceptedModelVersions;
	private final String keySecret;

	public RecommendationR3Settings(@Value("${recommend.r3.enabled:false}") boolean enabled,
			@Value("${recommend.r3.rollout-percent:0}") int rolloutPercent,
			@Value("${recommend.r3.max-age-days:7}") int maxAgeDays,
			@Value("${recommend.r3.relevance-weight:0.75}") double relevanceWeight,
			@Value("${recommend.r3.accepted-model-versions:}") String acceptedModelVersions,
			@Value("${recommend.r3.key-secret:}") String keySecret) {
		if (rolloutPercent < 0 || rolloutPercent > 100) throw new IllegalStateException("recommend.r3.rollout-percent는 0~100이어야 합니다.");
		if (maxAgeDays < 1) throw new IllegalStateException("recommend.r3.max-age-days는 1 이상이어야 합니다.");
		if (relevanceWeight < 0 || relevanceWeight > 1) throw new IllegalStateException("recommend.r3.relevance-weight는 0~1이어야 합니다.");
		this.enabled = enabled;
		this.rolloutPercent = rolloutPercent;
		this.maxAgeDays = maxAgeDays;
		this.relevanceWeight = relevanceWeight;
		this.acceptedModelVersions = Arrays.stream(acceptedModelVersions.split(",")).map(String::strip)
				.filter(v -> !v.isEmpty()).collect(Collectors.toUnmodifiableSet());
		this.keySecret = keySecret;
	}

	public boolean enabled() { return enabled; }
	public int maxAgeDays() { return maxAgeDays; }
	public double relevanceWeight() { return relevanceWeight; }
	public boolean accepts(String modelVersion) { return acceptedModelVersions.contains(modelVersion); }
	public boolean hasKeySecret() { return !keySecret.isBlank(); }

	/** 사용자 해시로 정한 0~99 구간이 비율 안인가. 같은 사용자는 비율을 올려도 빠지지 않는다. */
	public boolean inRollout(long userId) {
		return bucket(userId) < rolloutPercent;
	}

	static int bucket(long userId) {
		byte[] hash = sha256("rollout:" + userId);
		int value = ((hash[0] & 0xff) << 24) | ((hash[1] & 0xff) << 16) | ((hash[2] & 0xff) << 8) | (hash[3] & 0xff);
		return Integer.remainderUnsigned(value, 100);
	}

	/** 뷰의 user_key와 같은 값: SHA-256(비밀 값 + ":" + user_id)의 16진수 앞 32자. */
	String userKey(long userId) {
		return HexFormat.of().formatHex(sha256(keySecret + ":" + userId)).substring(0, 32);
	}

	private static byte[] sha256(String text) {
		try {
			return MessageDigest.getInstance("SHA-256").digest(text.getBytes(StandardCharsets.UTF_8));
		} catch (NoSuchAlgorithmException ex) {
			throw new IllegalStateException(ex);
		}
	}

	@Override public String toString() { return "RecommendationR3Settings[enabled=" + enabled + ", rolloutPercent=" + rolloutPercent + "]"; }
}
