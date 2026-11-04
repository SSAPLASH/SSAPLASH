package com.ssafy.airdrum.song.midi;

import java.io.ByteArrayOutputStream;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.ByteBuffer;
import java.time.Duration;
import java.util.List;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CompletionStage;
import java.util.concurrent.Flow;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;

/** 본문 수신을 비동기 구독하고 마감 시 소켓을 취소한다. 전체 바이트는 입력 크기로 제한한다. */
final class MidiBoundedDownload implements AutoCloseable {
    private final HttpClient client=HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(3))
            .version(HttpClient.Version.HTTP_1_1).followRedirects(HttpClient.Redirect.NEVER).build();
    byte[] get(URI uri,int expected,long deadline) throws Exception {
        long remaining=deadline-System.nanoTime();
        if (remaining<=0) throw new java.util.concurrent.TimeoutException();
        var subscriber=new AtomicReference<LimitedSubscriber>();
        var cancelled=new java.util.concurrent.atomic.AtomicBoolean();
        var request=HttpRequest.newBuilder(uri).timeout(Duration.ofNanos(remaining)).GET().build();
        var result=client.sendAsync(request,info->{
            var body=new LimitedSubscriber(expected); subscriber.set(body); if (cancelled.get()) body.cancel(); return body;
        });
        try {
            remaining=deadline-System.nanoTime();
            if (remaining<=0) throw new java.util.concurrent.TimeoutException();
            var response=result.get(remaining,TimeUnit.NANOSECONDS);
            if (response.statusCode()==404) throw new IllegalArgumentException("MIDI 원본이 없습니다.");
            if (response.statusCode()!=200) throw new IllegalStateException("MIDI 원본 읽기 실패");
            if (response.headers().firstValueAsLong("Content-Length").orElse(-1)!=expected)
                throw new IllegalArgumentException("MIDI 원본 크기가 일치하지 않습니다.");
            return response.body();
        } finally {
            cancelled.set(true);
            if (!result.isDone()) result.cancel(true);
            var body=subscriber.get(); if (body!=null) body.cancel();
        }
    }
    private static final class LimitedSubscriber implements HttpResponse.BodySubscriber<byte[]> {
        private final int expected; private final ByteArrayOutputStream bytes=new ByteArrayOutputStream();
        private final CompletableFuture<byte[]> body=new CompletableFuture<>();
        private Flow.Subscription subscription;
        private boolean cancelled;
        LimitedSubscriber(int expected) { this.expected=expected; }
        public CompletionStage<byte[]> getBody() { return body; }
        public synchronized void onSubscribe(Flow.Subscription next) { subscription=next; if (cancelled || body.isDone()) next.cancel(); else next.request(1); }
        public synchronized void onNext(List<ByteBuffer> buffers) {
            if (body.isDone()) return;
            for (var buffer:buffers) {
                int count=buffer.remaining();
                if (count>expected-bytes.size()) { cancel(); body.completeExceptionally(new IllegalArgumentException("MIDI 원본 크기 초과")); return; }
                byte[] chunk=new byte[count]; buffer.get(chunk); bytes.writeBytes(chunk);
            }
            subscription.request(1);
        }
        public synchronized void onError(Throwable error) { body.completeExceptionally(error); }
        public synchronized void onComplete() { body.complete(bytes.toByteArray()); }
        synchronized void cancel() { cancelled=true; if (subscription!=null) subscription.cancel(); }
    }
    public void close() { client.shutdownNow(); }
}
