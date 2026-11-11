package com.ssafy.airdrum.domain.song.service.management;

import static org.assertj.core.api.Assertions.*;

import com.ssafy.airdrum.domain.song.event.SongWithdrawalListener;
import com.ssafy.airdrum.domain.song.scheduler.SongWithdrawalRecovery;
import com.ssafy.airdrum.domain.user.event.UserWithdrawnEvent;
import com.ssafy.airdrum.domain.withdrawal.service.WithdrawalService;
import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

@SpringBootTest(properties={"chart.withdrawal.recovery-interval-ms=86400000", "chart.worker.recovery-interval-ms=86400000"})
class SongWithdrawalCleanupTest {
    @Autowired JdbcTemplate db;
    @Autowired WithdrawalService withdrawal;
    @Autowired SongWithdrawalListener listener;
    @Autowired SongWithdrawalRecovery recovery;
    @Autowired ApplicationEventPublisher events;
    @Autowired PlatformTransactionManager manager;
    final List<Long> users = new ArrayList<>();
    final List<Long> songs = new ArrayList<>();

    @AfterEach void clean() {
        for(long song:songs) {
            db.update("DELETE FROM file_cleanup_tasks WHERE user_id IN (SELECT owner_id FROM songs WHERE id=?)",song);
            db.update("DELETE FROM chart_versions WHERE chart_id IN (SELECT id FROM charts WHERE song_id=?)",song);
            db.update("DELETE FROM charts WHERE song_id=?",song);
            db.update("DELETE FROM songs WHERE id=?",song);
        }
        for(long user:users) db.update("DELETE FROM users WHERE id=?",user);
    }
    long user() { long id=db.queryForObject("INSERT INTO users(nickname) VALUES('test') RETURNING id",Long.class); users.add(id); return id; }
    long song(long user,String source) { long id=db.queryForObject("INSERT INTO songs(owner_id,title,source) VALUES(?,'test',?) RETURNING id",Long.class,user,source); songs.add(id); return id; }
    long version(long song) {
        long chart=db.queryForObject("INSERT INTO charts(song_id,difficulty) VALUES(?,'EASY') RETURNING id",Long.class,song);
        return db.queryForObject("INSERT INTO chart_versions(chart_id,version,notes,timing,notation_status,note_count,generator) VALUES(?,1,'[]','{}','READY',0,'MANUAL') RETURNING id",Long.class,chart);
    }
    int count(String sql,Object... args) { return db.queryForObject(sql,Integer.class,args); }

