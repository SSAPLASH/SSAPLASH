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
