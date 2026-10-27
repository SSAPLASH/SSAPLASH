package com.ssafy.airdrum.chart.worker;

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

class WorkerStorageWireTest {
    @Test void promotionWritesPlainCheckedBytesAndReadsThemBack() throws Exception {
        var server=HttpServer.create(new InetSocketAddress("127.0.0.1",0),0);
        var received=new AtomicReference<byte[]>();
        var encoding=new AtomicReference<String>();
        var checksum=new AtomicReference<String>();
        var conditional=new AtomicReference<String>();
        server.createContext("/",exchange -> {
            if(exchange.getRequestMethod().equals("PUT")) {
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
        try (var store=new WorkerStorageConfiguration().workerStore(true,endpoint,endpoint,"us-east-1","audio","access","secret",true,
                true,endpoint,endpoint,"us-east-1","backing","access","secret","access","secret","ffprobe",Duration.ofMinutes(10),JsonMapper.builder().build())) {
            var verified=new WorkerStore.Verified(file,content.length,hash,1000);
            store.promote(verified,WorkerStore.Bucket.ACCOMPANIMENT,"accompaniment/test.flac");
            assertThat(received.get()).containsExactly(content);
            assertThat(encoding.get()).isNull();
            assertThat(checksum.get()).isEqualTo(crc32(content));
            assertThat(conditional.get()).isEqualTo("*");
        } finally { server.stop(0); Files.deleteIfExists(file); }
    }
    private static String crc32(byte[] bytes) {
        var crc=new CRC32(); crc.update(bytes);
        return Base64.getEncoder().encodeToString(ByteBuffer.allocate(4).putInt((int)crc.getValue()).array());
    }
}
