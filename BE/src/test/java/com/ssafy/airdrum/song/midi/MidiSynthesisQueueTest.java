package com.ssafy.airdrum.song.midi;

import static org.assertj.core.api.Assertions.assertThat;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.annotation.Transactional;

@SpringBootTest(properties={"midi.test.isolated=true","spring.datasource.hikari.schema=public"})
@Transactional
class MidiSynthesisQueueTest {
    @Autowired JdbcTemplate db;
    @Autowired PlatformTransactionManager manager;
    @Autowired javax.sql.DataSource dataSource;
    MidiSynthesisQueue queue;
    long user,song,job;
    UUID original;

    @BeforeEach void setup() {
        queue=new MidiSynthesisQueue(db,manager);
        user=db.queryForObject("INSERT INTO users(nickname) VALUES('MIDI queue') RETURNING id",Long.class);
        song=db.queryForObject("INSERT INTO songs(owner_id,title,source,duration_ms) VALUES(?,'test','MIDI',1000) RETURNING id",Long.class,user);
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
    @Test void expiredAttemptCannotHeartbeatOrAttachAndNewAttemptCompletes() {
        var first=queue.claim();
        assertThat(first).isNotNull();
        String oldKey=queue.reserveOutput(first);
        assertThat(queue.heartbeat(first)).isTrue();
        db.update("UPDATE midi_accompaniment_jobs SET lease_expires_at=clock_timestamp()-interval '1 second' WHERE id=?",job);
        assertThat(queue.heartbeat(first)).isFalse();
        assertThat(queue.complete(first,oldKey)).isFalse();
        assertThat(queue.claim()).isNull();
        db.update("UPDATE midi_accompaniment_jobs SET next_attempt_at=clock_timestamp() WHERE id=?",job);
        var second=queue.claim();
        assertThat(second).isNotNull();
        assertThat(second.attempt()).isNotEqualTo(first.attempt());
        assertThat(second.attemptNumber()).isEqualTo(2);
        var key=queue.reserveOutput(second);
        assertThat(queue.complete(second,key)).isTrue();
        assertThat(db.queryForObject("SELECT status FROM midi_accompaniment_jobs WHERE id=?",String.class,job)).isEqualTo("DONE");
        assertThat(db.queryForObject("SELECT accompaniment_key FROM songs WHERE id=?",String.class,song)).isEqualTo(key);
    }
    @Test void failedRegenerationKeepsExistingBackingAndMaximumAttemptsPersist() {
        String old="accompaniment/"+song+".flac";
        db.update("UPDATE songs SET accompaniment_key=? WHERE id=?",old,song);
        for (int i=1;i<=3;i++) {
            var c=queue.claim();
            assertThat(c).isNotNull(); assertThat(c.attemptNumber()).isEqualTo(i);
            queue.fail(c,true,"ERROR");
            db.update("UPDATE midi_accompaniment_jobs SET next_attempt_at=clock_timestamp() WHERE id=?",job);
        }
        assertThat(db.queryForObject("SELECT status FROM midi_accompaniment_jobs WHERE id=?",String.class,job)).isEqualTo("FAILED");
        assertThat(db.queryForObject("SELECT accompaniment_key FROM songs WHERE id=?",String.class,song)).isEqualTo(old);
    }
    @Test void twentyFourHourQueueLimitExpiresWithoutClearingExistingBacking() {
        String old="accompaniment/"+song+".flac";
        db.update("UPDATE songs SET accompaniment_key=? WHERE id=?",old,song);
        db.update("UPDATE midi_accompaniment_jobs SET created_at=clock_timestamp()-interval '24 hours 1 second',next_attempt_at=clock_timestamp()+interval '1 hour' WHERE id=?",job);
        assertThat(queue.claim()).isNull();
        assertThat(db.queryForObject("SELECT status FROM midi_accompaniment_jobs WHERE id=?",String.class,job)).isEqualTo("FAILED");
        assertThat(db.queryForObject("SELECT accompaniment_key FROM songs WHERE id=?",String.class,song)).isEqualTo(old);
    }
    @Test void isolatedPoolRestoresPublicSchemaWhenConnectionIsReused() throws Exception {
        int before;
        try (var c=dataSource.getConnection(); var s=c.createStatement(); var rows=s.executeQuery("SELECT pg_backend_pid()")) {
            rows.next(); before=rows.getInt(1); c.setSchema("pg_catalog");
        }
        try (var c=dataSource.getConnection(); var s=c.createStatement(); var rows=s.executeQuery("SELECT pg_backend_pid(),current_schema()")) {
            rows.next(); assertThat(rows.getInt(1)).isEqualTo(before); assertThat(rows.getString(2)).isEqualTo("public");
        }
    }
    @Test void resynthesisDryRunIsReadOnlyAndApplyRejectsDuplicate() {
        db.update("DELETE FROM midi_accompaniment_jobs WHERE id=?",job);
        long chart=db.queryForObject("INSERT INTO charts(song_id,difficulty) VALUES(?,'HARD') RETURNING id",Long.class,song);
        db.update("""
                INSERT INTO chart_versions(chart_id,version,notes,timing,notation_status,note_count,generator)
                VALUES(?,1,'[]'::jsonb,'{}'::jsonb,'PENDING',0,'MIDI_RULE')
                """,chart);
        byte[] melody=MidiFixtures.ppq(480).drum(0,36).note(480,0,60,100,120).bytes();
        var store=new MidiOriginalStore() {
            public void putAndVerify(String key,byte[] data,String sha) { throw new UnsupportedOperationException(); }
            public byte[] get(String key,int size,String sha,long deadline) { return melody; }
            public boolean exists(String key) { return true; }
            public void delete(String key) { throw new UnsupportedOperationException(); }
        };
        var cli=new MidiResynthesis(db,manager,store);
        var stream=new java.io.ByteArrayOutputStream();
        var output=new java.io.PrintStream(stream);
        assertThat(cli.run(new String[]{Long.toString(song)},output)).isZero();
        assertThat(db.queryForObject("SELECT count(*) FROM midi_accompaniment_jobs WHERE song_id=?",Integer.class,song)).isZero();
        assertThat(cli.run(new String[]{"--apply",Long.toString(song)},output)).isZero();
        assertThat(cli.run(new String[]{"--apply",Long.toString(song)},output)).isZero();
        assertThat(db.queryForObject("SELECT count(*) FROM midi_accompaniment_jobs WHERE song_id=?",Integer.class,song)).isEqualTo(1);
        assertThat(stream.toString()).contains("DRY_RUN","QUEUED","SKIPPED");
    }
}
