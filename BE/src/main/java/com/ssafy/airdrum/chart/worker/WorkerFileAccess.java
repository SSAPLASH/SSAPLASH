package com.ssafy.airdrum.chart.worker;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.UUID;
import java.time.Instant;

import com.ssafy.airdrum.common.error.BusinessException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

@Service
class WorkerFileAccess {
    private final WorkerQueue queue;
    private final WorkerStore store;
    private final JdbcTemplate db;
    private final TransactionTemplate tx;
    WorkerFileAccess(WorkerQueue queue, WorkerStore store, JdbcTemplate db, PlatformTransactionManager manager) {
        this.queue=queue; this.store=store; this.db=db; this.tx=new TransactionTemplate(manager); this.tx.setTimeout(15);
    }
    record Requested(String role, UUID fileId, Long sizeBytes) {}
    record Request(UUID attemptId, List<Requested> files) {}
    record Grant(String role, UUID fileId, String method, String url, Instant expiresAt) {}
    record Response(List<Grant> files) {}
    record Pending(String role, UUID fileId, String method, String key, Long sizeBytes) {}
    record Plan(String stage, List<Pending> files) {}
    Response access(long job, String worker, Request body) {
        if(body.attemptId()==null || body.files()==null || body.files().isEmpty() || body.files().size()>3)
            throw new BusinessException(WorkerError.INVALID);
        var entries=tx.execute(s -> {
            var state=queue.lock(job,false);
            if(state==null || !(state.status().equals("SEPARATING") || state.status().equals("TRANSCRIBING"))) throw WorkerQueue.conflict();
            queue.valid(job,body.attemptId(),worker,state.status());
            var roles=new HashSet<String>(); var result=new ArrayList<Pending>();
            for(var f:body.files()) {
                if(f==null || f.role()==null || !roles.add(f.role())) throw new BusinessException(WorkerError.INVALID);
                if ((state.status().equals("SEPARATING") && f.role().equals("SOURCE_AUDIO")) ||
                        (state.status().equals("TRANSCRIBING") && f.role().equals("DRUM_STEM"))) {
                    var assigned=queue.assignment(job,body.attemptId()).input();
                    if(f.fileId()==null || !f.fileId().equals(assigned.fileId()) || !f.role().equals(assigned.role())) throw WorkerQueue.conflict();
                    String key=state.status().equals("SEPARATING")
                            ? db.queryForObject("SELECT source_key FROM chart_jobs WHERE id=?",String.class,job)
                            : db.queryForObject("SELECT drum_stem_key FROM chart_jobs WHERE id=?",String.class,job);
                    result.add(new Pending(f.role(),f.fileId(),"GET",key,null));
                } else if(state.status().equals("SEPARATING") && (f.role().equals("DRUM_STEM") || f.role().equals("ACCOMPANIMENT"))) {
                    if(f.sizeBytes()==null || f.sizeBytes()<=0 || f.sizeBytes()>128L*1024*1024) throw new BusinessException(WorkerError.INVALID);
                    String role=f.role().equals("DRUM_STEM")?"STAGING_DRUM":"STAGING_ACCOMPANIMENT";
                    var existing=db.query("SELECT id FROM chart_worker_files WHERE job_id=? AND attempt_id=? AND role=?",(r,n)->r.getObject(1,UUID.class),job,body.attemptId(),role);
                    UUID id=f.fileId()!=null?f.fileId():(existing.isEmpty()?UUID.randomUUID():existing.getFirst());
                    boolean create=existing.isEmpty() && f.fileId()==null;
                    String key="worker-staging/"+job+"/"+body.attemptId()+"/"+id+".flac";
                    if(create) {
                        db.update("INSERT INTO chart_worker_files(id,job_id,attempt_id,role,object_key,content_type,size_bytes) VALUES(?,?,?,?,?,'audio/flac',?)",id,job,body.attemptId(),role,key,f.sizeBytes());
                        db.update("INSERT INTO file_cleanup_tasks(object_key,file_role,user_id,job_id,attempt_id,next_attempt_at) VALUES(?,'STAGING',?,?,?,clock_timestamp()+interval '5 minutes') ON CONFLICT(object_key) DO NOTHING",key,state.userId(),job,body.attemptId());
                    } else {
                        Boolean owned=db.queryForObject("SELECT EXISTS(SELECT 1 FROM chart_worker_files WHERE id=? AND job_id=? AND attempt_id=? AND role=? AND object_key=? AND size_bytes=?)",Boolean.class,id,job,body.attemptId(),role,key,f.sizeBytes());
                        if(!Boolean.TRUE.equals(owned)) throw WorkerQueue.conflict();
                    }
                    result.add(new Pending(f.role(),id,"PUT",key,f.sizeBytes()));
                } else throw new BusinessException(WorkerError.INVALID);
            }
            return new Plan(state.status(),List.copyOf(result));
        });
        var grants=new ArrayList<Grant>();
        for(var f:entries.files()) {
            if(f.method().equals("GET") && !store.exists(WorkerStore.Bucket.AUDIO,f.key())) {
                queue.inputUnavailable(job,worker,body.attemptId());
                throw WorkerQueue.conflict();
            }
            var signed=f.method().equals("GET") ? store.signGet(WorkerStore.Bucket.AUDIO,f.key()) : store.signPut(f.key(),f.sizeBytes());
            grants.add(new Grant(f.role(),f.fileId(),f.method(),signed.url(),signed.expiresAt()));
        }
        tx.executeWithoutResult(s -> queue.valid(job,body.attemptId(),worker,entries.stage()));
        return new Response(List.copyOf(grants));
    }
}
