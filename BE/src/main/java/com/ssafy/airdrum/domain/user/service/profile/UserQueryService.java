package com.ssafy.airdrum.domain.user.service.profile;

import java.util.Optional;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.annotation.Propagation;
import com.ssafy.airdrum.domain.user.model.UserStatus;
import com.ssafy.airdrum.domain.user.model.AuthUser;
import com.ssafy.airdrum.global.error.BusinessException;
import com.ssafy.airdrum.global.error.CommonErrorCode;
import com.ssafy.airdrum.domain.user.dto.ConsentsResponse;
import com.ssafy.airdrum.domain.user.dto.DataConsentResponse;
import com.ssafy.airdrum.domain.user.dto.UserMeResponse;
import com.ssafy.airdrum.domain.user.entity.SocialAccount;
import com.ssafy.airdrum.domain.user.model.ConsentRecord;
import com.ssafy.airdrum.domain.user.repository.SocialAccountRepository;
import com.ssafy.airdrum.domain.user.repository.UserRepository;

/** 회원 정보 및 활성 상태 조회. */
@Service
public class UserQueryService {

	private final UserRepository users;
	private final SocialAccountRepository socialAccounts;

	public UserQueryService(UserRepository users, SocialAccountRepository socialAccounts) {
		this.users = users;
		this.socialAccounts = socialAccounts;
	}

	/** 양수 ID의 현재 ACTIVE 여부를 DB에서 확인한다. */
	public boolean isActive(long userId) {
		return userId > 0 && users.isActive(userId);
	}

	/** ACTIVE 회원의 현재 권한과 가입 상태를 한 번의 조회로 반환한다. */
	public Optional<AuthUser> findActiveAuthUser(long userId) {
		return users.findActiveAuthUser(userId);
	}

	/** 호출자의 트랜잭션이 끝날 때까지 회원 공유 잠금을 유지하고 ACTIVE를 확인한다. */
	@Transactional(propagation = Propagation.MANDATORY)
	public void requireActiveForShare(long userId) {
		if (!lockAndCheckActive(userId))
			throw new BusinessException(CommonErrorCode.UNAUTHORIZED);
	}

	/** 호출자 트랜잭션에서 회원 공유 잠금을 얻고 활성 상태를 반환한다. */
	@Transactional(propagation = Propagation.MANDATORY)
	public boolean lockAndCheckActive(long userId) {
		var user = users.findByIdForShare(userId);
		return user.isPresent() && user.get().getStatus() == UserStatus.ACTIVE;
	}

	/**
	 * 인증이 ACTIVE를 이미 확인한 회원의 정보를 조회한다.
	 * @throws IllegalStateException 인증된 회원의 행이나 소셜 연동이 없을 때(데이터 불변식 위반, 500)
	 */
	@Transactional(readOnly = true)
	public UserMeResponse me(long userId) {
		var user = users.findById(userId)
				.orElseThrow(() -> new IllegalStateException("인증된 회원 " + userId + "의 행이 없습니다."));
		var provider = socialAccounts.findByUserIdOrderByConnectedAtAsc(userId).stream()
				.findFirst()
				.map(SocialAccount::getProvider)
				.orElseThrow(() -> new IllegalStateException("회원 " + userId + "의 소셜 연동이 없습니다."));
		return new UserMeResponse(user.getId(), provider, user.getNickname(), user.getProfileImageUrl(),
				user.getRole(), user.getCreatedAt(), user.getUpdatedAt(), user.isSignupCompleted(),
				new ConsentsResponse(ConsentRecord.of(user.getTermsVersion(), user.getTermsAgreedAt()),
						ConsentRecord.of(user.getPrivacyVersion(), user.getPrivacyAgreedAt())),
				new DataConsentResponse(user.getDataConsent(), user.getDataConsentVersion(), user.getDataConsentAt()));
	}

}
