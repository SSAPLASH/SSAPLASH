package com.ssafy.airdrum.chart.worker;

import static org.assertj.core.api.Assertions.*;
import java.io.ByteArrayInputStream;
import java.nio.charset.StandardCharsets;
import org.junit.jupiter.api.Test;

class WorkerPayloadTest {
    private final WorkerPayload payload=new WorkerPayload();
    private String hash(String json) {
        return payload.hash(payload.read(new ByteArrayInputStream(json.getBytes(StandardCharsets.UTF_8))).path("result"));
    }
    @Test void canonicalHashPreservesDecimalPrecisionAndNormalizesEquivalentNumbers() {
        assertThat(hash("{\"result\":{\"value\":0.1234567890123456789012345678}}"))
                .isNotEqualTo(hash("{\"result\":{\"value\":0.1234567890123456789012345679}}"));
        assertThat(hash("{\"result\":{\"b\":[true,null],\"a\":1.00}}"))
                .isEqualTo(hash("{\"result\":{\"a\":1,\"b\":[true,null]}}"));
    }
    @Test void crossLanguageUnicodeAndDecimalVector() {
        assertThat(hash("{\"result\":{\"😀\":-0.00,\"\\uE000\":1.2300,\"제어\":\"x\\u001f\\n\",\"prec\":0.12345678901234567890123456789012345}}"))
                .isEqualTo("a6385d023ac91b8d496887d40c7f840cf7790eb20ddc16ae866e0a080c541921");
    }
    @Test void duplicateKeysAndTrailingObjectsAreRejected() {
        assertThatThrownBy(()->hash("{\"result\":{\"a\":1,\"a\":2}}"))
                .isInstanceOf(com.ssafy.airdrum.common.error.BusinessException.class);
        assertThatThrownBy(()->hash("{\"result\":{}} {}"))
                .isInstanceOf(com.ssafy.airdrum.common.error.BusinessException.class);
    }

    @Test void assetKeysPreserveLegacyAndBindGeneratedResultToSong() {
        var policy=new com.ssafy.airdrum.chart.asset.ChartAssetKeyPolicy();
        String uuid="123e4567-e89b-12d3-a456-426614174000";
        assertThatCode(()->policy.accompaniment(42,"accompaniment/42.flac")).doesNotThrowAnyException();
        assertThatCode(()->policy.accompaniment(42,"accompaniment/42/"+uuid+"/"+uuid+".flac")).doesNotThrowAnyException();
        assertThatThrownBy(()->policy.accompaniment(43,"accompaniment/42/"+uuid+"/"+uuid+".flac"))
                .isInstanceOf(IllegalStateException.class);
        assertThatThrownBy(()->policy.accompaniment(42,"accompaniment/42/../../other.flac"))
                .isInstanceOf(IllegalStateException.class);
    }
}
