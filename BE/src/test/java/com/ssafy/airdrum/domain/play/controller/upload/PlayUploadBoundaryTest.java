package com.ssafy.airdrum.domain.play.controller.upload;

import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import tools.jackson.databind.json.JsonMapper;
import com.ssafy.airdrum.global.error.ErrorResponseWriter;
import com.ssafy.airdrum.domain.play.storage.PlayRawProperties;
import static org.assertj.core.api.Assertions.*;

class PlayUploadBoundaryTest {
	@Test void thirdRawRequestIsRejectedBeforeMultipartParsingAndSlotIsReleased() throws Exception {
		var filter=new PlayUploadFilter(new PlayRawProperties(false,null,"us-east-1",null,null,null,false,2),new ErrorResponseWriter(JsonMapper.builder().build()));
		var entered=new CountDownLatch(2); var release=new CountDownLatch(1);
		try(var pool=Executors.newFixedThreadPool(2)) {
			var running=new java.util.ArrayList<java.util.concurrent.Future<?>>();
			for(int i=0;i<2;i++) running.add(pool.submit(()->{
				try { filter.doFilter(request(),new MockHttpServletResponse(),(req,res)->{entered.countDown();try { release.await(5,TimeUnit.SECONDS); } catch(InterruptedException ex) { Thread.currentThread().interrupt(); }}); }
				catch(Exception ex) { throw new RuntimeException(ex); }
			}));
			try {
				assertThat(entered.await(3,TimeUnit.SECONDS)).isTrue(); var response=new MockHttpServletResponse();
				filter.doFilter(request(),response,(req,res)->{throw new AssertionError("슬롯 없이 본문을 파싱하면 안 됨");});
				assertThat(response.getStatus()).isEqualTo(503); assertThat(response.getHeader("Retry-After")).isEqualTo("5");
			} finally { release.countDown(); }
			for(var f:running) f.get(5,TimeUnit.SECONDS);
		}
		var calls=new java.util.concurrent.atomic.AtomicInteger();
		filter.doFilter(request(),new MockHttpServletResponse(),(req,res)->calls.incrementAndGet());
		assertThat(calls.get()).isEqualTo(1);
	}
	private MockHttpServletRequest request() { var request=new MockHttpServletRequest("POST","/api/v1/plays/"+UUID.randomUUID()+"/raw"); request.setContent(new byte[0]); return request; }
}
