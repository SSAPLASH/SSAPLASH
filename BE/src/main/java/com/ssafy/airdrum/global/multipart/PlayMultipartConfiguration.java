package com.ssafy.airdrum.global.multipart;

import java.io.IOException;
import java.nio.file.Path;
import jakarta.servlet.MultipartConfigElement;
import org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/** multipart spool을 프로세스별 디렉터리에 두고 비정상 종료된 파일을 회수한다. */
@Configuration(proxyBeanMethods=false)
@ConditionalOnWebApplication(type=ConditionalOnWebApplication.Type.SERVLET)
class PlayMultipartConfiguration {
    @Bean(destroyMethod="close")
    SpoolDirectory playMultipartSpool() throws IOException { return new SpoolDirectory(Path.of(System.getProperty("java.io.tmpdir"),"airdrum-play-multipart")); }
    @Bean
    MultipartConfigElement multipartConfigElement(SpoolDirectory spool) {
        return new MultipartConfigElement(spool.path().toString(),50L*1024*1024,51L*1024*1024,0);
    }
}
