package com.ssafy.airdrum.domain.user.service.profile;

import java.time.Clock;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import com.ssafy.airdrum.domain.user.exception.UserNotActiveException;
import com.ssafy.airdrum.domain.user.model.UserStatus;
import com.ssafy.airdrum.domain.user.repository.SocialAccountRepository;
import com.ssafy.airdrum.domain.user.repository.UserRepository;

/** 탈퇴 트랜잭션에서 회원 상태와 소셜 연동을 정리한다. */
@Service
public class UserWithdrawalService {
	private final UserRepository users;
	private final SocialAccountRepository socialAccounts;
	private final Clock clock;
	public UserWithdrawalService(UserRepository users, SocialAccountRepository socialAccounts, Clock clock) {
		this.users = users; this.socialAccounts = socialAccounts; this.clock = clock;
	}
	@Transactional(propagation = Propagation.MANDATORY)
	public void withdraw(long userId) {
		var user = users.findByIdForUpdate(userId)
				.orElseThrow(() -> new IllegalStateException("인증을 통과한 회원 " + userId + "의 행이 없습니다."));
		if (user.getStatus() != UserStatus.ACTIVE) throw new UserNotActiveException(userId);
		user.withdraw(clock.instant());
		// 벌크 삭제가 먼저 flush하므로 상태 전이도 DB에 반영된다.
		socialAccounts.deleteAllByUserId(userId);
	}
}
