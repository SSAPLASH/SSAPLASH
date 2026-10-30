package com.ssafy.airdrum.chart.job;

import java.util.Map;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.HttpStatus;
import org.springframework.http.server.ServerHttpRequest;
import org.springframework.http.server.ServerHttpResponse;
import org.springframework.web.socket.WebSocketHandler;
import org.springframework.web.socket.config.annotation.EnableWebSocket;
import org.springframework.web.socket.config.annotation.WebSocketConfigurer;
import org.springframework.web.socket.config.annotation.WebSocketHandlerRegistry;
import org.springframework.web.socket.server.HandshakeInterceptor;

@Configuration(proxyBeanMethods=false)
@EnableWebSocket
public class JobWebSocketConfiguration implements WebSocketConfigurer {
    private final JobWebSocketHandler handler;
    private final String[] origins;
    public JobWebSocketConfiguration(JobWebSocketHandler handler,
            @Value("${chart.jobs.websocket.allowed-origins:http://localhost:5173,http://127.0.0.1:5173}") String origins) {
        this.handler=handler;
        this.origins=java.util.Arrays.stream(origins.split(",")).map(String::strip).filter(s->!s.isBlank()).toArray(String[]::new);
        if (this.origins.length==0 || java.util.Arrays.stream(this.origins).anyMatch(s->s.contains("*")))
            throw new IllegalArgumentException("채보 작업 WebSocket Origin을 명시해야 합니다.");
    }
    @Override public void registerWebSocketHandlers(WebSocketHandlerRegistry registry) {
        registry.addHandler(handler,"/ws/jobs/*").setAllowedOrigins(origins).addInterceptors(new HandshakeInterceptor() {
            @Override public boolean beforeHandshake(ServerHttpRequest request,ServerHttpResponse response,WebSocketHandler ws,Map<String,Object> attributes) {
                String origin=request.getHeaders().getOrigin();
                if(origin==null || java.util.Arrays.stream(origins).noneMatch(origin::equals)) { response.setStatusCode(HttpStatus.FORBIDDEN); return false; }
                String path=request.getURI().getPath();
                String id=path.substring(path.lastIndexOf('/')+1);
                if(request.getURI().getRawQuery()!=null || !id.matches("[1-9][0-9]{0,18}")) { response.setStatusCode(HttpStatus.BAD_REQUEST); return false; }
                try { attributes.put("jobId",Long.parseLong(id)); return true; }
                catch(NumberFormatException ex) { response.setStatusCode(HttpStatus.BAD_REQUEST); return false; }
            }
            @Override public void afterHandshake(ServerHttpRequest request,ServerHttpResponse response,WebSocketHandler ws,Exception ex) {}
        });
    }
}
