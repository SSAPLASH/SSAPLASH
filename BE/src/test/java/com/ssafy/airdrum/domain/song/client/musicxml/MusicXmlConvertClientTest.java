package com.ssafy.airdrum.domain.song.client.musicxml;

import java.io.IOException;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicReference;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;

import tools.jackson.databind.json.JsonMapper;

import com.ssafy.airdrum.domain.song.exception.MusicXmlErrorCode;
import com.ssafy.airdrum.domain.song.service.musicxml.MusicXmlSniffer;
import com.ssafy.airdrum.global.error.BusinessException;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/** 293 설계 3-3·4-2: ai-api 응답·장애를 BE 오류 코드로 바꾼다. 가짜 서버(JDK HttpServer)로 상태별 분기를 본다. */
class MusicXmlConvertClientTest {

	HttpServer server;
	final JsonMapper json = new JsonMapper();
	final AtomicReference<HttpExchange> seen = new AtomicReference<>();
	final AtomicReference<byte[]> seenBody = new AtomicReference<>();
	volatile int status = 200;
	volatile byte[] response;
	volatile long delayMs = 0;

	static final String CHART = "{\"schemaVersion\":1,\"generator\":\"ADT_MODEL\",\"generatorVersion\":\"sheet-musicxml-3\",\"metrics\":{},"
			+ "\"charts\":[{\"difficulty\":\"NORMAL\",\"notationStatus\":\"UNAVAILABLE\",\"notes\":[{\"noteId\":\"n0001\",\"timeMs\":0,\"pad\":\"KICK\"}],"
			+ "\"timing\":{\"bpm\":120,\"offsetMs\":0,\"timeSignature\":\"4/4\"}}]}";
	static final String OK = "{\"chart\":" + CHART + ",\"sheet\":{\"duration_ms\":4000,\"n_notes\":1,\"generator_version\":\"sheet-musicxml-3\"}}";

	@BeforeEach
	void start() throws IOException {
		server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
		server.createContext("/chart/sheet", exchange -> {
			seen.set(exchange);
			seenBody.set(exchange.getRequestBody().readAllBytes());
			if (delayMs > 0) try { Thread.sleep(delayMs); } catch (InterruptedException ignored) { }
			byte[] body = response;
			exchange.getResponseHeaders().add("Content-Type", "application/json");
			exchange.sendResponseHeaders(status, body.length);
			exchange.getResponseBody().write(body);
			exchange.close();
		});
		server.start();
		response = OK.getBytes(StandardCharsets.UTF_8);
	}

	@AfterEach
	void stop() {
		server.stop(0);
	}

	MusicXmlConvertClient client() {
		return new MusicXmlConvertClient("http://127.0.0.1:" + server.getAddress().getPort() + "/", json, Duration.ofMillis(800));
	}

	@Test
	void 파일_바이트를_그대로_보내고_chart와_곡_길이를_받는다() {
		var result = client().convert("<score-partwise/>".getBytes(StandardCharsets.UTF_8), MusicXmlSniffer.Kind.MXL);
		assertThat(result.chart().path("generatorVersion").asString()).isEqualTo("sheet-musicxml-3");
		assertThat(result.durationMs()).isEqualTo(4000);
		assertThat(result.sheet().path("n_notes").asInt()).isEqualTo(1);
		var request = seen.get();
		assertThat(request.getRequestMethod()).isEqualTo("POST");
		assertThat(request.getRequestURI().toString()).isEqualTo("/chart/sheet?name=score.mxl");
		assertThat(request.getRequestHeaders().getFirst("Content-Type")).isEqualTo("application/octet-stream");
		assertThat(seenBody.get()).isEqualTo("<score-partwise/>".getBytes(StandardCharsets.UTF_8));
	}

	@Test
	void AI_오류_코드를_BE_오류_코드로_바꾼다() {
		byte[] body = "<score-partwise/>".getBytes(StandardCharsets.UTF_8);
		for (var c : List.of(
				Map.of("status", 400, "body", "{\"error\":\"INPUT_INVALID\",\"message\":\"score-timewise 형식은 받지 않음\"}", "code", MusicXmlErrorCode.UNSUPPORTED, "detail", "timewise"),
				Map.of("status", 422, "body", "{\"error\":\"NO_DRUM_NOTES\",\"message\":\"드럼 파트가 없음\"}", "code", MusicXmlErrorCode.NO_DRUM_NOTES, "detail", "드럼"),
				Map.of("status", 413, "body", "{\"error\":\"BODY_TOO_LARGE\"}", "code", MusicXmlErrorCode.TOO_LARGE, "detail", ""),
				Map.of("status", 500, "body", "{\"error\":\"INTERNAL_ERROR\"}", "code", MusicXmlErrorCode.UNAVAILABLE, "detail", ""),
				Map.of("status", 404, "body", "{\"detail\":\"Not Found\"}", "code", MusicXmlErrorCode.UNAVAILABLE, "detail", ""),
				Map.of("status", 200, "body", "not json", "code", MusicXmlErrorCode.UNAVAILABLE, "detail", ""),
				Map.of("status", 200, "body", "{\"chart\":{},\"sheet\":{}}", "code", MusicXmlErrorCode.UNAVAILABLE, "detail", ""),
				Map.of("status", 400, "body", "{\"error\":\"INPUT_INVALID\",\"message\":\"" + "가".repeat(300) + "\"}", "code", MusicXmlErrorCode.UNSUPPORTED, "detail", ""))) {
			status = (int) c.get("status");
			response = ((String) c.get("body")).getBytes(StandardCharsets.UTF_8);
			assertThatThrownBy(() -> client().convert(body, MusicXmlSniffer.Kind.XML)).as(c.toString())
					.isInstanceOfSatisfying(BusinessException.class, ex -> {
						assertThat(ex.getErrorCode()).isEqualTo(c.get("code"));
						String detail = (String) c.get("detail");
						if (!detail.isEmpty()) assertThat(ex.getDetail()).contains(detail);
						else if (ex.getDetail() != null) assertThat(ex.getDetail().length()).isLessThanOrEqualTo(200);
					});
		}
	}

	@Test
	void 연결_실패_시간_초과_응답_크기_초과는_UNAVAILABLE이다() {
		byte[] body = "<score-partwise/>".getBytes(StandardCharsets.UTF_8);
		delayMs = 1500;
		assertThatThrownBy(() -> client().convert(body, MusicXmlSniffer.Kind.XML)).isInstanceOfSatisfying(BusinessException.class,
				ex -> assertThat(ex.getErrorCode()).isEqualTo(MusicXmlErrorCode.UNAVAILABLE));
		delayMs = 0;
		response = ("{\"chart\":" + CHART + ",\"sheet\":{\"duration_ms\":4000,\"pad\":\"" + "x".repeat(5 * 1024 * 1024 + 10) + "\"}}").getBytes(StandardCharsets.UTF_8);
		assertThatThrownBy(() -> client().convert(body, MusicXmlSniffer.Kind.XML)).isInstanceOfSatisfying(BusinessException.class,
				ex -> assertThat(ex.getErrorCode()).isEqualTo(MusicXmlErrorCode.UNAVAILABLE));
		int port = server.getAddress().getPort();
		server.stop(0);
		var closed = new MusicXmlConvertClient("http://127.0.0.1:" + port, json, Duration.ofMillis(800));
		assertThatThrownBy(() -> closed.convert(body, MusicXmlSniffer.Kind.XML)).isInstanceOfSatisfying(BusinessException.class,
				ex -> assertThat(ex.getErrorCode()).isEqualTo(MusicXmlErrorCode.UNAVAILABLE));
	}
}
