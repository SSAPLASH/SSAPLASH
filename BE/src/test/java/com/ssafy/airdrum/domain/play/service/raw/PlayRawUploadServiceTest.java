package com.ssafy.airdrum.domain.play.service.raw;

import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.SimpleTransactionStatus;
import com.ssafy.airdrum.domain.play.repository.raw.PlayRawUploadRepository;
import com.ssafy.airdrum.domain.play.storage.PlayRawStore;
import com.ssafy.airdrum.global.error.BusinessException;
import com.ssafy.airdrum.domain.play.exception.PlayErrorCode;
import com.ssafy.airdrum.domain.play.support.PlayFixtures;
import com.ssafy.airdrum.domain.play.model.PlayJson;
import com.ssafy.airdrum.domain.play.repository.session.PlaySessionRepository;
import com.ssafy.airdrum.domain.user.service.profile.UserQueryService;
import static org.assertj.core.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

class PlayRawUploadServiceTest {
	@Test void reusedUuidAfterValidationCannotStartAnUploadForAnotherSummary() throws Exception {
		long user=7; UUID play=UUID.randomUUID();
		var sessions=mock(PlaySessionRepository.class);
		var users=mock(UserQueryService.class);
		var db=mock(JdbcTemplate.class);
		var manager=mock(PlatformTransactionManager.class);
		when(manager.getTransaction(any())).thenAnswer(i->new SimpleTransactionStatus());
		var receipts=new PlayRawUploadRepository(db,sessions,users,manager);
		var validator=spy(new PlayRawValidator(new PlayJson()));
		var store=mock(PlayRawStore.class);
		var service=new PlayRawUploadService(sessions,validator,receipts,store);
		var original=new PlaySessionRepository.Session(play,user,"a".repeat(64),"PENDING",null,"STICK");
		var current=new AtomicReference<>(original);
		when(sessions.own(play,user,true)).thenAnswer(i->current.get());
		when(sessions.rawSnapshot(play,user)).thenReturn(new PlaySessionRepository.RawSnapshot(original.hash(),Map.of(0,new PlaySessionRepository.SensorHit(0,-10.125))));
		var validated=new CountDownLatch(1); var resume=new CountDownLatch(1);
		doAnswer(i->{
			Object payload=i.callRealMethod();
			validated.countDown();
			if(!resume.await(10,TimeUnit.SECONDS)) throw new IllegalStateException("테스트 대기 초과");
			return payload;
		}).when(validator).validate(any(),eq(play),anyMap());
		var file=new MockMultipartFile("file","play.json.gz","application/gzip",PlayFixtures.gzip(PlayFixtures.raw(play)));
		try(var pool=Executors.newSingleThreadExecutor()) {
			var upload=pool.submit(()->{
				assertThatThrownBy(()->service.upload(user,play,file))
						.isInstanceOfSatisfying(BusinessException.class,ex->assertThat(ex.getErrorCode()).isEqualTo(PlayErrorCode.PLAY_STATE_CHANGED));
				return null;
			});
			try {
				assertThat(validated.await(5,TimeUnit.SECONDS)).isTrue();
				current.set(new PlaySessionRepository.Session(play,user,"b".repeat(64),"PENDING",null,"STICK"));
			} finally { resume.countDown(); }
			upload.get(10,TimeUnit.SECONDS);
		}
		verifyNoInteractions(store);
		verify(db).execute("SET LOCAL lock_timeout='3s'");
		verify(db).execute("SET LOCAL statement_timeout='10s'");
		verifyNoMoreInteractions(db);
		verify(users).requireActiveForShare(user);
		verify(sessions).own(play,user,true);
		verify(manager).rollback(any());
		verify(manager,never()).commit(any());
	}
}
