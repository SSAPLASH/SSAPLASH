package com.ssafy.airdrum.domain.chart.storage.worker;

import com.ssafy.airdrum.global.worker.WorkerError;

import static org.assertj.core.api.Assertions.*;
import com.sun.net.httpserver.HttpServer;
import java.net.InetSocketAddress;
import java.nio.ByteBuffer;
import java.nio.file.Files;
import java.security.MessageDigest;
import java.time.Duration;
import java.util.Base64;
import java.util.HexFormat;
import java.util.concurrent.atomic.AtomicReference;
import java.util.zip.CRC32;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.json.JsonMapper;
import com.ssafy.airdrum.global.storage.s3.S3StorageConfiguration;

class WorkerStorageWireTest {
    @Test void promotionWritesPlainCheckedBytesAndReadsThemBack() throws Exception {
        var server=HttpServer.create(new InetSocketAddress("127.0.0.1",0),0);
        var received=new AtomicReference<byte[]>();
        var encoding=new AtomicReference<String>();
        var checksum=new AtomicReference<String>();
        var conditional=new AtomicReference<String>();
        server.createContext("/",exchange -> {
            if(exchange.getRequestURI().getRawQuery()!=null && exchange.getRequestURI().getRawQuery().startsWith("versioning")) {
                byte[] xml="<VersioningConfiguration xmlns=\"http://s3.amazonaws.com/doc/2006-03-01/\"/>".getBytes(java.nio.charset.StandardCharsets.UTF_8);
                exchange.sendResponseHeaders(200,xml.length);
                exchange.getResponseBody().write(xml);
            } else if(exchange.getRequestMethod().equals("PUT")) {
                received.set(exchange.getRequestBody().readAllBytes());
                encoding.set(exchange.getRequestHeaders().getFirst("Content-Encoding"));
                checksum.set(exchange.getRequestHeaders().getFirst("x-amz-checksum-crc32"));
                conditional.set(exchange.getRequestHeaders().getFirst("If-None-Match"));
                exchange.sendResponseHeaders(200,-1);
            } else {
                byte[] body=received.get();
                exchange.getResponseHeaders().set("Content-Type","audio/flac");
                exchange.sendResponseHeaders(200,body.length);
                exchange.getResponseBody().write(body);
            }
            exchange.close();
        });
        server.start();
        var file=Files.createTempFile("worker-wire-",".flac");
        byte[] content=new byte[8903]; for(int i=0;i<content.length;i++) content[i]=(byte)(i*19);
        Files.write(file,content);
        String hash=HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(content));
        String endpoint="http://127.0.0.1:"+server.getAddress().getPort();
        try (var store=workerStore(true,endpoint,endpoint,"us-east-1","audio","access","secret",true,
                true,endpoint,endpoint,"us-east-1","backing","sheet","access","secret","access","secret","ffprobe",Duration.ofMinutes(10),JsonMapper.builder().build())) {
            var verified=new WorkerStore.Verified(file,content.length,hash,1000);
            store.promote(verified,WorkerStore.Bucket.ACCOMPANIMENT,"accompaniment/test.flac");
            assertThat(received.get()).containsExactly(content);
            assertThat(encoding.get()).isNull();
            assertThat(checksum.get()).isEqualTo(crc32(content));
            assertThat(conditional.get()).isEqualTo("*");
        } finally { server.stop(0); Files.deleteIfExists(file); }
    }
    @Test void accompanimentVersionCheckUsesWriterAndBlocksVersionedOrUnavailableBuckets() throws Exception {
        var server=HttpServer.create(new InetSocketAddress("127.0.0.1",0),0);
        var state=new AtomicReference<String>("");
        var requests=new java.util.ArrayList<String>();
        var writer=new java.util.concurrent.atomic.AtomicBoolean(true);
        server.createContext("/", exchange -> {
            boolean versioning=exchange.getRequestURI().getRawQuery()!=null && exchange.getRequestURI().getRawQuery().startsWith("versioning");
            requests.add(exchange.getRequestMethod()+" "+exchange.getRequestURI().getPath()+(versioning?"?versioning":""));
            if(versioning) {
                String auth=exchange.getRequestHeaders().getFirst("Authorization");
                writer.set(writer.get() && auth!=null && auth.contains("Credential=write/"));
                String current=state.get();
                if(current.equals("403") || current.equals("503")) {
                    byte[] xml="<Error><Code>AccessDenied</Code><Message>denied</Message></Error>".getBytes(java.nio.charset.StandardCharsets.UTF_8);
                    exchange.sendResponseHeaders(Integer.parseInt(current),xml.length);
                    exchange.getResponseBody().write(xml);
                } else {
                    byte[] xml=("<VersioningConfiguration xmlns=\"http://s3.amazonaws.com/doc/2006-03-01/\">"+
                            (current.isEmpty()?"":"<Status>"+current+"</Status>")+"</VersioningConfiguration>").getBytes(java.nio.charset.StandardCharsets.UTF_8);
                    exchange.sendResponseHeaders(200,xml.length);
                    exchange.getResponseBody().write(xml);
                }
            } else exchange.sendResponseHeaders(exchange.getRequestMethod().equals("HEAD")?404:200,-1);
            exchange.close();
        });
        server.start();
        String endpoint="http://127.0.0.1:"+server.getAddress().getPort();
        try (var store=workerStore(false,"","","","","","",false,
                true,endpoint,endpoint,"us-east-1","backing","sheet","read","read-secret","write","write-secret","ffprobe",Duration.ofMinutes(10),JsonMapper.builder().build())) {
            assertThat(store.exists(WorkerStore.Bucket.ACCOMPANIMENT,"accompaniment/test.flac")).isFalse();
            store.delete(WorkerStore.Bucket.ACCOMPANIMENT,"accompaniment/test.flac");
            assertThat(requests).containsExactly("GET /backing?versioning", "HEAD /backing/accompaniment/test.flac",
                    "GET /backing?versioning", "DELETE /backing/accompaniment/test.flac");
            for(String bad : new String[]{"Enabled", "Suspended", "403", "503"}) {
                state.set(bad); requests.clear();
                assertThatThrownBy(() -> store.exists(WorkerStore.Bucket.ACCOMPANIMENT,"accompaniment/test.flac"))
                        .isInstanceOf(com.ssafy.airdrum.global.error.BusinessException.class)
                        .satisfies(e -> assertThat(((com.ssafy.airdrum.global.error.BusinessException)e).getErrorCode()).isEqualTo(WorkerError.UNAVAILABLE));
                assertThatThrownBy(() -> store.delete(WorkerStore.Bucket.ACCOMPANIMENT,"accompaniment/test.flac"))
                        .isInstanceOf(com.ssafy.airdrum.global.error.BusinessException.class);
                var file=new WorkerStore.Verified(java.nio.file.Path.of("not-read.flac"),1,"a".repeat(64),1);
                assertThatThrownBy(() -> store.promote(file,WorkerStore.Bucket.ACCOMPANIMENT,"accompaniment/test.flac"))
                        .isInstanceOf(com.ssafy.airdrum.global.error.BusinessException.class);
                assertThat(requests).containsExactly("GET /backing?versioning", "GET /backing?versioning", "GET /backing?versioning");
            }
            assertThat(writer.get()).isTrue();
        } finally { server.stop(0); }
    }
    @Test void publicAccompanimentUploadChecksVersionBeforeConditionalPut() throws Exception {
        var server=HttpServer.create(new InetSocketAddress("127.0.0.1",0),0);
        var state=new AtomicReference<String>("");
        var requests=java.util.Collections.synchronizedList(new java.util.ArrayList<String>());
        var writer=new java.util.concurrent.atomic.AtomicBoolean(true);
        var content=new AtomicReference<byte[]>();
        var type=new AtomicReference<String>(); var length=new AtomicReference<String>();
        var crc=new AtomicReference<String>(); var conditional=new AtomicReference<String>(); var encoding=new AtomicReference<String>();
        server.createContext("/",exchange -> {
            boolean versioning=exchange.getRequestURI().getRawQuery()!=null && exchange.getRequestURI().getRawQuery().startsWith("versioning");
            requests.add(exchange.getRequestMethod()+" "+exchange.getRequestURI().getPath()+(versioning?"?versioning":""));
            String auth=exchange.getRequestHeaders().getFirst("Authorization");
            writer.set(writer.get() && auth!=null && auth.contains("Credential=write/"));
            if(versioning) {
                String current=state.get();
                if(current.equals("403") || current.equals("503")) {
                    byte[] error="<Error><Code>AccessDenied</Code><Message>denied</Message></Error>".getBytes(java.nio.charset.StandardCharsets.UTF_8);
                    exchange.sendResponseHeaders(Integer.parseInt(current),error.length); exchange.getResponseBody().write(error);
                } else {
                    byte[] xml=("<VersioningConfiguration xmlns=\"http://s3.amazonaws.com/doc/2006-03-01/\">"+
                            (current.isEmpty()?"":"<Status>"+current+"</Status>")+"</VersioningConfiguration>").getBytes(java.nio.charset.StandardCharsets.UTF_8);
                    exchange.sendResponseHeaders(200,xml.length); exchange.getResponseBody().write(xml);
                }
            } else {
                content.set(exchange.getRequestBody().readAllBytes());
                type.set(exchange.getRequestHeaders().getFirst("Content-Type"));
                length.set(exchange.getRequestHeaders().getFirst("Content-Length"));
                crc.set(exchange.getRequestHeaders().getFirst("x-amz-checksum-crc32"));
                conditional.set(exchange.getRequestHeaders().getFirst("If-None-Match"));
                encoding.set(exchange.getRequestHeaders().getFirst("Content-Encoding"));
                exchange.sendResponseHeaders(200,-1);
            }
            exchange.close();
        });
        server.start();
        var file=Files.createTempFile("public-backing-wire-", ".wav");
        byte[] body=new byte[8903]; for(int i=0;i<body.length;i++) body[i]=(byte)(i*19);
        Files.write(file,body);
        String endpoint="http://127.0.0.1:"+server.getAddress().getPort();
        try (var store=workerStore(false,"","","","","","",false,
                true,endpoint,endpoint,"us-east-1","backing","sheet","read","read-secret","write","write-secret","ffprobe",Duration.ofMinutes(10),JsonMapper.builder().build())) {
            store.resources().putAccompaniment("accompaniment/1/test.wav",file,body.length,"audio/wav");
            assertThat(requests).containsExactly("GET /backing?versioning","PUT /backing/accompaniment/1/test.wav");
            assertThat(content.get()).containsExactly(body);
            assertThat(type.get()).isEqualTo("audio/wav"); assertThat(length.get()).isEqualTo(String.valueOf(body.length));
            assertThat(crc.get()).isEqualTo(crc32(body)); assertThat(conditional.get()).isEqualTo("*"); assertThat(encoding.get()).isNull();
            for(String bad:new String[]{"Enabled","Suspended","UnknownFutureState","403","503"}) {
                state.set(bad); requests.clear();
                assertThatThrownBy(() -> store.resources().putAccompaniment("accompaniment/1/test.wav",file,body.length,"audio/wav"))
                        .isInstanceOf(RuntimeException.class);
                assertThat(requests).containsExactly("GET /backing?versioning");
            }
            assertThat(writer.get()).isTrue();
        } finally { server.stop(0); Files.deleteIfExists(file); }
    }
    @Test void sheetDeletionUsesWriterAndFailsWhenUnavailableOrForbidden() throws Exception {
        var server=HttpServer.create(new InetSocketAddress("127.0.0.1",0),0);
        var requests=new java.util.ArrayList<String>();
        var forbidden=new java.util.concurrent.atomic.AtomicBoolean();
        server.createContext("/",exchange -> {
            requests.add(exchange.getRequestMethod()+" "+exchange.getRequestURI().getPath());
            exchange.sendResponseHeaders(forbidden.get()?403:200,-1);
            exchange.close();
        });
        server.start();
        String endpoint="http://127.0.0.1:"+server.getAddress().getPort();
        try (var store=workerStore(false,"","","","","","",false,
                true,endpoint,endpoint,"us-east-1","backing","sheet","read","read-secret","write","write-secret","ffprobe",Duration.ofMinutes(10),JsonMapper.builder().build())) {
            assertThat(store.exists(WorkerStore.Bucket.SHEET,"sheet/12/page.png")).isTrue();
            store.delete(WorkerStore.Bucket.SHEET,"sheet/12/page.png");
            assertThat(requests).containsExactly("HEAD /sheet/sheet/12/page.png","DELETE /sheet/sheet/12/page.png");
            forbidden.set(true);
            assertThatThrownBy(() -> store.delete(WorkerStore.Bucket.SHEET,"sheet/12/page.png")).isInstanceOf(RuntimeException.class);
        } finally { server.stop(0); }
        try (var store=workerStore(false,"","","","","","",false,
                true,endpoint,endpoint,"us-east-1","backing","sheet","read","read-secret","","","ffprobe",Duration.ofMinutes(10),JsonMapper.builder().build())) {
            assertThatThrownBy(() -> store.exists(WorkerStore.Bucket.SHEET,"sheet/12/page.png")).isInstanceOf(RuntimeException.class);
        }
    }
    @Test void coverWritesToSheetWithConditionalAndChecksum() throws Exception {
        var server=HttpServer.create(new InetSocketAddress("127.0.0.1",0),0);
        var bytes=new AtomicReference<byte[]>(); var path=new AtomicReference<String>();
        var type=new AtomicReference<String>(); var crc=new AtomicReference<String>(); var conditional=new AtomicReference<String>(); var encoding=new AtomicReference<String>();
        server.createContext("/",exchange->{ bytes.set(exchange.getRequestBody().readAllBytes()); path.set(exchange.getRequestURI().getPath());
            type.set(exchange.getRequestHeaders().getFirst("Content-Type")); crc.set(exchange.getRequestHeaders().getFirst("x-amz-checksum-crc32"));
            conditional.set(exchange.getRequestHeaders().getFirst("If-None-Match")); encoding.set(exchange.getRequestHeaders().getFirst("Content-Encoding"));
            exchange.sendResponseHeaders(200,-1); exchange.close(); });
        server.start(); String endpoint="http://127.0.0.1:"+server.getAddress().getPort(); byte[] content=new byte[]{1,2,3,4};
        try(var store=workerStore(false,"","","","","","",false,
                true,endpoint,endpoint,"us-east-1","backing","sheet","read","read-secret","write","write-secret","ffprobe",Duration.ofMinutes(10),JsonMapper.builder().build())) {
            store.resources().putCover("cover/1/2/example.png",content,"image/png");
            assertThat(path.get()).isEqualTo("/sheet/cover/1/2/example.png"); assertThat(bytes.get()).containsExactly(content);
            assertThat(type.get()).isEqualTo("image/png"); assertThat(crc.get()).isEqualTo(crc32(content));
            assertThat(conditional.get()).isEqualTo("*"); assertThat(encoding.get()).isNull();
        } finally { server.stop(0); }
    }
    private static S3WorkerStore workerStore(boolean ae,String ep,String pub,String region,String bucket,String access,String secret,boolean priv,
            boolean ce,String cep,String cpub,String cregion,String cbucket,String sheet,String ca,String cs,String wa,String ws,
            String ffprobe,Duration ttl,JsonMapper json) {
        var resources=new S3StorageConfiguration().storage(ae,ep,pub,region,bucket,access,secret,priv,
                ce,cep,cpub,cregion,cbucket,sheet,ca,cs,wa,ws,ttl);
        return new S3WorkerStore(resources,ffprobe,json);
    }
    private static String crc32(byte[] bytes) {
        var crc=new CRC32(); crc.update(bytes);
        return Base64.getEncoder().encodeToString(ByteBuffer.allocate(4).putInt((int)crc.getValue()).array());
    }
}