    @Test void committedWithdrawalRegistersOnlyOwnedValidAssetsAndIsIdempotent() {
        long owner=user(), other=user(), audio=song(owner,"AUDIO"), midi=song(owner,"MIDI"), alien=song(other,"AUDIO");
        long v=version(audio); String backing="accompaniment/"+audio+".flac", sheet="sheet/"+v+"/page.png";
        db.update("UPDATE songs SET accompaniment_key=? WHERE id=?",backing,audio);
        db.update("UPDATE chart_versions SET sheet_pages=?::jsonb WHERE id=?","[{\"imageKey\":\""+sheet+"\"},{\"imageKey\":\"sheet/999/other.png\"}]",v);
        withdrawal.withdraw(owner);
        assertThat(count("SELECT count(*) FROM songs WHERE id IN (?,?) AND deleted_at IS NOT NULL",audio,midi)).isEqualTo(2);
        assertThat(count("SELECT count(*) FROM songs WHERE id=? AND deleted_at IS NULL",alien)).isEqualTo(1);
        assertThat(count("SELECT count(*) FROM file_cleanup_tasks WHERE user_id=? AND object_key IN (?,?)",owner,backing,sheet)).isEqualTo(2);
        assertThat(count("SELECT count(*) FROM file_cleanup_tasks WHERE object_key='sheet/999/other.png'")).isZero();
        listener.withdrawn(new UserWithdrawnEvent(owner)); recovery.recover();
        assertThat(count("SELECT count(*) FROM file_cleanup_tasks WHERE user_id=?",owner)).isEqualTo(2);
    }
    @Test void rolledBackEventDoesNotTriggerCleanupAndRecoveryRepairsMissedEvent() {
        long owner=user(), id=song(owner,"MIDI");
        new TransactionTemplate(manager).executeWithoutResult(s -> { db.update("UPDATE users SET status='WITHDRAWN',withdrawn_at=clock_timestamp() WHERE id=?",owner); events.publishEvent(new UserWithdrawnEvent(owner)); s.setRollbackOnly(); });
        assertThat(count("SELECT count(*) FROM songs WHERE id=? AND deleted_at IS NULL",id)).isEqualTo(1);
        db.update("UPDATE users SET status='WITHDRAWN',withdrawn_at=clock_timestamp() WHERE id=?",owner);
        recovery.recover();
        assertThat(count("SELECT count(*) FROM songs WHERE id=? AND deleted_at IS NOT NULL",id)).isEqualTo(1);
    }
    @Test void activeEventDoesNothingAndRecoveryRevisitsPreviouslyDeletedSong() {
        long owner=user(), audio=song(owner,"AUDIO");
        String key="accompaniment/"+audio+".flac";
        db.update("UPDATE songs SET accompaniment_key=? WHERE id=?",key,audio);
        listener.withdrawn(new UserWithdrawnEvent(owner));
        assertThat(count("SELECT count(*) FROM songs WHERE id=? AND deleted_at IS NULL",audio)).isEqualTo(1);
        assertThat(count("SELECT count(*) FROM file_cleanup_tasks WHERE object_key=?",key)).isZero();
        db.update("UPDATE users SET status='WITHDRAWN',withdrawn_at=clock_timestamp() WHERE id=?",owner);
        db.update("UPDATE songs SET deleted_at=now()-interval '1 day' WHERE id=?",audio);
        var before=db.queryForObject("SELECT deleted_at FROM songs WHERE id=?",java.sql.Timestamp.class,audio);
        recovery.recover();
        assertThat(db.queryForObject("SELECT deleted_at FROM songs WHERE id=?",java.sql.Timestamp.class,audio)).isEqualTo(before);
        assertThat(count("SELECT count(*) FROM file_cleanup_tasks WHERE object_key=?",key)).isEqualTo(1);
    }
    @Test void recoveryRegistersOwnedCoverAndRejectsForeignKey() {
        long owner=user(), other=user(), first=song(owner,"MIDI"), second=song(owner,"MIDI");
        String valid="cover/"+owner+"/"+first+"/"+java.util.UUID.randomUUID()+".png";
        String foreign="cover/"+other+"/"+second+"/"+java.util.UUID.randomUUID()+".png";
        db.update("UPDATE songs SET cover_key=? WHERE id=?",valid,first); db.update("UPDATE songs SET cover_key=? WHERE id=?",foreign,second);
        db.update("UPDATE users SET status='WITHDRAWN',withdrawn_at=clock_timestamp() WHERE id=?",owner);
        recovery.recover(); recovery.recover();
        assertThat(count("SELECT count(*) FROM file_cleanup_tasks WHERE object_key=? AND file_role='COVER'",valid)).isEqualTo(1);
        assertThat(count("SELECT count(*) FROM file_cleanup_tasks WHERE object_key=?",foreign)).isZero();
    }
    @Test void recoveryPassesBatchBoundaryAndRevisitsEarlierSongs() {
        long owner=user();
        for(int i=0;i<101;i++) song(owner,"MIDI");
        db.update("UPDATE users SET status='WITHDRAWN',withdrawn_at=clock_timestamp() WHERE id=?",owner);
        recovery.recover();
        assertThat(count("SELECT count(*) FROM songs WHERE owner_id=? AND deleted_at IS NOT NULL",owner)).isEqualTo(100);
        recovery.recover();
        assertThat(count("SELECT count(*) FROM songs WHERE owner_id=? AND deleted_at IS NOT NULL",owner)).isEqualTo(101);
        long first=songs.getFirst(), v=version(first);
        String key="sheet/"+v+"/page.png";
        db.update("UPDATE chart_versions SET sheet_pages=?::jsonb WHERE id=?","[{\"imageKey\":\""+key+"\"}]",v);
        recovery.recover();
        assertThat(count("SELECT count(*) FROM file_cleanup_tasks WHERE object_key=?",key)).isEqualTo(1);
        recovery.recover();
    }

}
