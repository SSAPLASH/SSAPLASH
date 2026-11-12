package com.ssafy.airdrum.domain.song.storage;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;
import java.net.URI;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.support.StaticListableBeanFactory;
import software.amazon.awssdk.auth.credentials.AwsBasicCredentials;
import software.amazon.awssdk.auth.credentials.StaticCredentialsProvider;
import software.amazon.awssdk.regions.Region;
import software.amazon.awssdk.services.s3.S3Configuration;
import software.amazon.awssdk.services.s3.presigner.S3Presigner;
import com.ssafy.airdrum.global.storage.s3.S3InlineSigner;
import com.ssafy.airdrum.global.storage.s3.S3StorageResources;
import com.ssafy.airdrum.global.error.BusinessException;

class CoverStorageAdapterTest {
    @Test void coverPresignUsesOneHourWithoutHeadRequest() {
        var signer=S3Presigner.builder().endpointOverride(URI.create("https://objects.example"))
            .region(Region.US_EAST_1).credentialsProvider(StaticCredentialsProvider.create(AwsBasicCredentials.create("test-access","test-secret")))
            .serviceConfiguration(S3Configuration.builder().pathStyleAccessEnabled(true).build()).build();
        var store=mock(S3StorageResources.class);
        try {
            var beans=new StaticListableBeanFactory(); beans.addBean("signer",signer);
            var adapter=new CoverStorageAdapter(store,new S3InlineSigner(beans.getBeanProvider(S3Presigner.class),true,"sheet"));
            assertThat(adapter.sign("cover/1/2/test.png")).contains("X-Amz-Expires=3600");
            verifyNoInteractions(store);
        } finally { signer.close(); }
    }
    @Test void accompanimentErrorsKeepWorkerUnavailableContract() {
        var store=mock(S3StorageResources.class);
        doThrow(new IllegalStateException()).when(store).putAccompaniment(anyString(),any(),anyLong(),anyString());
        assertThatThrownBy(()->new AccompanimentStorageAdapter(store).put("key",java.nio.file.Path.of("file"),1,"audio/wav"))
            .isInstanceOfSatisfying(BusinessException.class,e->assertThat(e.getErrorCode().code()).isEqualTo("WORKER_UNAVAILABLE"));
    }
}
