package com.ssafy.airdrum.domain.report.client.analysis;

import org.junit.jupiter.api.Test;
import tools.jackson.databind.json.JsonMapper;
import static org.assertj.core.api.Assertions.*;

/**
 * AI 약점 분석 응답의 루트 summary(종합 총평): 올바르면 알려진 필드만 저장하고, 틀리면 총평만 버린다
 * (분석 자체는 성공으로 둔다). 네트워크 없이 파싱만 본다.
 */
class CoachSummaryClientTest {
    private final JsonMapper json = JsonMapper.builder().build();
    private final AnalysisClient client = new AnalysisClient("http://127.0.0.1:1", json);

    private String summaryOf(String summaryJson) {
        String root = "{\"analyzerVersion\":\"weak-rules-0.3\",\"reason\":\"OK\",\"weakSegments\":[]"
            + (summaryJson == null ? "" : ",\"summary\":" + summaryJson) + "}";
        return client.summary(json.readTree(root));
    }

    @Test void validSummaryIsKeptWithKnownFieldsOnly() throws Exception {
        var summary = json.readTree(summaryOf("""
            {"level":"GOOD","text":"정말 잘 쳤어요.","focusPattern":"MISS_CLUSTER","strengthPad":"HIHAT","source":"RULE","extra":"버려진다"}
            """));
        assertThat(summary.path("level").asString()).isEqualTo("GOOD");
        assertThat(summary.path("text").asString()).isEqualTo("정말 잘 쳤어요.");
        assertThat(summary.path("focusPattern").asString()).isEqualTo("MISS_CLUSTER");
        assertThat(summary.path("strengthPad").asString()).isEqualTo("HIHAT");
        assertThat(summary.path("source").asString()).isEqualTo("RULE");
        assertThat(summary.has("extra")).isFalse();
    }

    @Test void optionalFieldsMayBeMissingAndSourceDefaultsToRule() throws Exception {
        var summary = json.readTree(summaryOf("{\"level\":\"FAIR\",\"text\":\"눈에 띄는 약점은 없었어요.\"}"));
        assertThat(summary.has("focusPattern")).isFalse();
        assertThat(summary.has("strengthPad")).isFalse();
        assertThat(summary.path("source").asString()).isEqualTo("RULE");
    }

    @Test void nullOptionalFieldsAreAccepted() throws Exception {
        var summary = json.readTree(summaryOf("{\"level\":\"FAIR\",\"text\":\"문장이에요.\",\"focusPattern\":null}"));
        assertThat(summary.has("focusPattern")).isFalse();
    }

    @Test void missingSummaryMeansNoSummary() {
        assertThat(summaryOf(null)).isNull();
    }

    @Test void invalidSummaryIsDropped() {
        for (String bad : new String[] {
            "{\"level\":\"EXCELLENT\",\"text\":\"등급이 틀려요.\"}",
            "{\"level\":\"FAIR\",\"text\":\"\"}",
            "{\"level\":\"FAIR\",\"text\":\"   \"}",
            "{\"level\":\"FAIR\",\"text\":\"" + "가".repeat(501) + "\"}",
            "{\"level\":\"FAIR\",\"text\":\"줄\\n바꿈\"}",
            "{\"level\":\"FAIR\",\"text\":\"문장이에요.\",\"focusPattern\":\"miss cluster\"}",
            "{\"level\":\"FAIR\",\"text\":\"문장이에요.\",\"strengthPad\":3}",
            "{\"level\":\"FAIR\",\"text\":\"문장이에요.\",\"source\":\"HUMAN\"}",
            "{\"level\":\"FAIR\"}",
            "{\"text\":\"등급이 없어요.\"}",
            "\"문자열\"",
            "[]",
        }) {
            assertThat(summaryOf(bad)).as(bad).isNull();
        }
    }

    @Test void textOfExactlyTheLimitIsAccepted() {
        assertThat(summaryOf("{\"level\":\"FAIR\",\"text\":\"" + "가".repeat(500) + "\"}")).isNotNull();
    }

    @Test void llmSourceIsAccepted() throws Exception {
        var summary = json.readTree(summaryOf("{\"level\":\"FAIR\",\"text\":\"문장이에요.\",\"source\":\"LLM\"}"));
        assertThat(summary.path("source").asString()).isEqualTo("LLM");
    }

    @Test void legacyResultConstructorStillWorks() {
        var result = new AnalysisClient.Result(true, false, "v", "[]");
        assertThat(result.summary()).isNull();
        assertThat(result.success()).isTrue();
    }
}
