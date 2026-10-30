package com.ssafy.airdrum.song;

import jakarta.servlet.http.HttpServletRequest;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.multipart.support.StandardServletMultipartResolver;

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
