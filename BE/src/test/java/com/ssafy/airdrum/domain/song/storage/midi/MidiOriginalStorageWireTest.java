package com.ssafy.airdrum.domain.song.storage.midi;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import com.sun.net.httpserver.HttpServer;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.Test;
import com.ssafy.airdrum.global.error.BusinessException;

class MidiOriginalStorageWireTest {
    @Test void acceptedUploadComparesStoredBytesAndDoesNotTrustMetadataAlone() throws Exception {
        var server=HttpServer.create(new InetSocketAddress("127.0.0.1",0),0);
        var executor=Executors.newCachedThreadPool(); server.setExecutor(executor);
        AtomicReference<byte[]> stored=new AtomicReference<>(); AtomicReference<String> hash=new AtomicReference<>();
        AtomicBoolean corrupt=new AtomicBoolean();
        server.createContext("/",exchange->{
            try {
                var method=exchange.getRequestMethod();
                if (method.equals("GET") && exchange.getRequestURI().getRawQuery()!=null
                        && exchange.getRequestURI().getRawQuery().contains("versioning")) {
                    byte[] xml="<VersioningConfiguration xmlns=\"http://s3.amazonaws.com/doc/2006-03-01/\"/>".getBytes(StandardCharsets.UTF_8);
                    exchange.sendResponseHeaders(200,xml.length); exchange.getResponseBody().write(xml);
                } else if (method.equals("PUT")) {
                    stored.set(exchange.getRequestBody().readAllBytes()); hash.set(exchange.getRequestHeaders().getFirst("x-amz-meta-sha256"));
                    exchange.sendResponseHeaders(200,-1);
                } else if (method.equals("HEAD")) {
                    exchange.getResponseHeaders().add("Content-Length",Integer.toString(stored.get().length));
                    exchange.getResponseHeaders().add("x-amz-meta-sha256",hash.get()); exchange.sendResponseHeaders(200,-1);
                } else {
                    byte[] body=stored.get().clone(); if (corrupt.get()) body[0]^=1;
                    exchange.sendResponseHeaders(200,body.length); exchange.getResponseBody().write(body);
                }
            } catch (Exception ignored) {} finally { exchange.close(); }
        });
        server.start();
        try (var store=new MidiOriginalStorageConfiguration().midiOriginalStore(true,"http://127.0.0.1:"+server.getAddress().getPort(),
                "us-east-1","midi-test","access","secret",true)) {
            byte[] bytes={1,2,3}; String sha=MidiOriginalStorageConfiguration.MidiS3Store.hash(bytes);
            store.putAndVerify("valid.mid",bytes,sha);
            corrupt.set(true);
            assertThatThrownBy(()->store.putAndVerify("corrupt.mid",bytes,sha)).isInstanceOf(BusinessException.class);
        } finally { server.stop(0); executor.shutdownNow(); }
    }
    @Test void versionedBucketsAreNeverTreatedAsAbsent() throws Exception {
        var server=HttpServer.create(new InetSocketAddress("127.0.0.1",0),0);
        var executor=Executors.newCachedThreadPool(); server.setExecutor(executor);
        AtomicBoolean head=new AtomicBoolean();
        server.createContext("/",exchange->{
            try {
                if (exchange.getRequestURI().getRawQuery()!=null) {
                    byte[] xml="<VersioningConfiguration xmlns=\"http://s3.amazonaws.com/doc/2006-03-01/\"><Status>Enabled</Status></VersioningConfiguration>".getBytes(StandardCharsets.UTF_8);
                    exchange.sendResponseHeaders(200,xml.length); exchange.getResponseBody().write(xml);
                } else { head.set(true); exchange.sendResponseHeaders(404,-1); }
            } catch (Exception ignored) {} finally { exchange.close(); }
        });
        server.start(); String endpoint="http://127.0.0.1:"+server.getAddress().getPort();
        try (var original=new MidiOriginalStorageConfiguration().midiOriginalStore(true,endpoint,"us-east-1","original","access","secret",true);
             var backing=new MidiBackingStorageConfiguration().midiBackingStore(true,endpoint,"us-east-1","backing","access","secret")) {
            assertThatThrownBy(()->original.exists("missing.mid")).isInstanceOf(BusinessException.class);
            assertThatThrownBy(()->backing.exists("missing.flac")).isInstanceOf(RuntimeException.class);
            assertThat(head).isFalse();
        } finally { server.stop(0); executor.shutdownNow(); }
    }
    @Test void streamingGetStopsAtAttemptDeadlineEvenWhileBytesKeepArriving() throws Exception {
        var server=HttpServer.create(new InetSocketAddress("127.0.0.1",0),0);
        var executor=Executors.newCachedThreadPool(); server.setExecutor(executor);
        server.createContext("/",exchange->{
            try {
                exchange.sendResponseHeaders(200,8);
                for (int i=0;i<8;i++) { exchange.getResponseBody().write(i); exchange.getResponseBody().flush(); Thread.sleep(300); }
            } catch (Exception ignored) {} finally { exchange.close(); }
        });
        server.start();
        try (var store=new MidiOriginalStorageConfiguration().midiOriginalStore(true,"http://127.0.0.1:"+server.getAddress().getPort(),
                "us-east-1","midi-test","access","secret",true)) {
            long start=System.nanoTime(),deadline=start+TimeUnit.MILLISECONDS.toNanos(700);
            assertThatThrownBy(()->store.get("test.mid",8,"a".repeat(64),deadline)).isInstanceOf(BusinessException.class);
            assertThat(TimeUnit.NANOSECONDS.toMillis(System.nanoTime()-start)).isLessThan(2000);
        } finally { server.stop(0); executor.shutdownNow(); }
    }
    @Test void putAndHeadShareFiveSecondDeadline() throws Exception {
        var server=HttpServer.create(new InetSocketAddress("127.0.0.1",0),0);
        var executor=Executors.newCachedThreadPool(); server.setExecutor(executor);
        AtomicBoolean head=new AtomicBoolean();
        server.createContext("/",exchange->{
            try {
                if (exchange.getRequestMethod().equals("GET")) {
                    byte[] body="<VersioningConfiguration xmlns=\"http://s3.amazonaws.com/doc/2006-03-01/\"/>".getBytes(StandardCharsets.UTF_8);
                    exchange.sendResponseHeaders(200,body.length); exchange.getResponseBody().write(body);
                } else if (exchange.getRequestMethod().equals("PUT")) {
                    exchange.getRequestBody().readAllBytes(); Thread.sleep(3000); exchange.sendResponseHeaders(200,-1);
                } else if (exchange.getRequestMethod().equals("HEAD")) {
                    head.set(true); Thread.sleep(3000); exchange.sendResponseHeaders(200,-1);
                } else exchange.sendResponseHeaders(404,-1);
            } catch (Exception ignored) {} finally { exchange.close(); }
        });
        server.start();
        try (var store=new MidiOriginalStorageConfiguration().midiOriginalStore(true,"http://127.0.0.1:"+server.getAddress().getPort(),
                "us-east-1","midi-test","access","secret",true)) {
            long start=System.nanoTime();
            assertThatThrownBy(()->store.putAndVerify("test.mid",new byte[]{1,2,3},"a".repeat(64))).isInstanceOf(BusinessException.class);
            long elapsed=TimeUnit.NANOSECONDS.toMillis(System.nanoTime()-start);
            assertThat(head).isTrue();
            assertThat(elapsed).isBetween(4000L,7000L);
        } finally { server.stop(0); executor.shutdownNow(); }
    }
}
