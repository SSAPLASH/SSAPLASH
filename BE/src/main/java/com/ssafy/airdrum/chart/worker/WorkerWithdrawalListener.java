package com.ssafy.airdrum.chart.worker;

import com.ssafy.airdrum.user.UserWithdrawnEvent;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;
import org.springframework.transaction.event.TransactionPhase;
import org.springframework.transaction.event.TransactionalEventListener;

@Component
class WorkerWithdrawalListener {
    private final WorkerQueue queue;
    WorkerWithdrawalListener(WorkerQueue queue) { this.queue=queue; }
    @TransactionalEventListener(phase=TransactionPhase.AFTER_COMMIT)
    void withdrawn(UserWithdrawnEvent event) {
        try { queue.withdrawn(event.userId()); }
        catch(RuntimeException e) { LoggerFactory.getLogger(WorkerWithdrawalListener.class).warn("탈퇴 회원의 워커 정리 등록이 지연되었습니다."); }
    }
}
