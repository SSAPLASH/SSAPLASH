package com.ssafy.airdrum.global.worker;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;

import com.ssafy.airdrum.global.error.CommonErrorCode;
import com.ssafy.airdrum.global.error.ErrorResponseWriter;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.annotation.Order;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configurers.AbstractHttpConfigurer;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.authentication.UsernamePasswordAuthenticationFilter;
import org.springframework.web.filter.OncePerRequestFilter;

@Configuration(proxyBeanMethods = false)
@ConditionalOnWebApplication(type = ConditionalOnWebApplication.Type.SERVLET)
class WorkerSecurityConfiguration {
    @Bean
    @Order(1)
    SecurityFilterChain workerSecurity(HttpSecurity http,
            @Value("${chart.worker.credentials:}") String credentials, ErrorResponseWriter writer) throws Exception {
        http.securityMatcher("/internal/**")
            .csrf(AbstractHttpConfigurer::disable)
            .formLogin(AbstractHttpConfigurer::disable)
            .httpBasic(AbstractHttpConfigurer::disable)
            .logout(AbstractHttpConfigurer::disable)
            .requestCache(AbstractHttpConfigurer::disable)
            .sessionManagement(s -> s.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
            .authorizeHttpRequests(a -> a.anyRequest().permitAll())
            .addFilterBefore(new WorkerTokenFilter(credentials, writer), UsernamePasswordAuthenticationFilter.class);
        return http.build();
    }

    private static final class WorkerTokenFilter extends OncePerRequestFilter {
        private final java.util.Map<String, byte[]> credentials;
        private final ErrorResponseWriter writer;
        WorkerTokenFilter(String configured, ErrorResponseWriter writer) {
            this.writer = writer;
            var values = new java.util.LinkedHashMap<String, byte[]>();
            if (!configured.isBlank()) for (String entry : configured.split(",")) {
                int delimiter = entry.indexOf('=');
                if (delimiter <= 0) throw new IllegalStateException("워커 인증 설정을 확인하세요.");
                String id = entry.substring(0, delimiter);
                byte[] token = entry.substring(delimiter + 1).getBytes(StandardCharsets.UTF_8);
                if (!id.matches("[A-Za-z0-9_-]{1,128}") || token.length < 32 || values.putIfAbsent(id, token) != null)
                    throw new IllegalStateException("워커 인증 설정을 확인하세요.");
                for (var previous : values.entrySet())
                    if (!previous.getKey().equals(id) && MessageDigest.isEqual(previous.getValue(), token))
                        throw new IllegalStateException("워커 인증 설정을 확인하세요.");
            }
            this.credentials = java.util.Map.copyOf(values);
        }
        @Override
        protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response,
                FilterChain chain) throws ServletException, IOException {
            String authorization = request.getHeader("Authorization");
            String workerId = null;
            byte[] provided = authorization != null && authorization.startsWith("Bearer ")
                    ? authorization.substring(7).getBytes(StandardCharsets.UTF_8) : new byte[0];
            for (var entry : credentials.entrySet())
                if (MessageDigest.isEqual(entry.getValue(), provided)) workerId = entry.getKey();
            if (workerId == null) {
                response.setHeader("WWW-Authenticate", "Bearer");
                writer.write(response, CommonErrorCode.UNAUTHORIZED, "인증이 필요합니다.", request.getRequestURI());
                return;
            }
            request.setAttribute(WorkerIdentity.ATTRIBUTE, workerId);
            chain.doFilter(request, response);
        }
    }
}
