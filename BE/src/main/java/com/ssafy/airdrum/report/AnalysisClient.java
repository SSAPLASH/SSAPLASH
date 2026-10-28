package com.ssafy.airdrum.report;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.ByteBuffer;
import java.util.List;
import java.util.concurrent.CompletionStage;
import java.util.concurrent.Flow;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;
import java.time.Duration;
import java.util.Set;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;
import tools.jackson.databind.node.ObjectNode;

@Component
public class AnalysisClient {
    private static final Logger log=LoggerFactory.getLogger(AnalysisClient.class);
    private static final int MAX_BODY=5*1024*1024;
    // 본문 전체 제한시간과 응답 크기 상한을 동시에 적용한다.
    private final HttpClient client=HttpClient.newBuilder().version(HttpClient.Version.HTTP_1_1).connectTimeout(Duration.ofSeconds(1)).build();
    private final URI endpoint;
    private final JsonMapper json;
    public record Result(boolean success, boolean retryable, String version, String segments) {}
    public AnalysisClient(@Value("${AI_ANALYSIS_BASE_URL:http://ai-api:8000}") String base, JsonMapper json) {
        this.endpoint=URI.create(base.replaceAll("/+$", "")+"/analysis/weak-segments"); this.json=json;
    }
    public Result analyze(ObjectNode body) {
        byte[] bytes=json.writeValueAsBytes(body);
        if(bytes.length>MAX_BODY) return fail(false);
        var request=HttpRequest.newBuilder(endpoint).timeout(Duration.ofSeconds(3))
            .header("Content-Type","application/json").POST(HttpRequest.BodyPublishers.ofByteArray(bytes)).build();
        var statusSeen=new java.util.concurrent.atomic.AtomicInteger();
        var pending=client.sendAsync(request, info -> {
            statusSeen.set(info.statusCode());
            return info.statusCode() >= 400 && info.statusCode() != 400
                ? HttpResponse.BodySubscribers.replacing(new byte[0]) : new LimitedBody();
        });
        try {
            var response=pending.get(3,TimeUnit.SECONDS);
            int status=response.statusCode(); byte[] data=response.body();
            if(status>=500 && status<=599) return fail(true);
            if(status>=400 && status<=499) {
                if(status==400) logFields(data);
                return fail(false);
            }
            if(status!=200) return fail(false);
            var root=json.readTree(data);
            if(!valid(root)) return fail(false);
            log.info("weak-segments reason={}",root.path("reason").asString());
            return new Result(true,false,root.path("analyzerVersion").asString(),json.writeValueAsString(root.path("weakSegments")));
        } catch (TimeoutException ex) { pending.cancel(true); log.warn("weak-segments timeout status={}",statusSeen.get()); return fail(retryableStatus(statusSeen.get())); }
          catch (InterruptedException ex) { pending.cancel(true); Thread.currentThread().interrupt(); return fail(retryableStatus(statusSeen.get())); }
          catch (java.util.concurrent.ExecutionException ex) {
              log.warn("weak-segments transport error status={} type={}",statusSeen.get(),ex.getCause().getClass().getSimpleName());
              Throwable cause=ex.getCause();
              while(cause != null) { if(cause instanceof ResponseTooLarge) return fail(false); cause=cause.getCause(); }
              return fail(retryableStatus(statusSeen.get()));
          } catch (RuntimeException ex) { return fail(false); }
    }
    private static final class ResponseTooLarge extends RuntimeException {}
    private static final class LimitedBody implements HttpResponse.BodySubscriber<byte[]> {
        private final HttpResponse.BodySubscriber<byte[]> delegate=HttpResponse.BodySubscribers.ofByteArray();
        private Flow.Subscription subscription;
        private long size;
        public CompletionStage<byte[]> getBody() { return delegate.getBody(); }
        public void onSubscribe(Flow.Subscription s) { subscription=s; delegate.onSubscribe(s); }
        public void onNext(List<ByteBuffer> buffers) {
            for(var buffer:buffers) size+=buffer.remaining();
            if(size>256*1024) { subscription.cancel(); delegate.onError(new ResponseTooLarge()); }
            else delegate.onNext(buffers);
        }
        public void onError(Throwable error) { delegate.onError(error); }
        public void onComplete() { delegate.onComplete(); }
    }

    private void logFields(byte[] data) {
        try {
            var fields=json.readTree(data).path("fields");
            if(!fields.isArray() || fields.size()>20) return;
            var safe=new java.util.ArrayList<String>();
            for(var field:fields) {
                if(!field.isString() || !field.asString().matches("(playId|songId|chartVersionId|difficulty|mode|timingWindows(\\.(perfectMs|goodMs))?|hits(\\.[0-9]+(\\.(seq|tMs|stickId|pad|baselinePad|predictedPad|velocity|peakAccel|judgement|matchedNoteId|deltaMs))?)?)")) return;
                safe.add(field.asString());
            }
            log.warn("weak-segments invalid fields={}",safe);
        } catch (RuntimeException ignored) { /* 오류 본문은 기록하지 않는다. */ }
    }
    private static boolean valid(JsonNode root) {
        if(root==null || !root.isObject() || !root.path("analyzerVersion").isString()) return false;
        String version=root.path("analyzerVersion").asString();
        if(version.isBlank() || version.length()>37 || !version.matches("[A-Za-z0-9._-]+")) return false;
        if(!root.path("reason").isString() || !Set.of("OK","NO_WEAKNESS","INSUFFICIENT_HITS").contains(root.path("reason").asString())) return false;
        JsonNode segments=root.path("weakSegments");
        if(!segments.isArray() || segments.size()>20) return false;
        for(JsonNode segment:segments) {
            if(!segment.isObject() || !segment.path("fromMs").isNumber() || !segment.path("toMs").isNumber()
                || !Double.isFinite(segment.path("fromMs").asDouble()) || !Double.isFinite(segment.path("toMs").asDouble())
                || segment.path("fromMs").asDouble()>segment.path("toMs").asDouble()
                || !segment.path("pattern").isString() || !segment.path("description").isString()
                || !segment.path("causeTags").isArray() || !segment.path("pads").isArray() || !segment.path("metrics").isObject()) return false;
            for(JsonNode tag:segment.path("causeTags")) if(!tag.isString()) return false;
            for(JsonNode pad:segment.path("pads")) if(!pad.isString()) return false;
        }
        return true;
    }
    private static boolean retryableStatus(int status) { return status==0 || status>=200 && status<300 || status>=500 && status<=599; }
    private static Result fail(boolean retryable) { return new Result(false,retryable,null,null); }
}
