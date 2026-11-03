package com.ssafy.airdrum.recording;

import java.nio.charset.StandardCharsets;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

import com.ssafy.airdrum.common.error.BusinessException;
import com.ssafy.airdrum.common.error.ErrorCode;
import com.ssafy.airdrum.play.PlayUploadRequest.Pad;

import static com.ssafy.airdrum.recording.RecordingFixtures.KEY;
import static com.ssafy.airdrum.recording.RecordingFixtures.free;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/** 256번 설계 3-2절: 녹음 요청 파싱·검증·정규화·해시. */
class RecordingPayloadTest {

	final RecordingJson json = new RecordingJson();
	final RecordingValidator validator = new RecordingValidator();

	RecordingRequest read(String body) {
		return json.read(body.getBytes(StandardCharsets.UTF_8));
	}

	RecordingRequest normalized(String body) {
		return validator.normalize(read(body));
	}

	void rejected(String body, ErrorCode code) {
		assertThatThrownBy(() -> normalized(body)).isInstanceOf(BusinessException.class)
				.extracting(e -> ((BusinessException) e).getErrorCode()).isEqualTo(code);
	}

	@Test
	void 정상_요청은_제목을_다듬고_HI_TOM을_SMALL_TOM으로_바꾼다() {
		var r = normalized(free(KEY));
		assertThat(r.title()).isEqualTo("즉흥 연주 1");
		assertThat(r.clientKey()).isEqualTo(KEY);
		assertThat(r.hits()).extracting(RecordingRequest.Hit::pad).containsExactly(Pad.SNARE, Pad.SMALL_TOM, Pad.KICK);
		assertThat(r.hits().get(2).stickId()).isNull();
		assertThat(json.hitsJson(r)).isEqualTo("[{\"tMs\":0.0,\"pad\":\"SNARE\",\"velocity\":90,\"stickId\":1},"
				+ "{\"tMs\":250.5,\"pad\":\"SMALL_TOM\",\"velocity\":64,\"stickId\":0},{\"tMs\":1000.0,\"pad\":\"KICK\",\"velocity\":110}]");
	}

	@Test
	void 시간순이_아니면_tMs로_안정_정렬하고_해시는_시간순_요청과_같다() {
		String ordered = free(KEY);
		String reversed = ordered.replace(
				"[{\"tMs\":0,\"pad\":\"SNARE\",\"velocity\":90,\"stickId\":1},{\"tMs\":250.5,\"pad\":\"HI_TOM\",\"velocity\":64,\"stickId\":0},{\"tMs\":1000,\"pad\":\"KICK\",\"velocity\":110}]",
				"[{\"tMs\":1000,\"pad\":\"KICK\",\"velocity\":110},{\"tMs\":250.5,\"pad\":\"HI_TOM\",\"velocity\":64,\"stickId\":0},{\"tMs\":0,\"pad\":\"SNARE\",\"velocity\":90,\"stickId\":1}]");
		assertThat(reversed).isNotEqualTo(ordered);
		var sorted = normalized(reversed);
		assertThat(sorted.hits()).extracting(RecordingRequest.Hit::tMs).containsExactly(0.0, 250.5, 1000.0);
		assertThat(json.hash(7, sorted)).isEqualTo(json.hash(7, normalized(ordered))).isNotEqualTo(json.hash(8, sorted));

		// 같은 시각끼리는 받은 순서를 지킨다.
		String ties = ordered.replace("\"tMs\":250.5", "\"tMs\":0");
		assertThat(normalized(ties).hits()).extracting(RecordingRequest.Hit::pad).containsExactly(Pad.SNARE, Pad.SMALL_TOM, Pad.KICK);
		String swapped = ties.replace(
				"{\"tMs\":0,\"pad\":\"SNARE\",\"velocity\":90,\"stickId\":1},{\"tMs\":0,\"pad\":\"HI_TOM\",\"velocity\":64,\"stickId\":0}",
				"{\"tMs\":0,\"pad\":\"HI_TOM\",\"velocity\":64,\"stickId\":0},{\"tMs\":0,\"pad\":\"SNARE\",\"velocity\":90,\"stickId\":1}");
		assertThat(normalized(swapped).hits()).extracting(RecordingRequest.Hit::pad).containsExactly(Pad.SMALL_TOM, Pad.SNARE, Pad.KICK);
		assertThat(json.hash(7, normalized(swapped))).isNotEqualTo(json.hash(7, normalized(ties)));
	}

