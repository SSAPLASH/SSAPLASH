package com.ssafy.airdrum.domain.chart.websocket;

import java.io.IOException;
import java.time.Instant;
import java.util.Map;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.atomic.AtomicBoolean;

import jakarta.annotation.PreDestroy;
import org.springframework.stereotype.Component;
import org.springframework.web.socket.BinaryMessage;
import org.springframework.web.socket.CloseStatus;
import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.PingMessage;
import org.springframework.web.socket.adapter.standard.StandardWebSocketSession;
import org.springframework.web.socket.WebSocketSession;
import org.springframework.web.socket.handler.TextWebSocketHandler;
import org.springframework.web.socket.handler.ConcurrentWebSocketSessionDecorator;
import tools.jackson.databind.json.JsonMapper;
import tools.jackson.databind.DeserializationFeature;
import tools.jackson.core.StreamReadFeature;
import tools.jackson.core.StreamReadConstraints;
import tools.jackson.core.json.JsonFactory;
import com.ssafy.airdrum.domain.chart.dto.job.JobSnapshot;
import com.ssafy.airdrum.domain.chart.service.job.JobQueryService;
import com.ssafy.airdrum.domain.auth.security.AuthenticationService;
import com.ssafy.airdrum.domain.auth.security.AuthenticatedUser;

