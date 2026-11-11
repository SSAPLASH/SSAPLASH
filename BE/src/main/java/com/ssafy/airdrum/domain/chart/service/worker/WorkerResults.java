package com.ssafy.airdrum.domain.chart.service.worker;

import com.ssafy.airdrum.domain.chart.storage.worker.WorkerStore;
import com.ssafy.airdrum.global.worker.WorkerError;

import java.nio.charset.StandardCharsets;
import java.sql.Timestamp;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

import com.ssafy.airdrum.global.error.BusinessException;
import com.ssafy.airdrum.domain.chart.service.generation.TranscriptionCharts;
import com.ssafy.airdrum.domain.chart.service.generation.TranscriptionSongCompletion;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import tools.jackson.databind.JsonNode;

@Service
public class WorkerResults {
    private final JdbcTemplate db;
    private final TransactionTemplate tx;
    private final WorkerQueue queue;
    private final WorkerStore store;
    private final WorkerPayload payload;
    private final TranscriptionSongCompletion songs;
    private final TranscriptionCharts charts;
    WorkerResults(JdbcTemplate db, PlatformTransactionManager manager, WorkerQueue queue,
            WorkerStore store, WorkerPayload payload, TranscriptionCharts charts, TranscriptionSongCompletion songs) {
        this.db=db; this.tx=new TransactionTemplate(manager); this.tx.setTimeout(15); this.queue=queue;
        this.store=store; this.payload=payload; this.charts=charts; this.songs=songs;
    }
    record Envelope(long jobId,UUID attemptId,UUID resultId,String payloadHash,JsonNode result) {}
    public record Receipt(UUID resultId,boolean accepted,String jobStatus,long revision,List<Long> chartVersionIds) {}
    record Manifest(UUID id,long size,String hash,String key) {}
    record Prepared(WorkerQueue.Lock lock, Manifest drum, Manifest accompaniment) {}
    private BusinessException invalid() { return new BusinessException(WorkerError.RESULT_INVALID); }
    private void require(boolean condition) { if(!condition) throw invalid(); }
    private UUID uuid(JsonNode n,String name) {
        try { return UUID.fromString(n.path(name).asString()); }
        catch(Exception e) { throw new BusinessException(WorkerError.INVALID); }
    }
    private Envelope envelope(long job,JsonNode n) {
        if(!n.path("contractVersion").isIntegralNumber() || !n.path("contractVersion").canConvertToInt() || n.path("contractVersion").asInt()!=1 ||
                !n.path("jobId").isIntegralNumber() || !n.path("jobId").canConvertToLong() || n.path("jobId").asLong()!=job ||
                !n.path("payloadHash").isString() || !n.path("payloadHash").asString().matches("[0-9a-f]{64}") ||
                !n.path("result").isObject()) throw new BusinessException(WorkerError.INVALID);
        return new Envelope(job,uuid(n,"attemptId"),uuid(n,"resultId"),n.path("payloadHash").asString(),n.path("result"));
    }
    private Receipt prior(Envelope e,String worker,String stage,String computed) {
        var rows=db.query("""
             SELECT r.job_id,r.attempt_id,r.stage,r.payload_hash,CAST(r.receipt AS text),a.worker_id,u.status,s.deleted_at IS NOT NULL
             FROM chart_job_results r JOIN chart_job_attempts a ON a.id=r.attempt_id JOIN chart_jobs j ON j.id=r.job_id
             JOIN users u ON u.id=j.user_id JOIN songs s ON s.id=j.song_id WHERE r.result_id=?
             """,(r,n)->new Object[]{r.getLong(1),r.getObject(2,UUID.class),r.getString(3),r.getString(4),r.getString(5),r.getString(6),r.getString(7),r.getBoolean(8)},e.resultId());
        if(rows.isEmpty()) return null;
        var row=rows.getFirst();
        if((long)row[0]!=e.jobId() || !row[1].equals(e.attemptId()) || !row[2].equals(stage) ||
                !row[3].equals(computed) || !row[3].equals(e.payloadHash()) || !row[5].equals(worker) || !"ACTIVE".equals(row[6]) || (boolean)row[7]) throw WorkerQueue.conflict();
        try {
            var parsed=payload.read(new java.io.ByteArrayInputStream(((String)row[4]).getBytes(java.nio.charset.StandardCharsets.UTF_8)));
            var ids=new java.util.ArrayList<Long>(); for(var id:parsed.path("chartVersionIds")) ids.add(id.asLong());
            return new Receipt(e.resultId(),true,parsed.path("jobStatus").asString(),parsed.path("revision").asLong(),List.copyOf(ids));
        } catch(RuntimeException x) { throw new IllegalStateException("저장된 결과 receipt가 올바르지 않습니다."); }
    }
    private Receipt preflight(Envelope e,String worker,String stage,String hash) {
        return tx.execute(s -> {
            var locked=queue.lock(e.jobId(),false);
            if(locked==null || !locked.active() || locked.deleted()) throw WorkerQueue.conflict();
            var old=prior(e,worker,stage,hash); if(old!=null) return old;
            queue.valid(e.jobId(),e.attemptId(),worker,stage);
            if(Boolean.TRUE.equals(db.queryForObject("SELECT EXISTS(SELECT 1 FROM chart_job_results WHERE job_id=? AND stage=?)",Boolean.class,e.jobId(),stage))) throw WorkerQueue.conflict();
            return null;
        });
    }
    private void failValid(Envelope e,String worker,String stage) {
        tx.executeWithoutResult(s -> {
            var l=queue.valid(e.jobId(),e.attemptId(),worker,stage);
            queue.finishFailure(l,"OUTPUT_INVALID");
        });
    }
    private Manifest manifest(Envelope e,JsonNode n,String role) {
        require(n.isObject() && n.path("fileId").isString() && n.path("contentType").isString() && n.path("contentType").asString().equals("audio/flac")
                && n.path("sizeBytes").isIntegralNumber() && n.path("sizeBytes").canConvertToLong() && n.path("sizeBytes").asLong()>0
                && n.path("sizeBytes").asLong()<=128L*1024*1024 && n.path("sha256").isString() && n.path("sha256").asString().matches("[0-9a-f]{64}"));
        UUID id; try { id=UUID.fromString(n.path("fileId").asString()); } catch(Exception x) { throw invalid(); }
        var keys=db.query("SELECT object_key FROM chart_worker_files WHERE id=? AND job_id=? AND attempt_id=? AND role=? AND size_bytes=?",
                (r,i)->r.getString(1),id,e.jobId(),e.attemptId(),role,n.path("sizeBytes").asLong());
        require(keys.size()==1);
        return new Manifest(id,n.path("sizeBytes").asLong(),n.path("sha256").asString(),keys.getFirst());
    }
    private static boolean nonnegative(JsonNode n) { return n.isNumber() && Double.isFinite(n.doubleValue()) && n.doubleValue()>=0; }
    private void separationMetadata(JsonNode n,int duration) {
        require(n.path("durationMs").isIntegralNumber() && n.path("durationMs").canConvertToInt() && n.path("durationMs").asInt()==duration
                && n.path("audioTimeOrigin").isString() && "SOURCE_START".equals(n.path("audioTimeOrigin").asString()));
        var model=n.path("model");
        require(model.isObject() && model.path("name").isString() && "bs_roformer_sw".equals(model.path("name").asString()) && model.path("version").isString()
                && model.path("version").asString().matches("[A-Za-z0-9_.-]{1,100}@[0-9a-f]{12}"));
        var m=n.path("metrics");
        require(m.isObject() && m.path("loadMs").isIntegralNumber() && nonnegative(m.path("loadMs"))
                && m.path("separateMs").isIntegralNumber() && nonnegative(m.path("separateMs"))
                && m.has("peakVramMb") && (m.path("peakVramMb").isNull() || nonnegative(m.path("peakVramMb")))
                && m.has("peakRamMb") && (m.path("peakRamMb").isNull() || nonnegative(m.path("peakRamMb"))));
    }
    public Receipt separation(long job,String worker,JsonNode body) {
        Envelope e=envelope(job,body); String hash=payload.hash(e.result());
        try { return separationImpl(job,worker,e,hash); }
        catch(BusinessException x) {
            if(x.getErrorCode()==WorkerError.CONFLICT) {
                var receipt=replay(e,worker,"SEPARATING",hash); if(receipt!=null) return receipt;
            }
            throw x;
        }
    }
    private Receipt replay(Envelope e,String worker,String stage,String hash) {
        return tx.execute(s -> {
            var locked=queue.lock(e.jobId(),false);
            if(locked==null || !locked.active() || locked.deleted()) throw WorkerQueue.conflict();
            return prior(e,worker,stage,hash);
        });
    }
    private Receipt separationImpl(long job,String worker,Envelope e,String hash) {
        Receipt old=preflight(e,worker,"SEPARATING",hash); if(old!=null) return old;
        Prepared prep;
        try {
            if(!hash.equals(e.payloadHash())) throw invalid();
            prep=tx.execute(s -> {
                var l=queue.valid(job,e.attemptId(),worker,"SEPARATING");
                separationMetadata(e.result(),l.durationMs());
                return new Prepared(l,manifest(e,e.result().path("drumStem"),"STAGING_DRUM"),manifest(e,e.result().path("accompaniment"),"STAGING_ACCOMPANIMENT"));
            });
        } catch(BusinessException x) { if(x.getErrorCode()==WorkerError.RESULT_INVALID) failValid(e,worker,"SEPARATING"); throw x; }
        String drumKey="drum-stem/"+job+"/"+e.attemptId()+"/"+e.resultId()+".flac";
        String accompanimentKey="accompaniment/"+prep.lock().songId()+"/"+e.attemptId()+"/"+e.resultId()+".flac";
        // 복사 전에 정리 대상을 영속화한다. 참조가 없는 객체만 별도 정리 워커가 삭제한다.
        tx.executeWithoutResult(s -> {
            var l=queue.valid(job,e.attemptId(),worker,"SEPARATING");
            db.update("INSERT INTO file_cleanup_tasks(object_key,file_role,user_id,job_id,attempt_id,next_attempt_at) VALUES(?,'DRUM_STEM',?,?,?,clock_timestamp()+interval '5 minutes'),(?,'ACCOMPANIMENT',?,?,?,clock_timestamp()+interval '5 minutes') ON CONFLICT(object_key) DO NOTHING",
                    drumKey,l.userId(),job,e.attemptId(),accompanimentKey,l.userId(),job,e.attemptId());
        });
        try (var drum=store.inspectFlac(prep.drum().key(),prep.drum().size(),prep.drum().hash(),prep.lock().durationMs());
             var backing=store.inspectFlac(prep.accompaniment().key(),prep.accompaniment().size(),prep.accompaniment().hash(),prep.lock().durationMs())) {
            store.promote(drum,WorkerStore.Bucket.AUDIO,drumKey);
            store.promote(backing,WorkerStore.Bucket.ACCOMPANIMENT,accompanimentKey);
        } catch(BusinessException x) { if(x.getErrorCode()==WorkerError.RESULT_INVALID) failValid(e,worker,"SEPARATING"); throw x; }
        return tx.execute(s -> {
            db.queryForObject("SELECT pg_advisory_xact_lock(hashtextextended(?,1))",Object.class,e.resultId().toString());
            var locked=queue.lock(job,false);
            if(locked==null || !locked.active() || locked.deleted()) throw WorkerQueue.conflict();
            Receipt saved=prior(e,worker,"SEPARATING",hash); if(saved!=null) return saved;
            var l=queue.valid(job,e.attemptId(),worker,"SEPARATING");
            if(Boolean.TRUE.equals(db.queryForObject("SELECT EXISTS(SELECT 1 FROM chart_job_results WHERE job_id=? AND stage='SEPARATING')",Boolean.class,job))) throw WorkerQueue.conflict();
            UUID checkpoint=UUID.randomUUID();
            db.update("INSERT INTO chart_worker_files(id,job_id,attempt_id,role,object_key,content_type,size_bytes,sha256) VALUES(?,?,?,'DRUM_STEM',?,'audio/flac',?,?)",checkpoint,job,e.attemptId(),drumKey,prep.drum().size(),prep.drum().hash());
            db.update("UPDATE songs SET accompaniment_key=?,updated_at=clock_timestamp() WHERE id=?",accompanimentKey,l.songId());
            db.update("UPDATE audio_uploads SET status='RETIRED',job_id=NULL,retired_at=clock_timestamp(),updated_at=clock_timestamp() WHERE job_id=? AND status='ACCEPTED'",job);
            db.update("INSERT INTO file_cleanup_tasks(object_key,file_role,user_id,job_id,attempt_id) SELECT source_key,'SOURCE',user_id,id,current_attempt_id FROM chart_jobs WHERE id=? AND source_key IS NOT NULL ON CONFLICT(object_key) DO NOTHING",job);
            Long revision=db.queryForObject("UPDATE chart_jobs SET status='TRANSCRIBING',resume_stage='TRANSCRIBING',source_key=NULL,drum_stem_key=?,separation_model=?,separation_model_version=?,metrics=?::jsonb,progress=50,stage_deadline_at=clock_timestamp()+(2*?+60000)*interval '1 millisecond',revision=revision+1 WHERE id=? RETURNING revision",Long.class,drumKey,e.result().path("model").path("name").asString(),e.result().path("model").path("version").asString(),payload.write(e.result().path("metrics")),l.durationMs(),job);
            var receipt=new Receipt(e.resultId(),true,"TRANSCRIBING",revision,List.of());
            save(e,"SEPARATING",receipt);
            return receipt;
        });
    }
    private void save(Envelope e,String stage,Receipt receipt) {
        db.update("INSERT INTO chart_job_results(result_id,job_id,attempt_id,stage,payload_hash,receipt) VALUES(?,?,?,?,?,?::jsonb)",e.resultId(),e.jobId(),e.attemptId(),stage,e.payloadHash(),payload.write(receipt));
    }
    public Receipt transcription(long job,String worker,JsonNode body) {
        Envelope e=envelope(job,body); String hash=payload.hash(e.result());
        try { return transcriptionImpl(job,worker,e,hash); }
        catch(BusinessException x) {
            if(x.getErrorCode()==WorkerError.CONFLICT) {
                var receipt=replay(e,worker,"TRANSCRIBING",hash); if(receipt!=null) return receipt;
            }
            throw x;
        }
    }
    private Receipt transcriptionImpl(long job,String worker,Envelope e,String hash) {
        Receipt old=preflight(e,worker,"TRANSCRIBING",hash); if(old!=null) return old;
        TranscriptionCharts.ChartData chart;
        try {
            if(!hash.equals(e.payloadHash())) throw invalid();
            var l=tx.execute(s->queue.valid(job,e.attemptId(),worker,"TRANSCRIBING"));
            try { chart=charts.parse(e.result(),l.durationMs()); }
            catch(TranscriptionCharts.InvalidChart x) { throw invalid(); }
        } catch(BusinessException x) { if(x.getErrorCode()==WorkerError.RESULT_INVALID) failValid(e,worker,"TRANSCRIBING"); throw x; }
        return tx.execute(s -> {
            db.queryForObject("SELECT pg_advisory_xact_lock(hashtextextended(?,1))",Object.class,e.resultId().toString());
            var locked=queue.lock(job,false);
            if(locked==null || !locked.active() || locked.deleted()) throw WorkerQueue.conflict();
            Receipt saved=prior(e,worker,"TRANSCRIBING",hash); if(saved!=null) return saved;
            var l=queue.valid(job,e.attemptId(),worker,"TRANSCRIBING");
            if(Boolean.TRUE.equals(db.queryForObject("SELECT EXISTS(SELECT 1 FROM chart_job_results WHERE job_id=? AND stage='TRANSCRIBING')",Boolean.class,job))) throw WorkerQueue.conflict();
            var versionIds=new ArrayList<Long>();
            for (String difficulty:List.of("HARD","NORMAL","EASY")) {
                Long chartId=db.queryForObject("INSERT INTO charts(song_id,difficulty) VALUES(?,?) RETURNING id",Long.class,l.songId(),difficulty);
                String selectedNotes=switch(difficulty) { case "HARD" -> chart.notes(); case "NORMAL" -> chart.normalNotes(); default -> chart.easyNotes(); };
                int selectedCount=switch(difficulty) { case "HARD" -> chart.noteCount(); case "NORMAL" -> chart.normalCount(); default -> chart.easyCount(); };
                String version=difficulty.equals("HARD") ? chart.generatorVersion() : TranscriptionCharts.derivedVersion(chart.generatorVersion());
                versionIds.add(db.queryForObject("INSERT INTO chart_versions(chart_id,version,schema_version,notes,timing,notation_status,note_count,generator,generator_version) VALUES(?,1,1,?::jsonb,?::jsonb,?,?,'ADT_MODEL',?) RETURNING id",Long.class,chartId,selectedNotes,chart.timing(),chart.notationStatus(),selectedCount,version));
            }
            songs.complete(l.songId(),chart.bpm(),chart.offset(),chart.timeSignature());
            db.update("UPDATE chart_job_attempts SET finished_at=clock_timestamp() WHERE id=?",e.attemptId());
            queue.cleanupInputs(l);
            Long revision=db.queryForObject("UPDATE chart_jobs SET status='DONE',progress=100,transcription_model='ADT_MODEL',metrics=jsonb_build_object('separation',metrics,'transcription',?::jsonb),finished_at=clock_timestamp(),revision=revision+1 WHERE id=? RETURNING revision",Long.class,chart.metrics(),job);
            var receipt=new Receipt(e.resultId(),true,"DONE",revision,List.copyOf(versionIds));
            save(e,"TRANSCRIBING",receipt);
            return receipt;
        });
    }
}
