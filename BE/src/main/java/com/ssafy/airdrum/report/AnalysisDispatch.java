package com.ssafy.airdrum.report;

import java.util.UUID;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
import jakarta.annotation.PreDestroy;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.dao.RecoverableDataAccessException;
import org.springframework.dao.TransientDataAccessException;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.transaction.event.TransactionalEventListener;

@Component
@ConditionalOnProperty(name="report.analysis.dispatch-enabled",havingValue="true",matchIfMissing=true)
public class AnalysisDispatch {
    private static final Logger log=LoggerFactory.getLogger(AnalysisDispatch.class);
    private final AnalysisRepository repository;
    private final AnalysisClient client;
    private final ThreadPoolExecutor executor=new ThreadPoolExecutor(2,2,0,TimeUnit.SECONDS,
        new ArrayBlockingQueue<>(64),r -> { var thread=new Thread(r,"report-analysis"); thread.setDaemon(true); return thread; });
    public AnalysisDispatch(AnalysisRepository repository,AnalysisClient client) { this.repository=repository; this.client=client; }
    @TransactionalEventListener
    public void afterCommit(AnalysisRequested event) { submit(event.playId()); }
    @Scheduled(fixedDelayString="${report.analysis.recovery-interval-ms:10000}",initialDelayString="${report.analysis.recovery-interval-ms:10000}")
    public void recover() {
        try { for(UUID id:repository.recoverable()) submit(id); }
        catch(RuntimeException ex) { log.warn("weak-segments recovery failed: {}",ex.getClass().getSimpleName()); }
    }
    private void submit(UUID id) {
        try { executor.execute(() -> process(id)); }
        catch(RejectedExecutionException ignored) { /* PENDING은 다음 복구 주기에 다시 확인한다. */ }
    }
    private void process(UUID id) {
        AnalysisRepository.Lease lease=null;
        try {
            lease=repository.claim(id);
            if(lease==null) return;
            var request=repository.request(id);
            if(request==null) { repository.failure(lease,false); return; }
            var result=client.analyze(request);
            if(result.success()) repository.done(lease,result.segments(),result.version());
            else {
                repository.failure(lease,result.retryable());
            }
        } catch(RuntimeException ex) {
            log.warn("weak-segments processing failed: {}",ex.getClass().getSimpleName());
            if(lease!=null) try { repository.failure(lease,ex instanceof TransientDataAccessException || ex instanceof RecoverableDataAccessException); } catch(RuntimeException ignored) { /* 임대 만료 시 복구 */ }
        }
    }
    @PreDestroy public void stop() { executor.shutdown(); }
}
