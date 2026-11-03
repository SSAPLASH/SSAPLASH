package com.ssafy.airdrum.song;

import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import com.ssafy.airdrum.chart.ChartDocumentReader;
import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;

@SpringBootTest(properties = "spring.datasource.hikari.schema=public")
class SongLevelBackfillTest {
    @Autowired JdbcTemplate db;
    @Autowired ChartDocumentReader reader;
    @Autowired PlatformTransactionManager manager;
    long user, first, missing, last, hard;
    TransactionTemplate tx;
    SongLevelService service;
    @BeforeEach void setup() {
        tx = new TransactionTemplate(manager); service = new SongLevelService(db,reader);
        user=db.queryForObject("INSERT INTO users(nickname) VALUES(?) RETURNING id",Long.class,"backfill-test");
        first=song(); missing=song(); last=song();
        chart(first,"NORMAL"); hard=chart(last,"HARD");
        db.update("UPDATE songs SET level_legacy_fallback=true WHERE id=?",first);
    }
    private long song() { return db.queryForObject("INSERT INTO songs(owner_id,title,source,status,duration_ms) VALUES(?,'backfill','MIDI','READY',10000) RETURNING id",Long.class,user); }
    private long chart(long song,String difficulty) {
        long id=db.queryForObject("INSERT INTO charts(song_id,difficulty) VALUES(?,?) RETURNING id",Long.class,song,difficulty);
        version(id,1); return id;
    }
    private long version(long chart,int number) {
        return db.queryForObject("INSERT INTO chart_versions(chart_id,version,notes,timing,notation_status,note_count,generator) VALUES(?,?, '[{\"noteId\":\"n\",\"timeMs\":0,\"pad\":\"KICK\"}]'::jsonb, '{}'::jsonb,'PENDING',1,'MANUAL') RETURNING id",Long.class,chart,number);
    }
    @AfterEach void cleanup() {
        db.update("UPDATE songs SET song_level=NULL,level_chart_version_id=NULL,level_rule_version=NULL,level_duration_ms=NULL WHERE owner_id=?",user);
        db.update("DELETE FROM chart_versions WHERE chart_id IN (SELECT id FROM charts WHERE song_id IN (SELECT id FROM songs WHERE owner_id=?))",user);
        db.update("DELETE FROM charts WHERE song_id IN (SELECT id FROM songs WHERE owner_id=?)",user);
        db.update("DELETE FROM songs WHERE owner_id=?",user); db.update("DELETE FROM users WHERE id=?",user);
    }
    @Test void dryRunApplyPartialFailureAndRerun() {
		assertThatThrownBy(() -> service.process(first,true)).isInstanceOf(IllegalStateException.class).hasMessageContaining("트랜잭션");
        var dry=SongLevelBackfill.run(db,tx,service,false,first-1,last,1);
        assertThat(dry.counts()).containsEntry("CALCULATED",2).containsEntry("NO_CHART",1);
        assertThat(dry.legacyEligible()).isEqualTo(1); assertThat(dry.legacyUsed()).isEqualTo(1);
        assertThat(db.queryForObject("SELECT count(*) FROM songs WHERE owner_id=? AND song_level IS NOT NULL",Integer.class,user)).isZero();
        var failing=spy(service); doThrow(new IllegalStateException("test")).when(failing).process(missing,true);
        var applied=SongLevelBackfill.run(db,tx,failing,true,first-1,last,1);
        assertThat(applied.errors()).isEqualTo(1);
        assertThat(db.queryForObject("SELECT count(*) FROM songs WHERE owner_id=? AND song_level IS NOT NULL",Integer.class,user)).isEqualTo(2);
        var again=SongLevelBackfill.run(db,tx,service,true,first-1,last,1);
        assertThat(again.errors()).isZero(); assertThat(again.counts()).containsEntry("UNCHANGED",2).containsEntry("NO_CHART",1);
    }
    @Test void builtInSeedChartsMatchCalibratedRule() {
        for (var entry : java.util.Map.of("기본 8비트",SongLevelService.Level.BEGINNER,
                "8비트 + 필인",SongLevelService.Level.INTERMEDIATE,"라이드 16비트",SongLevelService.Level.ADVANCED).entrySet()) {
            long id=db.queryForObject("SELECT id FROM songs WHERE source='BUILTIN' AND title=? AND deleted_at IS NULL",Long.class,entry.getKey());
            assertThat(service.process(id,false).level()).as(entry.getKey()).isEqualTo(entry.getValue());
        }
    }
    @Test void backfillAfterConcurrentVersionCommitUsesLatest() throws Exception {
        var locked=new CountDownLatch(1); var release=new CountDownLatch(1); var started=new CountDownLatch(1);
        var writerPid = new AtomicInteger();
        try (var pool=Executors.newFixedThreadPool(2)) {
            var update=pool.submit(() -> tx.execute(status -> {
                writerPid.set(db.queryForObject("SELECT pg_backend_pid()",Integer.class));
                db.queryForObject("SELECT id FROM songs WHERE id=? FOR UPDATE",Long.class,last);
                long newer=version(hard,2); db.update("UPDATE songs SET duration_ms=20000 WHERE id=?",last); locked.countDown();
                try { if (!release.await(10,TimeUnit.SECONDS)) throw new IllegalStateException("timeout"); }
                catch (InterruptedException ex) { Thread.currentThread().interrupt(); throw new IllegalStateException(ex); }
                return newer;
            }));
            if (!locked.await(10,TimeUnit.SECONDS)) {
                update.get(1,TimeUnit.SECONDS);
                throw new AssertionError("writer did not acquire the lock");
            }
            var backfill=pool.submit(() -> { started.countDown(); return SongLevelBackfill.run(db,tx,service,true,last-1,last,1); });
            assertThat(started.await(10,TimeUnit.SECONDS)).isTrue();
            try {
                long deadline=System.nanoTime()+TimeUnit.SECONDS.toNanos(5); boolean waiting=false;
                while (System.nanoTime()<deadline && !waiting) {
                    waiting=db.queryForObject("SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE ? = ANY(pg_blocking_pids(pid)))",Boolean.class,writerPid.get());
                    if (!waiting) Thread.sleep(50);
                }
                assertThat(waiting).as("backfill must wait on the writer's row lock").isTrue();
            } finally { release.countDown(); }
            long newer=update.get(10,TimeUnit.SECONDS); backfill.get(10,TimeUnit.SECONDS);
            assertThat(db.queryForObject("SELECT level_chart_version_id FROM songs WHERE id=?",Long.class,last)).isEqualTo(newer);
            assertThat(db.queryForObject("SELECT level_duration_ms FROM songs WHERE id=?",Integer.class,last)).isEqualTo(20000);
        }
    }
}
