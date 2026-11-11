package com.ssafy.airdrum.domain.song.controller.management;

import jakarta.servlet.http.HttpServletRequest;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.multipart.support.StandardServletMultipartResolver;
import com.ssafy.airdrum.domain.song.dto.CoverRequest;

@Configuration(proxyBeanMethods=false)
public class CoverMultipartConfiguration {
    @Bean(name="multipartResolver")
    StandardServletMultipartResolver multipartResolver() {
        return new StandardServletMultipartResolver() {
            @Override public boolean isMultipart(HttpServletRequest request) {
                if(CoverRequest.matches(request)) return false;
                return super.isMultipart(request);
            }
        };
    }
}
