package com.ssafy.airdrum.domain.chart.scheduler;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;
import java.time.Duration;
import java.net.URI;
import java.util.UUID;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.support.StaticListableBeanFactory;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import software.amazon.awssdk.auth.credentials.AwsBasicCredentials;
import software.amazon.awssdk.auth.credentials.StaticCredentialsProvider;
import software.amazon.awssdk.regions.Region;
import software.amazon.awssdk.services.s3.S3Configuration;
import software.amazon.awssdk.services.s3.presigner.S3Presigner;
import com.ssafy.airdrum.domain.chart.storage.worker.S3WorkerStore;
import com.ssafy.airdrum.domain.chart.storage.worker.WorkerStore;
import com.ssafy.airdrum.domain.chart.storage.ChartStorageProperties;

@SpringBootTest(properties={"auth.jwt.secret=test-only-jwt-secret-0123456789ab","auth.refresh-token.store=memory","chart.worker.cleanup-interval-ms=86400000"})
class CoverCleanupTest {
    @Autowired JdbcTemplate db; @Autowired WorkerCleanup cleanup;
    @MockitoBean S3WorkerStore store;
    long user,song; String active,old;
    @BeforeEach void setup() {
        user=db.queryForObject("INSERT INTO users(nickname) VALUES('cover cleanup') RETURNING id",Long.class);
        song=db.queryForObject("INSERT INTO songs(owner_id,title,source,status) VALUES(?,'cover','MIDI','READY') RETURNING id",Long.class,user);
        active="cover/"+user+"/"+song+"/"+UUID.randomUUID()+".png"; old="cover/"+user+"/"+song+"/"+UUID.randomUUID()+".png";
        db.update("UPDATE songs SET cover_key=? WHERE id=?",active,song);
        db.update("INSERT INTO file_cleanup_tasks(object_key,file_role,user_id) VALUES(?,'COVER',?),(?,'COVER',?)",active,user,old,user);
        when(store.exists(any(),anyString())).thenReturn(true);
    }
    @AfterEach void clean() { db.update("DELETE FROM file_cleanup_tasks WHERE user_id=?",user); db.update("DELETE FROM songs WHERE id=?",song); db.update("DELETE FROM users WHERE id=?",user); }
    @Test void activeReferenceIsProtectedAndOldKeyCanBeRetried() {
        doThrow(new IllegalStateException()).doNothing().when(store).delete(WorkerStore.Bucket.SHEET,old);
        cleanup.runOnce();
        verify(store,never()).delete(WorkerStore.Bucket.SHEET,active);
        assertThat(db.queryForObject("SELECT status FROM file_cleanup_tasks WHERE object_key=?",String.class,old)).isEqualTo("FAILED");
        db.update("UPDATE file_cleanup_tasks SET next_attempt_at=now() WHERE object_key=?",old);
        cleanup.runOnce();
        assertThat(db.queryForObject("SELECT status FROM file_cleanup_tasks WHERE object_key=?",String.class,old)).isEqualTo("DELETED");
        verify(store,times(2)).delete(WorkerStore.Bucket.SHEET,old);
        verify(store,never()).delete(WorkerStore.Bucket.SHEET,active);
    }
    /** 156번: 소유자 없는 공용 곡 커버도 살아 있는 동안 지우지 않고, 곡을 삭제하면 지운다. */
    @Test void builtinCoverIsProtectedUntilSongDeleted() {
        long builtin=db.queryForObject("INSERT INTO songs(title,source,status,license) VALUES('builtin cover','BUILTIN','READY','x') RETURNING id",Long.class);
        String key="cover/builtin/"+builtin+"/"+UUID.randomUUID()+".png";
        try {
            db.update("UPDATE songs SET cover_key=? WHERE id=?",key,builtin);
            db.update("INSERT INTO file_cleanup_tasks(object_key,file_role) VALUES(?,'COVER')",key);
            cleanup.runOnce();
            verify(store,never()).delete(WorkerStore.Bucket.SHEET,key);
            db.update("UPDATE songs SET deleted_at=now() WHERE id=?",builtin);
            cleanup.runOnce();
            verify(store).delete(WorkerStore.Bucket.SHEET,key);
        } finally {
            db.update("DELETE FROM file_cleanup_tasks WHERE object_key=?",key);
            db.update("DELETE FROM songs WHERE id=?",builtin);
        }
    }
}