@Component
public class JobWebSocketHandler extends TextWebSocketHandler {
    private static final CloseStatus INVALID=new CloseStatus(1008,"인증 또는 접근 실패");
    private static final CloseStatus OVERLOAD=new CloseStatus(1013,"연결 한도 초과");
    private static final int MAX_TOTAL=200, MAX_PER_USER=4, MAX_MESSAGE=4096;
    private final Map<String,Connection> connections=new ConcurrentHashMap<>();
    private final AuthenticationService authentication;
    private final JobQueryService jobs;
    private final JsonMapper json;
    private final JsonMapper authJson=JsonMapper.builder(JsonFactory.builder()
            .enable(StreamReadFeature.STRICT_DUPLICATE_DETECTION)
            .streamReadConstraints(StreamReadConstraints.builder().maxNestingDepth(4).maxStringLength(MAX_MESSAGE).build()).build())
            .enable(DeserializationFeature.FAIL_ON_TRAILING_TOKENS).build();
    private final java.util.concurrent.ScheduledThreadPoolExecutor scheduler=new java.util.concurrent.ScheduledThreadPoolExecutor(1);
    private final ThreadPoolExecutor workers=new ThreadPoolExecutor(8,8,0,TimeUnit.SECONDS,new ArrayBlockingQueue<>(MAX_TOTAL),new ThreadPoolExecutor.AbortPolicy());
    private final Object limitLock=new Object();
    private static final class Connection {
        final WebSocketSession socket;
        final long jobId;
        final Instant deadline=Instant.now().plusSeconds(5);
        final AtomicBoolean busy=new AtomicBoolean();
        volatile AuthenticatedUser user;
        volatile ScheduledFuture<?> authTimeout;
        volatile long revision=-1;
        long lastPing=System.nanoTime();
        Connection(WebSocketSession socket,long jobId) { this.socket=socket; this.jobId=jobId; }
    }
    public JobWebSocketHandler(AuthenticationService authentication,JobQueryService jobs,JsonMapper json) {
        this.authentication=authentication; this.jobs=jobs; this.json=json;
        scheduler.setRemoveOnCancelPolicy(true);
        scheduler.scheduleAtFixedRate(this::tick,1,1,TimeUnit.SECONDS);
    }
    @Override public void afterConnectionEstablished(WebSocketSession raw) throws Exception {
        raw.setTextMessageSizeLimit(MAX_MESSAGE); raw.setBinaryMessageSizeLimit(MAX_MESSAGE);
        if(raw instanceof StandardWebSocketSession standard)
            standard.getNativeSession().getUserProperties().put("org.apache.tomcat.websocket.BLOCKING_SEND_TIMEOUT",5000L);
        var socket=new ConcurrentWebSocketSessionDecorator(raw,5000,8192);
        var connection=new Connection(socket,(long)raw.getAttributes().get("jobId"));
        synchronized(limitLock) {
            if(connections.size()>=MAX_TOTAL) { raw.close(OVERLOAD); return; }
            connections.put(raw.getId(),connection);
        }
        connection.authTimeout=scheduler.schedule(()-> { if(connection.user==null) submitClose(connection,INVALID); },5,TimeUnit.SECONDS);
    }
    @Override protected void handleTextMessage(WebSocketSession session,TextMessage message) {
        Connection c=connections.get(session.getId());
        if(c==null) return;
        if(c.user!=null || Instant.now().isAfter(c.deadline)) { close(c,INVALID); return; }
        try {
            if(message.getPayloadLength()>MAX_MESSAGE) { close(c,INVALID); return; }
            var node=authJson.readTree(message.getPayload());
            if(!node.isObject() || node.size()!=2 || !"AUTH".equals(node.path("type").asString()) || !node.path("accessToken").isString()) { close(c,INVALID); return; }
            var user=authentication.authenticate(node.path("accessToken").asString());
            synchronized(limitLock) {
                long count=connections.values().stream().filter(x->x.user!=null && x.user.user().id().equals(user.user().id())).count();
                if(!connections.containsKey(session.getId()) || !c.socket.isOpen() || !Instant.now().isBefore(c.deadline)) { close(c,INVALID); return; }
                if(count>=MAX_PER_USER) { close(c,OVERLOAD); return; }
                c.user=user;
                if(c.authTimeout!=null) c.authTimeout.cancel(false);
            }
            submit(c);
        } catch(Exception ex) { close(c,INVALID); }
    }
    @Override protected void handleBinaryMessage(WebSocketSession session,BinaryMessage message) { var c=connections.get(session.getId()); if(c!=null) close(c,INVALID); }
    private void tick() {
        try {
            for(var c:connections.values()) {
                if(c.user==null) { if(!Instant.now().isBefore(c.deadline)) submitClose(c,INVALID); }
                else submit(c);
            }
        } catch(RuntimeException ignored) { /* 다음 점검에서 다시 확인한다. */ }
    }
    private void submitClose(Connection c,CloseStatus status) {
        if(!c.busy.compareAndSet(false,true)) return;
        try { workers.execute(()->{ try { if(c.user==null) close(c,status); } finally { c.busy.set(false); } }); }
        catch(java.util.concurrent.RejectedExecutionException ex) { c.busy.set(false); }
    }
    private void submit(Connection c) {
        if(!c.busy.compareAndSet(false,true)) return;
        try { workers.execute(()->{ try { publish(c); } finally { c.busy.set(false); } }); }
        catch(java.util.concurrent.RejectedExecutionException ex) { c.busy.set(false); close(c,OVERLOAD); }
    }
    private void publish(Connection c) {
        try {
            var user=c.user;
            if(user==null || !Instant.now().isBefore(user.expiresAt()) || authentication.findActive(user.user().id()).isEmpty()) { close(c,INVALID); return; }
            var snapshot=jobs.visible(user.user().id(),c.jobId);
            if(snapshot.isEmpty() || !Instant.now().isBefore(user.expiresAt())) { close(c,INVALID); return; }
            var value=snapshot.get();
            if(value.revision()>c.revision) {
                c.socket.sendMessage(new TextMessage(json.writeValueAsString(value)));
                c.revision=value.revision();
                if(value.status()==JobSnapshot.Status.DONE || value.status()==JobSnapshot.Status.FAILED) close(c,CloseStatus.NORMAL);
            }
            if(c.socket.isOpen() && System.nanoTime()-c.lastPing>=TimeUnit.SECONDS.toNanos(30)) {
                c.socket.sendMessage(new PingMessage()); c.lastPing=System.nanoTime();
            }
        } catch(Exception ex) { close(c,CloseStatus.SERVER_ERROR); }
    }
    @Override public void afterConnectionClosed(WebSocketSession session,CloseStatus status) {
        var c=connections.remove(session.getId()); if(c!=null && c.authTimeout!=null) c.authTimeout.cancel(false);
    }
    @Override public void handleTransportError(WebSocketSession session,Throwable exception) { var c=connections.get(session.getId()); if(c!=null) close(c,CloseStatus.SERVER_ERROR); }
    private void close(Connection c,CloseStatus status) {
        connections.remove(c.socket.getId(),c);
        if(c.authTimeout!=null) c.authTimeout.cancel(false);
        try { if(c.socket.isOpen()) c.socket.close(status); } catch(IOException | RuntimeException ignored) { }
    }
    @PreDestroy public void shutdown() {
        scheduler.shutdownNow(); workers.shutdownNow();
        connections.values().forEach(c->close(c,CloseStatus.GOING_AWAY));
    }
}
