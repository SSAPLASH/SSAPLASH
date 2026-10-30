package com.ssafy.airdrum.play.raw;

import java.io.ByteArrayInputStream;
import java.lang.reflect.InvocationHandler;
import java.lang.reflect.Proxy;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.Test;
import software.amazon.awssdk.core.sync.RequestBody;
import software.amazon.awssdk.services.s3.S3Client;
import software.amazon.awssdk.services.s3.model.*;
import com.ssafy.airdrum.common.error.BusinessException;
import com.ssafy.airdrum.play.PlayErrorCode;
import static org.assertj.core.api.Assertions.*;

/** SDK 요청 매핑 검사다. 실제 S3 호환 저장소 연동 성공을 대신하지 않는다. */
class S3PlayRawStoreTest {
	@Test void putKeepsServerKeyLengthAndGzipContentType() {
		var captured=new AtomicReference<PutObjectRequest>(); var bytes=new AtomicReference<byte[]>();
		var client=client((proxy,method,args)->{
			if(method.getName().equals("getBucketVersioning")) return GetBucketVersioningResponse.builder().build();
			if(method.getName().equals("putObject")) {
				captured.set((PutObjectRequest)args[0]);
				var body=(RequestBody)args[1]; assertThat(body.optionalContentLength()).contains(3L);
				try(var stream=body.contentStreamProvider().newStream()) { bytes.set(stream.readAllBytes()); }
				return PutObjectResponse.builder().build();
			}
			return null;
		});
		var store=new S3PlayRawStore(client,"private-raw"); store.checkAvailable();
		store.put("play-raw/a/b.json.gz",3,()->new ByteArrayInputStream(new byte[]{1,2,3}));
		assertThat(captured.get().bucket()).isEqualTo("private-raw"); assertThat(captured.get().key()).isEqualTo("play-raw/a/b.json.gz");
		assertThat(captured.get().contentType()).isEqualTo("application/gzip"); assertThat(bytes.get()).containsExactly(1,2,3);
	}
	@Test void enabledAndSuspendedVersioningAreRejected() {
		for(String state:new String[]{"Enabled","Suspended","UNKNOWN"}) {
			var store=new S3PlayRawStore(client((p,m,a)->GetBucketVersioningResponse.builder().status(state).build()),"raw");
			assertThatThrownBy(store::checkAvailable).isInstanceOfSatisfying(BusinessException.class,
					ex->assertThat(ex.getErrorCode()).isEqualTo(PlayErrorCode.PLAY_RAW_STORAGE_UNAVAILABLE));
		}
	}
	@Test void only404MeansMissingAndSdkDetailsNeverEscape() {
		var missing=new S3PlayRawStore(client((p,m,a)->{throw S3Exception.builder().statusCode(404).message("private endpoint").build();}),"raw");
		assertThat(missing.exists("play-raw/key")).isFalse(); missing.delete("play-raw/key");
		var forbidden=new S3PlayRawStore(client((p,m,a)->{throw S3Exception.builder().statusCode(403).message("secret data").build();}),"raw");
		assertThatThrownBy(()->forbidden.exists("play-raw/key")).isInstanceOf(BusinessException.class).hasMessageNotContaining("secret data");
	}
	private S3Client client(InvocationHandler handler) {
		return (S3Client)Proxy.newProxyInstance(S3Client.class.getClassLoader(),new Class<?>[]{S3Client.class},(proxy,method,args)-> {
			if(method.isDefault() && args!=null && args.length>0 && args[0] instanceof java.util.function.Consumer<?>)
				return InvocationHandler.invokeDefault(proxy,method,args);
			return handler.invoke(proxy,method,args);
		});
	}
}