	@Test
	void 표현만_다른_같은_내용은_해시가_같고_내용이_다르면_다르다() {
		String base = free(KEY);
		String same = base.replace("\"startedAt\":\"2026-11-03T01:00:00Z\"", "\"startedAt\":\"2026-11-03T10:00:00+09:00\"")
				.replace("\"tMs\":250.5", "\"tMs\":250.50").replace("\"pad\":\"HI_TOM\"", "\"pad\":\"SMALL_TOM\"")
				.replace("\"velocity\":110}", "\"velocity\":110,\"stickId\":null}").replace("\"playId\":null,", "")
				.replace("\"title\":\"  즉흥 연주 1 \"", "\"title\":\"즉흥 연주 1\"").replace("\n", " ");
		assertThat(json.hash(7, normalized(same))).isEqualTo(json.hash(7, normalized(base)));
		assertThat(json.hash(7, normalized(base.replace("\"velocity\":90", "\"velocity\":91")))).isNotEqualTo(json.hash(7, normalized(base)));
		assertThat(json.hash(7, normalized(base.replace("즉흥 연주 1", "즉흥 연주 2")))).isNotEqualTo(json.hash(7, normalized(base)));
	}

	@Test
	void 타격은_1개에서_50000개까지다() {
		assertThat(normalized(RecordingFixtures.many(KEY, 50_000)).hits()).hasSize(50_000);
		rejected(RecordingFixtures.many(KEY, 50_001), RecordingError.RECORDING_TOO_LARGE);
		rejected(free(KEY).replaceAll("\"hits\":\\[.*]", "\"hits\":[]"), RecordingError.RECORDING_INVALID);
	}

	@Test
	void 길이는_2시간까지이고_마지막_타격보다_짧을_수_없다() {
		normalized(free(KEY).replace("\"durationMs\":1500", "\"durationMs\":1000"));
		normalized(free(KEY).replace("\"durationMs\":1500", "\"durationMs\":7200000"));
		rejected(free(KEY).replace("\"durationMs\":1500", "\"durationMs\":7200001"), RecordingError.RECORDING_TOO_LARGE);
		rejected(free(KEY).replace("\"durationMs\":1500", "\"durationMs\":999"), RecordingError.RECORDING_INVALID);
		rejected(free(KEY).replace("\"durationMs\":1500", "\"durationMs\":-1"), RecordingError.RECORDING_INVALID);
	}

	@Test
	void 본문이_5MiB를_넘으면_413() {
		byte[] big = new byte[RecordingJson.MAX_BYTES + 1];
		java.util.Arrays.fill(big, (byte) ' ');
		assertThatThrownBy(() -> json.read(big)).isInstanceOf(BusinessException.class)
				.extracting(e -> ((BusinessException) e).getErrorCode()).isEqualTo(RecordingError.RECORDING_TOO_LARGE);
	}

	@Test
	void 스키마_버전이_1이_아니면_409() {
		rejected(free(KEY).replace("\"schemaVersion\":1", "\"schemaVersion\":2"), RecordingError.RECORDING_SCHEMA_UNSUPPORTED);
	}

	@ParameterizedTest
	@ValueSource(strings = {
			"\"surprise\":1,", "\"schemaVersion\":1,", "\"judgement\":\"PERFECT\","})
	void 모르는_필드와_중복_키는_거부한다(String prefix) {
		rejected(free(KEY).replaceFirst("\\{", "{" + prefix), RecordingError.RECORDING_INVALID);
	}

	@ParameterizedTest
	@ValueSource(strings = {
			"\"velocity\":90,\"stickId\":1}|\"velocity\":90,\"stickId\":1,\"judgement\":\"GOOD\"}",
			"\"velocity\":90|\"velocity\":\"90\"",
			"\"velocity\":90|\"velocity\":90.5",
			"\"velocity\":90|\"velocity\":128",
			"\"velocity\":90|\"velocity\":-1",
			"\"velocity\":110}|\"pad\":\"COWBELL\",\"velocity\":110}",
			"\"pad\":\"SNARE\"|\"pad\":1",
			"\"stickId\":1|\"stickId\":2",
			"\"tMs\":0,|\"tMs\":-0.5,",
			"\"tMs\":0,|\"tMs\":\"0\",",
			"\"mode\":\"FREE\"|\"mode\":\"LIVE\"",
			"\"mode\":\"FREE\"|\"mode\":1",
			"\"inputSource\":\"STICK\"|\"inputSource\":\"MOUSE\"",
			"\"startedAt\":\"2026-11-03T01:00:00Z\"|\"startedAt\":1762131600000",
			"\"startedAt\":\"2026-11-03T01:00:00Z\"|\"startedAt\":\"2026-11-03T01:00:00.0000001Z\"",
			"\"clientKey\":\"5b0f7a1e-2c3d-4e5f-8a9b-0c1d2e3f4a5b\",|",
			"\"clientKey\":\"5b0f7a1e-2c3d-4e5f-8a9b-0c1d2e3f4a5b\"|\"clientKey\":\"not-uuid\"",
			"\"title\":\"  즉흥 연주 1 \"|\"title\":\"   \"",
			"\"title\":\"  즉흥 연주 1 \"|\"title\":null",
			"\"title\":\"  즉흥 연주 1 \"|\"title\":1",
			"\"mode\":\"FREE\",|",
			"\"durationMs\":1500,|",
			"\"startedAt\":\"2026-11-03T01:00:00Z\",|",
			"\"playId\":null|\"playId\":\"x\"",
			"\"hits\":[|\"hits\":[null,"})
	void 잘못된_값은_400(String replacement) {
		String[] parts = replacement.split("\\|", -1);
		String body = free(KEY).replace(parts[0], parts[1]);
		assertThat(body).isNotEqualTo(free(KEY));
		rejected(body, RecordingError.RECORDING_INVALID);
	}

