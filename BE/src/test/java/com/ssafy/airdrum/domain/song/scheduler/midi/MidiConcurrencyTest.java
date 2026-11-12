package com.ssafy.airdrum.domain.song.scheduler.midi;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.*;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import com.ssafy.airdrum.domain.song.repository.midi.MidiOriginalReceipts;
import com.ssafy.airdrum.domain.song.storage.midi.MidiOriginalStore;
import com.ssafy.airdrum.domain.song.worker.midi.MidiSynthesisQueue;
import com.ssafy.airdrum.domain.song.service.management.SongAssetCleanup;

/** 각 스레드가 실제 독립 커넥션과 커밋을 사용해 잠금 순서를 검사한다. */
@SpringBootTest
class MidiConcurrencyTest {
    @Autowired JdbcTemplate db;
    @Autowired PlatformTransactionManager manager;
    @Autowired MidiOriginalReceipts receipts;
    @Autowired MidiOriginalCleanup originalCleanup;
    @Autowired MidiBackingCleanup backingCleanup;
    @MockitoBean MidiOriginalStore store;
    @Autowired SongAssetCleanup assets;
    @Autowired com.ssafy.airdrum.domain.withdrawal.service.WithdrawalService withdrawal;
    MidiSynthesisQueue queue; long user,song,job; UUID original;
    @BeforeEach void setup() {
        queue=new MidiSynthesisQueue(db,manager);
        user=db.queryForObject("INSERT INTO users(nickname) VALUES('midi race') RETURNING id",Long.class);
    }
    void ready() {
        song=db.queryForObject("INSERT INTO songs(owner_id,title,source,duration_ms) VALUES(?,'race','MIDI',1000) RETURNING id",Long.class,user);
        original=UUID.randomUUID();
        String key="midi-original/"+user+"/"+song+"/"+original+".mid";
        db.update("""
                INSERT INTO midi_original_uploads(id,user_id,reserved_song_id,song_id,object_key,size_bytes,sha256,status,expires_at)
                VALUES(?,?,?,?,?,3,?,'ACCEPTED',clock_timestamp()+interval '30 seconds')
                """,original,user,song,song,key,"a".repeat(64));
        job=db.queryForObject("""
                INSERT INTO midi_accompaniment_jobs(song_id,user_id,original_id,timing,duration_ms,status)
                VALUES(?,?,?,'{}'::jsonb,1000,'QUEUED') RETURNING id
                """,Long.class,song,user,original);
    }
    @AfterEach void cleanup() {
        db.update("DELETE FROM file_cleanup_tasks WHERE user_id=?",user);
        db.update("DELETE FROM midi_accompaniment_attempts WHERE job_id IN (SELECT id FROM midi_accompaniment_jobs WHERE user_id=?)",user);
        db.update("DELETE FROM midi_accompaniment_jobs WHERE user_id=?",user);
        db.update("DELETE FROM midi_original_uploads WHERE user_id=?",user);
        db.update("DELETE FROM songs WHERE owner_id=?",user);
        db.update("DELETE FROM users WHERE id=?",user);
    }
    @Test void twoWorkersCannotClaimTheSameJob() throws Exception {
        ready(); var start=new CountDownLatch(1);
        try (var pool=Executors.newFixedThreadPool(2)) {
            var a=pool.submit(()->{ start.await(); return queue.claim(); });
            var b=pool.submit(()->{ start.await(); return queue.claim(); });
            start.countDown();
            var first=a.get(5,TimeUnit.SECONDS); var second=b.get(5,TimeUnit.SECONDS);
            assertThat((first==null?0:1)+(second==null?0:1)).isEqualTo(1);
            assertThat(db.queryForObject("SELECT count(*) FROM midi_accompaniment_attempts WHERE job_id=?",Integer.class,job)).isEqualTo(1);
        }
    }
    @Test void deletionWinsAgainstCompletionWaitingForSongLock() throws Exception {
        ready(); var claim=queue.claim(); String key=queue.reserveOutput(claim);
        var started=new CountDownLatch(1);
        try (var pool=Executors.newSingleThreadExecutor()) {
            var tx=new TransactionTemplate(manager);
            java.util.concurrent.Future<Boolean>[] future=new java.util.concurrent.Future[1];
            tx.executeWithoutResult(s->{
                db.queryForObject("SELECT status FROM users WHERE id=? FOR SHARE",String.class,user);
                db.queryForObject("SELECT id FROM songs WHERE id=? FOR UPDATE",Long.class,song);
                future[0]=pool.submit(()->{ started.countDown(); return queue.complete(claim,key); });
                try { assertThat(started.await(2,TimeUnit.SECONDS)).isTrue();
                    try { future[0].get(200,TimeUnit.MILLISECONDS); throw new AssertionError("곡 잠금 없이 완료됨"); }
                    catch (TimeoutException expected) { /* 완료는 곡 잠금을 기다린다. */ }
                } catch (Exception e) { throw new RuntimeException(e); }
                assets.registerAll(user,song,null,null);
                db.update("UPDATE songs SET deleted_at=clock_timestamp() WHERE id=?",song);
            });
            assertThat(future[0].get(5,TimeUnit.SECONDS)).isFalse();
            assertThat(db.queryForObject("SELECT status FROM midi_accompaniment_jobs WHERE id=?",String.class,job)).isEqualTo("CANCELLED");
            assertThat(db.queryForObject("SELECT accompaniment_key FROM songs WHERE id=?",String.class,song)).isNull();
        }
    }
    @Test void receiptAcceptedWhileCleanupWaitsIsNotRetired() throws Exception {
        var receipt=receipts.begin(user,new byte[]{1,2,3},"a".repeat(64)); song=receipt.songId(); original=receipt.id();
        db.update("UPDATE file_cleanup_tasks SET next_attempt_at=clock_timestamp() WHERE midi_original_id=?",original);
        long task=db.queryForObject("SELECT id FROM file_cleanup_tasks WHERE midi_original_id=?",Long.class,original);
        var accepted=new CountDownLatch(1); var commit=new CountDownLatch(1);
        try (var pool=Executors.newFixedThreadPool(2)) {
            var a=pool.submit(()->{
                new TransactionTemplate(manager).executeWithoutResult(s->{
                    db.queryForObject("SELECT status FROM users WHERE id=? FOR SHARE",String.class,user);
                    db.update("INSERT INTO songs(id,owner_id,title,source) OVERRIDING SYSTEM VALUE VALUES(?,?,'race','MIDI')",song,user);
                    receipts.accept(receipt,user); accepted.countDown();
                    try { if (!commit.await(3,TimeUnit.SECONDS)) throw new IllegalStateException("대기 시간 초과"); }
                    catch (InterruptedException e) { Thread.currentThread().interrupt(); throw new IllegalStateException(e); }
                }); return null;
            });
            assertThat(accepted.await(3,TimeUnit.SECONDS)).isTrue();
            var b=pool.submit(()->originalCleanup.claim(new MidiOriginalCleanup.Candidate(task,original,user,song)));
            try { b.get(200,TimeUnit.MILLISECONDS); throw new AssertionError("접수 잠금 없이 정리됨"); }
            catch (TimeoutException expected) { /* 접수 확정을 기다린다. */ }
            commit.countDown(); a.get(5,TimeUnit.SECONDS);
            assertThat(b.get(5,TimeUnit.SECONDS)).isNull();
            assertThat(db.queryForObject("SELECT status FROM midi_original_uploads WHERE id=?",String.class,original)).isEqualTo("ACCEPTED");
        } finally { commit.countDown(); }
    }
    @Test void cleanupClaimBeforeAcceptancePreventsResurrection() {
        var receipt=receipts.begin(user,new byte[]{1,2,3},"a".repeat(64)); song=receipt.songId(); original=receipt.id();
        db.update("UPDATE midi_original_uploads SET expires_at=clock_timestamp()-interval '1 second' WHERE id=?",original);
        db.update("UPDATE file_cleanup_tasks SET next_attempt_at=clock_timestamp() WHERE midi_original_id=?",original);
        long task=db.queryForObject("SELECT id FROM file_cleanup_tasks WHERE midi_original_id=?",Long.class,original);
        assertThat(originalCleanup.claim(new MidiOriginalCleanup.Candidate(task,original,user,song))).isNotNull();
        assertThatThrownBy(()->new TransactionTemplate(manager).executeWithoutResult(s->{
            db.queryForObject("SELECT status FROM users WHERE id=? FOR SHARE",String.class,user);
            db.update("INSERT INTO songs(id,owner_id,title,source) OVERRIDING SYSTEM VALUE VALUES(?,?,'race','MIDI')",song,user);
            receipts.accept(receipt,user);
        })).isInstanceOf(com.ssafy.airdrum.global.error.BusinessException.class);
        assertThat(db.queryForObject("SELECT count(*) FROM songs WHERE id=?",Integer.class,song)).isZero();
        assertThat(db.queryForObject("SELECT status FROM midi_original_uploads WHERE id=?",String.class,original)).isEqualTo("RETIRED");
    }
    @Test void outputCleanupCannotDeleteCurrentAttemptOrLinkedResult() {
        ready(); var c=queue.claim(); String key=queue.reserveOutput(c);
        long task=db.queryForObject("SELECT id FROM file_cleanup_tasks WHERE object_key=?",Long.class,key);
        var candidate=new MidiBackingCleanup.Candidate(task,user,song,job,c.attempt());
        db.update("UPDATE file_cleanup_tasks SET next_attempt_at=clock_timestamp() WHERE id=?",task);
        assertThat(backingCleanup.claim(candidate)).isNull();
        assertThat(queue.complete(c,key)).isTrue();
        db.update("UPDATE file_cleanup_tasks SET next_attempt_at=clock_timestamp() WHERE id=?",task);
        assertThat(backingCleanup.claim(candidate)).isNull();
        assertThat(db.queryForObject("SELECT accompaniment_key FROM songs WHERE id=?",String.class,song)).isEqualTo(key);
    }
    @Test void expiredOutputCleanupPreventsLateCompletion() {
        ready(); var c=queue.claim(); String key=queue.reserveOutput(c);
        long task=db.queryForObject("SELECT id FROM file_cleanup_tasks WHERE object_key=?",Long.class,key);
        db.update("UPDATE midi_accompaniment_jobs SET lease_expires_at=clock_timestamp()-interval '1 second' WHERE id=?",job);
        db.update("UPDATE file_cleanup_tasks SET next_attempt_at=clock_timestamp() WHERE id=?",task);
        assertThat(backingCleanup.claim(new MidiBackingCleanup.Candidate(task,user,song,job,c.attempt()))).isNotNull();
        assertThat(queue.complete(c,key)).isFalse();
    }
    @Test void retiredKeyIsCheckedAgainAfterLatePut() {
        var receipt=receipts.begin(user,new byte[]{1,2,3},"a".repeat(64)); song=receipt.songId(); original=receipt.id();
        receipts.retire(receipt);
        when(store.exists(receipt.key())).thenReturn(false,true);
        originalCleanup.runOnce();
        assertThat(db.queryForObject("SELECT status FROM file_cleanup_tasks WHERE midi_original_id=?",String.class,original)).isEqualTo("DELETED");
        db.update("UPDATE file_cleanup_tasks SET next_attempt_at=clock_timestamp() WHERE midi_original_id=?",original);
        originalCleanup.runOnce();
        verify(store).delete(receipt.key());
    }
    @Test void successfulRegenerationKeepsOldKeyUntilTwelveMinuteGraceExpires() {
        ready(); var first=queue.claim(); String old=queue.reserveOutput(first);
        assertThat(queue.complete(first,old)).isTrue();
        long oldTask=db.queryForObject("SELECT id FROM file_cleanup_tasks WHERE object_key=?",Long.class,old);
        db.update("""
                INSERT INTO midi_accompaniment_jobs(song_id,user_id,original_id,timing,duration_ms,status)
                VALUES(?,?,?,'{}'::jsonb,1000,'QUEUED')
                """,song,user,original);
        var second=queue.claim(); String replacement=queue.reserveOutput(second);
        assertThat(queue.complete(second,replacement)).isTrue();
        assertThat(db.queryForObject("SELECT accompaniment_key FROM songs WHERE id=?",String.class,song)).isEqualTo(replacement);
        double remaining=db.queryForObject("SELECT extract(epoch from (next_attempt_at-clock_timestamp())) FROM file_cleanup_tasks WHERE id=?",Double.class,oldTask);
        assertThat(remaining).isBetween(719.0,720.0);
        var candidate=new MidiBackingCleanup.Candidate(oldTask,user,song,first.job(),first.attempt());
        assertThat(backingCleanup.claim(candidate)).isNull();
        db.update("UPDATE file_cleanup_tasks SET next_attempt_at=clock_timestamp()-interval '1 millisecond' WHERE id=?",oldTask);
        var claim=backingCleanup.claim(candidate);
        assertThat(claim).isNotNull(); assertThat(claim.key()).isEqualTo(old);
    }
    @Test void deletingThirtyDayOldOriginalRestartsLatePutRecheck() {
        ready(); String key="midi-original/"+user+"/"+song+"/"+original+".mid";
        db.update("""
                INSERT INTO file_cleanup_tasks(object_key,file_role,user_id,midi_original_id,created_at,next_attempt_at,midi_recheck_until)
                VALUES(?,'MIDI_ORIGINAL',?,?,clock_timestamp()-interval '30 days',clock_timestamp()+interval '1 hour',clock_timestamp()-interval '29 days')
                """,key,user,original);
        new TransactionTemplate(manager).executeWithoutResult(s->{
            db.queryForObject("SELECT status FROM users WHERE id=? FOR SHARE",String.class,user);
            db.queryForObject("SELECT id FROM songs WHERE id=? FOR UPDATE",Long.class,song);
            assets.registerAll(user,song,null,null);
            db.update("UPDATE songs SET deleted_at=clock_timestamp() WHERE id=?",song);
        });
        assertThat(db.queryForObject("SELECT midi_recheck_until>clock_timestamp()+interval '23 hours' FROM file_cleanup_tasks WHERE midi_original_id=?",Boolean.class,original)).isTrue();
        when(store.exists(key)).thenReturn(false,true);
        originalCleanup.runOnce();
        assertThat(db.queryForObject("SELECT status FROM file_cleanup_tasks WHERE midi_original_id=?",String.class,original)).isEqualTo("DELETED");
        db.update("UPDATE file_cleanup_tasks SET next_attempt_at=clock_timestamp() WHERE midi_original_id=?",original);
        originalCleanup.runOnce(); verify(store).delete(key);
    }
    @Test void withdrawalWhileWorkerCompletionWaitsCancelsJobAndPreventsAttachment() throws Exception {
        ready(); var claim=queue.claim(); String key=queue.reserveOutput(claim);
        String originalKey="midi-original/"+user+"/"+song+"/"+original+".mid";
        db.update("""
                INSERT INTO file_cleanup_tasks(object_key,file_role,user_id,midi_original_id,next_attempt_at,midi_recheck_until)
                VALUES(?,'MIDI_ORIGINAL',?,?,clock_timestamp()+interval '30 seconds',clock_timestamp()+interval '24 hours')
                """,originalKey,user,original);
        var started=new CountDownLatch(1);
        try (var pool=Executors.newSingleThreadExecutor()) {
            java.util.concurrent.Future<Boolean>[] future=new java.util.concurrent.Future[1];
            new TransactionTemplate(manager).executeWithoutResult(s->{
                db.queryForObject("SELECT status FROM users WHERE id=? FOR UPDATE",String.class,user);
                future[0]=pool.submit(()->{ started.countDown(); return queue.complete(claim,key); });
                try { assertThat(started.await(2,TimeUnit.SECONDS)).isTrue();
                    try { future[0].get(200,TimeUnit.MILLISECONDS); throw new AssertionError("회원 잠금 없이 완료됨"); }
                    catch (TimeoutException expected) { /* 탈퇴 커밋을 기다린다. */ }
                } catch (Exception e) { throw new RuntimeException(e); }
                withdrawal.withdraw(user);
            });
            assertThat(future[0].get(5,TimeUnit.SECONDS)).isFalse();
            assertThat(db.queryForObject("SELECT status FROM midi_accompaniment_jobs WHERE id=?",String.class,job)).isEqualTo("CANCELLED");
            assertThat(db.queryForObject("SELECT status FROM midi_original_uploads WHERE id=?",String.class,original)).isEqualTo("RETIRED");
            assertThat(db.queryForObject("SELECT deleted_at IS NOT NULL FROM songs WHERE id=?",Boolean.class,song)).isTrue();
            assertThat(db.queryForObject("SELECT accompaniment_key FROM songs WHERE id=?",String.class,song)).isNull();
            assertThat(db.queryForObject("SELECT count(*) FROM file_cleanup_tasks WHERE object_key IN (?,?) AND status='PENDING'",Integer.class,originalKey,key)).isEqualTo(2);
        }
    }
}
