package com.ssafy.airdrum.song.musicxml;

import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.ByteBuffer;
import java.time.Duration;
import java.util.List;
import java.util.concurrent.CompletionStage;
import java.util.concurrent.Flow;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

import com.ssafy.airdrum.common.error.BusinessException;

/**
 * AI 서버 {@code POST /chart/sheet} 동기 호출(293번 설계 3-3·4-2절). 주소는 약점 분석과 같은 {@code AI_ANALYSIS_BASE_URL}이다.
 * 파일 바이트를 본문으로 보내고 {@code chart}(채보 JSON)·{@code sheet}(변환 메타)를 받는다. AI 오류 코드를 BE 오류 코드로 바꾸며,
 * 연결 실패·시간 초과·5xx·계약 밖 응답은 모두 {@code MUSICXML_UNAVAILABLE}이다. 악보 본문·응답 본문은 로그에 남기지 않는다.
 */
@Component
public class MusicXmlConvertClient {

	private static final Logger log = LoggerFactory.getLogger(MusicXmlConvertClient.class);
	static final int MAX_RESPONSE_BYTES = 5 * 1024 * 1024;
	static final Duration DEFAULT_TIMEOUT = Duration.ofSeconds(10);
	private static final int DETAIL_LIMIT = 200;

	private final HttpClient client;
	private final URI endpoint;
	private final JsonMapper json;
	private final Duration timeout;

	/** @param chart AI chart.json(음원 워커 결과와 같은 모양) · @param sheet 변환 메타 · @param durationMs {@code sheet.duration_ms} */
	public record Converted(JsonNode chart, JsonNode sheet, int durationMs) {
	}

	@Autowired
	public MusicXmlConvertClient(@Value("${AI_ANALYSIS_BASE_URL:http://ai-api:8000}") String base, JsonMapper json) {
		this(base, json, DEFAULT_TIMEOUT);
	}

	public MusicXmlConvertClient(String base, JsonMapper json, Duration timeout) {
		this.endpoint = URI.create(base.replaceAll("/+$", "") + "/chart/sheet");
		this.json = json;
		this.timeout = timeout;
		this.client = HttpClient.newBuilder().version(HttpClient.Version.HTTP_1_1).connectTimeout(Duration.ofSeconds(1)).build();
	}

	public Converted convert(byte[] body, MusicXmlSniffer.Kind kind) {
		var request = HttpRequest.newBuilder(URI.create(endpoint + "?name=" + kind.fileName())).timeout(timeout)
				.header("Content-Type", "application/octet-stream").POST(HttpRequest.BodyPublishers.ofByteArray(body)).build();
		HttpResponse<byte[]> response;
		try {
			response = client.send(request, info -> new LimitedBody());
		} catch (IOException ex) {
			log.warn("musicxml convert transport error type={}", ex.getClass().getSimpleName());
			throw new BusinessException(MusicXmlErrorCode.UNAVAILABLE);
		} catch (InterruptedException ex) {
			Thread.currentThread().interrupt();
			throw new BusinessException(MusicXmlErrorCode.UNAVAILABLE);
		}
		int status = response.statusCode();
		byte[] data = response.body();
		return switch (status) {
			case 200 -> parse(data);
			case 400 -> throw new BusinessException(MusicXmlErrorCode.UNSUPPORTED, message(data));
			case 422 -> throw new BusinessException(MusicXmlErrorCode.NO_DRUM_NOTES, message(data));
			case 413 -> throw new BusinessException(MusicXmlErrorCode.TOO_LARGE);
			default -> {
				log.warn("musicxml convert unexpected status={}", status);
				throw new BusinessException(MusicXmlErrorCode.UNAVAILABLE);
			}
		};
	}

	/** 200 응답은 {@code chart} 객체와 {@code sheet.duration_ms}(1~1,800,000)가 있어야 한다. 아니면 서버 쪽 문제로 보고 503. */
	private Converted parse(byte[] data) {
		JsonNode root;
		try {
			root = json.readTree(data);
		} catch (RuntimeException ex) {
			log.warn("musicxml convert response is not JSON");
			throw new BusinessException(MusicXmlErrorCode.UNAVAILABLE);
		}
		var chart = root.path("chart");
		var sheet = root.path("sheet");
		var duration = sheet.path("duration_ms");
		if (!root.isObject() || !chart.isObject() || chart.isEmpty() || !sheet.isObject() || !duration.isIntegralNumber()
				|| !duration.canConvertToInt() || duration.asInt() < 1 || duration.asInt() > 1_800_000) {
			log.warn("musicxml convert response violates contract");
			throw new BusinessException(MusicXmlErrorCode.UNAVAILABLE);
		}
		return new Converted(chart, sheet, duration.asInt());
	}

	/** AI 오류 본문의 {@code message}(한 줄, 200자 이하)만 detail로 넘긴다. 없거나 길면 null. */
	private String message(byte[] data) {
		try {
			var message = json.readTree(data).path("message");
			if (!message.isString()) return null;
			String text = message.asString().strip();
			return text.isEmpty() || text.length() > DETAIL_LIMIT || text.indexOf('\n') >= 0 ? null : text;
		} catch (RuntimeException ex) {
			return null;
		}
	}

	/** 응답 본문을 5 MiB까지만 받는다. 넘으면 구독을 끊어 {@code IOException}으로 끝난다. */
	private static final class LimitedBody implements HttpResponse.BodySubscriber<byte[]> {
		private final HttpResponse.BodySubscriber<byte[]> delegate = HttpResponse.BodySubscribers.ofByteArray();
		private Flow.Subscription subscription;
		private long size;
		/** 상한을 넘겨 끊은 뒤에는 취소가 전파되기 전에 더 오는 조각·완료 신호를 무시한다 */
		private boolean done;

		public CompletionStage<byte[]> getBody() { return delegate.getBody(); }
		public void onSubscribe(Flow.Subscription s) { subscription = s; delegate.onSubscribe(s); }
		public void onNext(List<ByteBuffer> buffers) {
			if (done) return;
			for (var buffer : buffers) size += buffer.remaining();
			if (size > MAX_RESPONSE_BYTES) {
				done = true;
				subscription.cancel();
				delegate.onError(new IOException("응답이 5 MiB를 넘습니다."));
			}
			else delegate.onNext(buffers);
		}
		public void onError(Throwable error) { if (!done) delegate.onError(error); }
		public void onComplete() { if (!done) delegate.onComplete(); }
	}

}
