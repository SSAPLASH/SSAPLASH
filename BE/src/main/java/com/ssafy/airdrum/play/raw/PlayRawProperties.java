package com.ssafy.airdrum.play.raw;

import java.net.URI;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.boot.context.properties.bind.DefaultValue;

@ConfigurationProperties("play.raw")
public record PlayRawProperties(@DefaultValue("false") boolean enabled, URI endpoint,
		@DefaultValue("us-east-1") String region, String bucket, String accessKey, String secretKey,
		@DefaultValue("false") boolean privateBucketConfirmed,
		@DefaultValue("2") int concurrentUploads) {}
