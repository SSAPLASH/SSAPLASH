package com.ssafy.airdrum.chart.worker;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

import com.ssafy.airdrum.common.error.BusinessException;
import java.util.*;
import org.junit.jupiter.api.*;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import tools.jackson.databind.json.JsonMapper;

@SpringBootTest(properties={"auth.jwt.secret=test-only-jwt-secret-0123456789ab","auth.refresh-token.store=memory",
    "chart.worker.credentials=worker1=01234567890123456789012345678901,worker2=abcdefghijklmnopqrstuvwxyzABCDEF",
    "chart.worker.recovery-interval-ms=86400000","chart.worker.cleanup-interval-ms=86400000"})
class WorkerCleanupAndSchemaTest {
    static final String HASH="a".repeat(64);
    @Autowired JdbcTemplate db;
    @Autowired WorkerQueue queue;
    @Autowired WorkerResults results;
    @Autowired WorkerPayload payload;
    @Autowired WorkerCleanup cleanup;
    @Autowired JsonMapper json;
    @MockitoBean S3WorkerStore store;
    long user,song,job; UUID attempt;

    @BeforeEach void setup() {
        user=db.queryForObject("INSERT INTO users(nickname) VALUES ('worker test') RETURNING id",Long.class);
        song=db.queryForObject("INSERT INTO songs(owner_id,title,source,status,duration_ms) VALUES(?,'song','AUDIO','PROCESSING',60000) RETURNING id",Long.class,user);
        String source="source-audio/test-"+UUID.randomUUID();
        job=db.queryForObject("INSERT INTO chart_jobs(song_id,user_id,source_key,idempotency_key,request_hash) VALUES(?,?,?,?,?) RETURNING id",Long.class,song,user,source,UUID.randomUUID().toString(),HASH);
        db.update("INSERT INTO audio_uploads(id,user_id,job_id,object_key,content_type,size_bytes,sha256,duration_ms,status,expires_at) VALUES(?,?,?,?,'audio/wav',100,?,60000,'ACCEPTED',now()+interval '1 hour')",UUID.randomUUID(),user,job,source,HASH);
        attempt=queue.claim("worker1",UUID.randomUUID()).attemptId();
    }
    @AfterEach void clean() {
        db.update("DELETE FROM chart_job_results WHERE job_id=?",job);
        db.update("DELETE FROM file_cleanup_tasks WHERE job_id=? OR user_id=?",job,user);
        db.update("DELETE FROM chart_worker_files WHERE job_id=?",job);
        db.update("DELETE FROM audio_uploads WHERE user_id=?",user);
        db.update("UPDATE chart_jobs SET status='FAILED',finished_at=coalesce(finished_at,now()),current_attempt_id=NULL WHERE id=?",job);
        db.update("DELETE FROM chart_job_attempts WHERE job_id=?",job);
        db.update("DELETE FROM chart_jobs WHERE id=?",job);
        db.update("DELETE FROM chart_versions WHERE chart_id IN (SELECT id FROM charts WHERE song_id=?)",song);
        db.update("DELETE FROM charts WHERE song_id=?",song);
        db.update("DELETE FROM songs WHERE id=?",song);
        db.update("DELETE FROM users WHERE id=?",user);
    }
    void transcribing() { db.update("UPDATE chart_jobs SET status='TRANSCRIBING',resume_stage='TRANSCRIBING' WHERE id=?",job); }
    Map<String,Object> envelope(Object result) {
        var tree=json.valueToTree(result);
        return Map.of("contractVersion",1,"jobId",job,"attemptId",attempt,"resultId",UUID.randomUUID(),"payloadHash",payload.hash(tree),"result",result);
    }
    Map<String,Object> chart(List<Map<String,Object>> notes, Map<String,Object> timing, String notationStatus) {
        return Map.of("schemaVersion",1,"generator","ADT_MODEL","generatorVersion","fixture-v1","metrics",Map.of("durationMs",1),
                "charts",List.of(Map.of("difficulty","NORMAL","notationStatus",notationStatus,"notes",notes,"timing",timing)));
    }
    @Test void allEightPadsAreAccepted() {
        transcribing();
        var pads=List.of("KICK","SNARE","HIHAT","SMALL_TOM","MID_TOM","FLOOR_TOM","CRASH","RIDE");
        var notes=new ArrayList<Map<String,Object>>();
        for (int i=0;i<pads.size();i++) notes.add(Map.of("noteId","n"+i,"timeMs",i*100,"pad",pads.get(i)));
        var receipt=results.transcription(job,"worker1",json.valueToTree(envelope(chart(notes,Map.of("bpm",120,"offsetMs",0,"timeSignature","4/4"),"UNAVAILABLE"))));
        assertThat(receipt.jobStatus()).isEqualTo("DONE");
        assertThat(db.queryForObject("SELECT note_count FROM chart_versions WHERE id=?",Integer.class,receipt.chartVersionIds().getFirst())).isEqualTo(8);
    }
    @ParameterizedTest @ValueSource(strings={"pad","ppq","tempo","notation"})
    void rejectsUnknownPadAndIncompleteReadySchema(String kind) {
        transcribing();
        Map<String,Object> notation=kind.equals("notation")?Map.of("tick",0,"durationTicks",0,"voice",1):Map.of("tick",0,"durationTicks",120,"voice",1);
        Map<String,Object> note=Map.of("noteId","n1","timeMs",0,"pad",kind.equals("pad")?"UNKNOWN":"SNARE","notation",notation);
        Map<String,Object> timing=new HashMap<>(Map.of("bpm",120,"offsetMs",0,"timeSignature","4/4","ppq",480,
                "tempoMap",List.of(Map.of("tick",0,"bpm",120)),"timeSignatureMap",List.of(Map.of("tick",0,"numerator",4,"denominator",4))));
        if(kind.equals("ppq")) timing.remove("ppq");
        if(kind.equals("tempo")) timing.put("tempoMap",List.of());
        var body=envelope(chart(List.of(note),timing,"READY"));
        assertThatThrownBy(() -> results.transcription(job,"worker1",json.valueToTree(body)))
                .isInstanceOf(BusinessException.class).satisfies(e -> assertThat(((BusinessException)e).getErrorCode()).isEqualTo(WorkerError.RESULT_INVALID));
        assertThat(db.queryForObject("SELECT status FROM chart_jobs WHERE id=?",String.class,job)).isEqualTo("FAILED");
        assertThat(db.queryForObject("SELECT count(*) FROM chart_versions v JOIN charts c ON c.id=v.chart_id WHERE c.song_id=?",Integer.class,song)).isZero();
    }
    @Test void lateStagingPutIsDeletedAgainAndRawTasksRemainUntouched() {
        db.update("UPDATE chart_job_attempts SET finished_at=clock_timestamp() WHERE id=?",attempt);
        db.update("UPDATE chart_jobs SET status='FAILED',finished_at=clock_timestamp() WHERE id=?",job);
        String staging="staging-test/"+UUID.randomUUID(), raw="raw-test/"+UUID.randomUUID();
        db.update("INSERT INTO file_cleanup_tasks(object_key,file_role,user_id,job_id,attempt_id) VALUES(?,'STAGING',?,?,?),(?,'RAW_LOG',?,?,?)",staging,user,job,attempt,raw,user,job,attempt);
        when(store.exists(WorkerStore.Bucket.AUDIO,staging)).thenReturn(false,true);
        cleanup.runOnce();
        assertThat(db.queryForObject("SELECT status FROM file_cleanup_tasks WHERE object_key=?",String.class,staging)).isEqualTo("DELETED");
        verify(store,never()).delete(any(),eq(staging));
        db.update("UPDATE file_cleanup_tasks SET next_attempt_at=clock_timestamp() WHERE object_key=?",staging);
        cleanup.runOnce();
        verify(store,times(1)).delete(WorkerStore.Bucket.AUDIO,staging);
        verify(store,never()).exists(any(),eq(raw));
        assertThat(db.queryForObject("SELECT status FROM file_cleanup_tasks WHERE object_key=?",String.class,raw)).isEqualTo("PENDING");
        assertThat(db.queryForObject("SELECT status FROM file_cleanup_tasks WHERE object_key=?",String.class,staging)).isEqualTo("DELETED");
    }
    @Test void sheetCleanupRetriesFailureAndProtectsActiveReferences() {
        long chart=db.queryForObject("INSERT INTO charts(song_id,difficulty) VALUES(?,'EASY') RETURNING id",Long.class,song);
        long version=db.queryForObject("INSERT INTO chart_versions(chart_id,version,notes,timing,notation_status,note_count,generator) VALUES(?,1,'[]','{}','READY',0,'MANUAL') RETURNING id",Long.class,chart);
        String key="sheet/"+version+"/page.png";
        db.update("UPDATE chart_versions SET sheet_pages=?::jsonb WHERE id=?","[{\"imageKey\":\""+key+"\"}]",version);
        db.update("INSERT INTO file_cleanup_tasks(object_key,file_role,user_id) VALUES(?,'SHEET_PAGE',?)",key,user);
        cleanup.runOnce();
        verify(store,never()).exists(WorkerStore.Bucket.SHEET,key);
        db.update("UPDATE songs SET deleted_at=clock_timestamp() WHERE id=?",song);
        when(store.exists(WorkerStore.Bucket.SHEET,key)).thenThrow(new IllegalStateException()).thenReturn(true);
        cleanup.runOnce();
        assertThat(db.queryForObject("SELECT status FROM file_cleanup_tasks WHERE object_key=?",String.class,key)).isEqualTo("FAILED");
        db.update("UPDATE file_cleanup_tasks SET next_attempt_at=clock_timestamp() WHERE object_key=?",key);
        cleanup.runOnce();
        verify(store).delete(WorkerStore.Bucket.SHEET,key);
        assertThat(db.queryForObject("SELECT status FROM file_cleanup_tasks WHERE object_key=?",String.class,key)).isEqualTo("DELETED");
    }

