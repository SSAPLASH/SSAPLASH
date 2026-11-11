package com.ssafy.airdrum.domain.chart.storage.worker;

import com.ssafy.airdrum.global.storage.s3.S3StorageResources;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import tools.jackson.databind.json.JsonMapper;

@Configuration(proxyBeanMethods = false)
class WorkerStorageConfiguration {
    @Bean(destroyMethod = "")
    S3WorkerStore workerStore(S3StorageResources resources, @Value("${audio.ffprobe-path:ffprobe}") String ffprobe, JsonMapper json) {
        return new S3WorkerStore(resources, ffprobe, json);
    }
}
