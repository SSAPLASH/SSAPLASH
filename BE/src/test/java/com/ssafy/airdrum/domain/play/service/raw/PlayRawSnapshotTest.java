package com.ssafy.airdrum.domain.play.service.raw;

import java.sql.ResultSet;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.ResultSetExtractor;
import com.ssafy.airdrum.domain.play.exception.PlayErrorCode;
import com.ssafy.airdrum.domain.play.model.PlayJson;
import com.ssafy.airdrum.domain.play.repository.session.PlaySessionRepository;
import com.ssafy.airdrum.global.error.BusinessException;
import com.ssafy.airdrum.domain.play.repository.session.PlaySessionRepository.RawSnapshot;
import com.ssafy.airdrum.domain.play.repository.session.PlaySessionRepository.SensorHit;
import static org.assertj.core.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

class PlayRawSnapshotTest {
	final UUID play=UUID.randomUUID();
	final long user=7;
	final String hash="a".repeat(64);
	final JdbcTemplate db=mock(JdbcTemplate.class);
	final ResultSet rows=mock(ResultSet.class);
	final PlaySessionRepository sessions=new PlaySessionRepository(db,new PlayJson());
	@BeforeEach void queryResult() throws Exception {
		when(db.query(anyString(),org.mockito.ArgumentMatchers.<ResultSetExtractor<RawSnapshot>>any(),eq(play),eq(user)))
				.thenAnswer(i->{
					ResultSetExtractor<RawSnapshot> extractor=i.getArgument(1);
					return extractor.extractData(rows);
				});
	}
	@Test void hashAndSensorHitsAreReadByOneOwnerScopedQuery() throws Exception {
		when(rows.next()).thenReturn(true,true,false);
		when(rows.getString(1)).thenReturn(hash);
		when(rows.getObject(2,Integer.class)).thenReturn(0,4);
		when(rows.getInt(3)).thenReturn(0,1);
		when(rows.getDouble(4)).thenReturn(-10.125,25.5);
		var snapshot=sessions.rawSnapshot(play,user);
		assertThat(snapshot.hash()).isEqualTo(hash);
		assertThat(snapshot.hits()).isEqualTo(Map.of(0,new SensorHit(0,-10.125),4,new SensorHit(1,25.5)));
		assertThatThrownBy(()->snapshot.hits().clear()).isInstanceOf(UnsupportedOperationException.class);
		var sql=ArgumentCaptor.forClass(String.class);
		verify(db).query(sql.capture(),org.mockito.ArgumentMatchers.<ResultSetExtractor<RawSnapshot>>any(),eq(play),eq(user));
		assertThat(sql.getValue()).contains("LEFT JOIN hits", "h.stick_id IS NOT NULL", "WHERE s.id=? AND s.user_id=?")
				.doesNotContain("FOR UPDATE", "FOR SHARE");
		verifyNoMoreInteractions(db);
	}
	@Test void existingSessionWithoutSensorsReturnsHashAndEmptyMap() throws Exception {
		when(rows.next()).thenReturn(true,false);
		when(rows.getString(1)).thenReturn(hash);
		when(rows.getObject(2,Integer.class)).thenReturn(null);
		var snapshot=sessions.rawSnapshot(play,user);
		assertThat(snapshot.hash()).isEqualTo(hash);
		assertThat(snapshot.hits()).isEmpty();
		verify(rows,never()).getInt(anyInt());
		verify(rows,never()).getDouble(anyInt());
	}
	@Test void missingOrOtherOwnersSessionIsNotAnEmptySensorSession() throws Exception {
		when(rows.next()).thenReturn(false);
		assertThatThrownBy(()->sessions.rawSnapshot(play,user)).isInstanceOfSatisfying(BusinessException.class,
				ex->assertThat(ex.getErrorCode()).isEqualTo(PlayErrorCode.PLAY_NOT_FOUND));
		verify(rows,never()).getString(anyInt());
	}
}