	@Test
	void 제목은_100자까지이고_NUL은_안된다() {
		normalized(free(KEY).replace("  즉흥 연주 1 ", "가".repeat(100)));
		rejected(free(KEY).replace("  즉흥 연주 1 ", "가".repeat(101)), RecordingError.RECORDING_INVALID);
		rejected(free(KEY).replace("  즉흥 연주 1 ", "a\\u0000b"), RecordingError.RECORDING_INVALID);
	}

	@Test
	void 키보드_입력은_손_정보를_보낼_수_없다() {
		rejected(free(KEY).replace("\"inputSource\":\"STICK\"", "\"inputSource\":\"KEYBOARD\""), RecordingError.RECORDING_INVALID);
		String keyboard = free(KEY).replace("\"inputSource\":\"STICK\"", "\"inputSource\":\"KEYBOARD\"")
				.replace(",\"stickId\":1", "").replace(",\"stickId\":0", "");
		normalized(keyboard);
	}

	@Test
	void 후행_토큰과_배열_본문과_깨진_JSON은_거부한다() {
		for (String bad : new String[] {free(KEY) + "{}", "[]", "{", "", "null"})
			rejected(bad, RecordingError.RECORDING_INVALID);
	}

	/** 검증 D2: DB timestamptz 범위 밖 시각이 INSERT에서 500이 되지 않게 2020-01-01 이상 2100-01-01 미만만 받는다. */
	@Test
	void 녹음_시작_시각은_2020년부터_2100년_전까지다() {
		normalized(free(KEY).replace("2026-11-03T01:00:00Z", "2020-01-01T00:00:00Z"));
		normalized(free(KEY).replace("2026-11-03T01:00:00Z", "2099-12-31T23:59:59.999999Z"));
		for (String bad : new String[] {"2019-12-31T23:59:59.999999Z", "2100-01-01T00:00:00Z", "+300000-01-01T00:00:00Z", "-5000-01-01T00:00:00Z"})
			rejected(free(KEY).replace("2026-11-03T01:00:00Z", bad), RecordingError.RECORDING_INVALID);
	}

	/** 검증 D3: -0.0은 0으로 저장해 같은 시각의 받은 순서와 해시를 지킨다. */
	@Test
	void 음수_0은_0과_같은_시각이다() {
		String zero = free(KEY).replace("\"tMs\":250.5", "\"tMs\":0");
		String negativeZero = free(KEY).replace("\"tMs\":250.5", "\"tMs\":-0.0");
		var r = normalized(negativeZero);
		assertThat(r.hits()).extracting(RecordingRequest.Hit::pad).containsExactly(Pad.SNARE, Pad.SMALL_TOM, Pad.KICK);
		assertThat(json.hitsJson(r)).doesNotContain("-0.0");
		assertThat(json.hash(7, r)).isEqualTo(json.hash(7, normalized(zero)));
	}

	/** 검증 D4: 제목 길이는 DB varchar(100)과 같이 코드 포인트로 센다. */
	@Test
	void 제목_길이는_글자_수로_센다() {
		String drum = "🥁";
		assertThat(normalized(free(KEY).replace("  즉흥 연주 1 ", drum.repeat(100))).title().codePointCount(0, 200)).isEqualTo(100);
		rejected(free(KEY).replace("  즉흥 연주 1 ", drum.repeat(101)), RecordingError.RECORDING_INVALID);
	}

	@Test
	void 네_모드를_받는다() {
		for (String mode : new String[] {"RHYTHM", "FREE", "TEMPO", "SHEET"})
			assertThat(normalized(free(KEY).replace("\"mode\":\"FREE\"", "\"mode\":\"" + mode + "\"")).mode().name()).isEqualTo(mode);
	}
}
