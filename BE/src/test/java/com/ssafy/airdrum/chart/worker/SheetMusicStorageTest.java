package com.ssafy.airdrum.chart.worker;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;
import com.sun.net.httpserver.HttpServer;
import java.net.InetSocketAddress;
import java.net.URI;
import java.nio.file.Files;
import java.time.Duration;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.support.StaticListableBeanFactory;
import software.amazon.awssdk.auth.credentials.AwsBasicCredentials;
import software.amazon.awssdk.auth.credentials.StaticCredentialsProvider;
import software.amazon.awssdk.regions.Region;
import software.amazon.awssdk.services.s3.S3Configuration;
import software.amazon.awssdk.services.s3.presigner.S3Presigner;
import tools.jackson.databind.json.JsonMapper;
import com.ssafy.airdrum.chart.asset.ChartAssetKeyPolicy;
import com.ssafy.airdrum.chart.asset.ChartStorageProperties;
import com.ssafy.airdrum.common.error.BusinessException;

/** 155번 설계 2·3절: 악보 키 규칙, 악보 버킷 조건부 PUT(파일 스트리밍), 1시간 서명. */
class SheetMusicStorageTest {
    static final String UUID="0f8fad5b-d9cb-469f-a165-70867728950e";

    @Test void keyPolicyAcceptsOnlyOwnerSheetUuidKeys() {
        var keys=new ChartAssetKeyPolicy();
        for(String ext:new String[]{"jpg","png","webp","pdf"}) assertThatCode(()->keys.sheetMusic(7,9,"sheet-music/7/9/"+UUID+"."+ext)).doesNotThrowAnyException();
        for(String bad:new String[]{"sheet-music/8/9/"+UUID+".png","sheet-music/7/10/"+UUID+".png","sheet-music/7/9/"+UUID+".gif",
                "sheet-music/7/9/name.png","sheet/7/"+UUID+".png","cover/7/9/"+UUID+".png","sheet-music/7/9/../"+UUID+".png",null})
            assertThatThrownBy(()->keys.sheetMusic(7,9,bad)).as(String.valueOf(bad)).isInstanceOf(IllegalStateException.class);
    }

    @Test void sheetMusicStreamsFileToSheetBucketWithConditionalPut() throws Exception {
        var server=HttpServer.create(new InetSocketAddress("127.0.0.1",0),0);
        var bytes=new AtomicReference<byte[]>(); var path=new AtomicReference<String>();
        var type=new AtomicReference<String>(); var conditional=new AtomicReference<String>();
        server.createContext("/",exchange->{ bytes.set(exchange.getRequestBody().readAllBytes()); path.set(exchange.getRequestURI().getPath());
            type.set(exchange.getRequestHeaders().getFirst("Content-Type")); conditional.set(exchange.getRequestHeaders().getFirst("If-None-Match"));
            exchange.sendResponseHeaders(200,-1); exchange.close(); });
        server.start(); String endpoint="http://127.0.0.1:"+server.getAddress().getPort();
        var file=Files.createTempFile("sheet-",".pdf"); byte[] content="%PDF-1.4 test %%EOF".getBytes();
        Files.write(file,content);
        try(var store=new WorkerStorageConfiguration().workerStore(false,"","","","","","",false,
                true,endpoint,endpoint,"us-east-1","backing","sheet","read","read-secret","write","write-secret","ffprobe",Duration.ofMinutes(10),JsonMapper.builder().build())) {
            new SheetStorageAdapter(store,new StaticListableBeanFactory().getBeanProvider(S3Presigner.class),properties())
                    .put("sheet-music/7/9/"+UUID+".pdf",file,content.length,"application/pdf");
            assertThat(path.get()).isEqualTo("/sheet/sheet-music/7/9/"+UUID+".pdf");
            assertThat(bytes.get()).containsExactly(content);
            assertThat(type.get()).isEqualTo("application/pdf");
            assertThat(conditional.get()).isEqualTo("*");
        } finally { server.stop(0); Files.deleteIfExists(file); }
    }

    @Test void putFailsAsUnavailableWhenWriterMissingOrServerRejects() throws Exception {
        var file=Files.createTempFile("sheet-",".png"); Files.write(file,new byte[]{1});
        var store=mock(S3WorkerStore.class);
        doThrow(new BusinessException(WorkerError.UNAVAILABLE)).when(store).putSheetMusic(anyString(),any(),anyLong(),anyString());
        try {
            var adapter=new SheetStorageAdapter(store,new StaticListableBeanFactory().getBeanProvider(S3Presigner.class),properties());
            assertThatThrownBy(()->adapter.put("sheet-music/7/9/"+UUID+".png",file,1,"image/png"))
                    .isInstanceOfSatisfying(BusinessException.class,e->assertThat(e.getErrorCode().code()).isEqualTo("SHEET_UNAVAILABLE"));
        } finally { Files.deleteIfExists(file); }
    }

    @Test void signUsesOneHourInlineWithoutStorageCalls() {
        var signer=S3Presigner.builder().endpointOverride(URI.create("https://objects.example"))
                .region(Region.US_EAST_1).credentialsProvider(StaticCredentialsProvider.create(AwsBasicCredentials.create("test-access","test-secret")))
                .serviceConfiguration(S3Configuration.builder().pathStyleAccessEnabled(true).build()).build();
        var store=mock(S3WorkerStore.class);
        try {
            var beans=new StaticListableBeanFactory(); beans.addBean("signer",signer);
            var signed=new SheetStorageAdapter(store,beans.getBeanProvider(S3Presigner.class),properties()).sign("sheet-music/7/9/"+UUID+".pdf");
            assertThat(signed).contains("/sheet/sheet-music/7/9/").contains("X-Amz-Expires=3600").contains("response-content-disposition=inline");
            verifyNoInteractions(store);
        } finally { signer.close(); }
        var disabled=new ChartStorageProperties(false,URI.create("http://localhost"),URI.create("https://objects.example"),"us-east-1","sheet","backing","access","secret",Duration.ofMinutes(10));
        assertThatThrownBy(()->new SheetStorageAdapter(store,new StaticListableBeanFactory().getBeanProvider(S3Presigner.class),disabled).sign("k"))
                .isInstanceOfSatisfying(BusinessException.class,e->assertThat(e.getErrorCode().code()).isEqualTo("SHEET_UNAVAILABLE"));
    }

    private static ChartStorageProperties properties() {
        return new ChartStorageProperties(true,URI.create("http://localhost"),URI.create("https://objects.example"),"us-east-1","sheet","backing","access","secret",Duration.ofMinutes(10));
    }
}
