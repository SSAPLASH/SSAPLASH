package com.ssafy.airdrum.lesson;

import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;
import org.springframework.transaction.event.TransactionPhase;
import org.springframework.transaction.event.TransactionalEventListener;

import com.ssafy.airdrum.user.UserWithdrawnEvent;

/** 탈퇴 커밋 뒤 그 회원의 알아보기 레슨 완료 기록을 지운다(331번 설계 U5). 다음 스테이지를 여는 용도뿐이라 남길 이유가 없다. */
@Component
class LessonWithdrawalListener {
	private final LessonRepository lessons;

	LessonWithdrawalListener(LessonRepository lessons) {
		this.lessons = lessons;
	}

	@TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
	void withdrawn(UserWithdrawnEvent event) {
		try {
			lessons.deleteCompletions(event.userId());
		} catch (RuntimeException e) {
			LoggerFactory.getLogger(getClass()).warn("탈퇴 레슨 완료 기록 정리 실패 userId={} errorType={}", event.userId(), e.getClass().getSimpleName());
		}
	}
}
