package com.ssafy.airdrum.domain.song.storage.audio;

import static org.assertj.core.api.Assertions.*;
import com.sun.net.httpserver.HttpServer;
import java.net.InetSocketAddress;
import java.nio.ByteBuffer;
import java.nio.file.Files;
import java.util.Base64;
import java.util.concurrent.atomic.AtomicReference;
import java.util.zip.CRC32;
import org.junit.jupiter.api.Test;

class AudioStorageWireTest {
    @Test void sourceUploadSendsPlainBodyWithDefaultCrc32() throws Exception {
        var server=HttpServer.create(new InetSocketAddress("127.0.0.1",0),0);
        var received=new AtomicReference<byte[]>();
        var encoding=new AtomicReference<String>();
        var checksum=new AtomicReference<String>();
        server.createContext("/",exchange -> {
            received.set(exchange.getRequestBody().readAllBytes());
            encoding.set(exchange.getRequestHeaders().getFirst("Content-Encoding"));
            checksum.set(exchange.getRequestHeaders().getFirst("x-amz-checksum-crc32"));
            exchange.sendResponseHeaders(200,-1); exchange.close();
        });
        server.start();
        var file=Files.createTempFile("audio-wire-",".wav");
        byte[] content=new byte[8044]; for(int i=0;i<content.length;i++) content[i]=(byte)(i*13);
        Files.write(file,content);
        try (var store=new AudioStorageConfiguration().audioStore(true,
                "http://127.0.0.1:"+server.getAddress().getPort(),"us-east-1","audio","access","secret",true)) {
            store.put("source-audio/test",file,content.length,"audio/wav");
            assertThat(received.get()).containsExactly(content);
            assertThat(encoding.get()).isNull();
            assertThat(checksum.get()).isEqualTo(crc32(content));
        } finally { server.stop(0); Files.deleteIfExists(file); }
    }
    private static String crc32(byte[] bytes) {
        var crc=new CRC32(); crc.update(bytes);
        return Base64.getEncoder().encodeToString(ByteBuffer.allocate(4).putInt((int)crc.getValue()).array());
    }
}
