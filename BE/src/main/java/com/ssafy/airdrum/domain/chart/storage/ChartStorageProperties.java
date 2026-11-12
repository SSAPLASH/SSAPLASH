package com.ssafy.airdrum.domain.chart.storage;

import java.net.URI;
import java.time.Duration;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.boot.context.properties.bind.DefaultValue;

/** 40번 실제 구성에 맞춰 환경변수로 지정한다. 키는 저장소에 보관하지 않는다. */
@ConfigurationProperties("chart.assets")
public record ChartStorageProperties(@DefaultValue("false") boolean enabled, URI endpoint, URI publicEndpoint,
		@DefaultValue("us-east-1") String region, String sheetBucket, String accompanimentBucket,
		String accessKey, String secretKey, @DefaultValue("10m") Duration urlTtl) {
	@Override
	public String toString() { return "ChartStorageProperties[enabled=" + enabled + "]"; }
}