    @Test void builtinSheetReferenceIsProtected() {
        long builtin=db.queryForObject("INSERT INTO songs(title,source,license) VALUES('builtin','BUILTIN','test') RETURNING id",Long.class);
        try {
            long chart=db.queryForObject("INSERT INTO charts(song_id,difficulty) VALUES(?,'EASY') RETURNING id",Long.class,builtin);
            long version=db.queryForObject("INSERT INTO chart_versions(chart_id,version,notes,timing,notation_status,note_count,generator) VALUES(?,1,'[]','{}','READY',0,'BUILTIN') RETURNING id",Long.class,chart);
            String key="sheet/"+version+"/page.png";
            db.update("UPDATE chart_versions SET sheet_pages=?::jsonb WHERE id=?","[{\"imageKey\":\""+key+"\"}]",version);
            db.update("INSERT INTO file_cleanup_tasks(object_key,file_role,user_id) VALUES(?,'SHEET_PAGE',?)",key,user);
            String backing="accompaniment/"+builtin+".wav";
            db.update("UPDATE songs SET accompaniment_key=? WHERE id=?",backing,builtin);
            db.update("INSERT INTO file_cleanup_tasks(object_key,file_role,user_id) VALUES(?,'ACCOMPANIMENT',?)",backing,user);
            cleanup.runOnce();
            verify(store,never()).exists(WorkerStore.Bucket.ACCOMPANIMENT,backing);
            assertThat(db.queryForObject("SELECT status FROM file_cleanup_tasks WHERE object_key=?",String.class,backing)).isEqualTo("PENDING");
            verify(store,never()).exists(WorkerStore.Bucket.SHEET,key);
            assertThat(db.queryForObject("SELECT status FROM file_cleanup_tasks WHERE object_key=?",String.class,key)).isEqualTo("PENDING");
        } finally {
            db.update("DELETE FROM chart_versions WHERE chart_id IN (SELECT id FROM charts WHERE song_id=?)",builtin);
            db.update("DELETE FROM charts WHERE song_id=?",builtin);
            db.update("DELETE FROM songs WHERE id=?",builtin);
        }
    }

}
