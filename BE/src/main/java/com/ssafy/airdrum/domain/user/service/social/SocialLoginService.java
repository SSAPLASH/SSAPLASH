package com.ssafy.airdrum.domain.user.service.social;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import com.ssafy.airdrum.domain.user.entity.SocialAccount;
import com.ssafy.airdrum.domain.user.entity.User;
import com.ssafy.airdrum.domain.user.exception.UserNotActiveException;
import com.ssafy.airdrum.domain.user.model.AdminEmailWhitelist;
import com.ssafy.airdrum.domain.user.model.SocialProfile;
import com.ssafy.airdrum.domain.user.model.UserRole;
import com.ssafy.airdrum.domain.user.model.UserStatus;
import com.ssafy.airdrum.domain.user.repository.SocialAccountRepository;
import com.ssafy.airdrum.domain.user.repository.UserRepository;

/**
 * 소셜 프로필로 회원을 찾거나 만들고, 로그인마다 역할을 다시 정한다(설계 문서 3-7·4-D).
 *
 * <p>같은 계정의 최초 로그인이 겹치면 늦은 쪽이 유일 제약에 걸린다. PostgreSQL은 제약 위반 뒤 같은 트랜잭션을
 * 쓸 수 없으므로, 트랜잭션을 직접 나눠 새 트랜잭션에서 한 번 더 조회한다.
 */
@Service
public class SocialLoginService {

	private static final Logger log = LoggerFactory.getLogger(SocialLoginService.class);

	static final String DEFAULT_NICKNAME = "사용자";
	static final int NICKNAME_MAX_LENGTH = 30;
	static final int PROFILE_IMAGE_URL_MAX_LENGTH = 500;

	private final UserRepository users;
	private final SocialAccountRepository socialAccounts;
	private final AdminEmailWhitelist adminWhitelist;
	private final TransactionTemplate transaction;

	public SocialLoginService(UserRepository users, SocialAccountRepository socialAccounts,
			AdminEmailWhitelist adminWhitelist, PlatformTransactionManager transactionManager) {
		this.users = users;
		this.socialAccounts = socialAccounts;
		this.adminWhitelist = adminWhitelist;
		this.transaction = new TransactionTemplate(transactionManager);
	}

	/**
	 * @return 로그인한 회원. 트랜잭션은 끝난 상태이며 기본 필드는 모두 읽혀 있다
	 * @throws UserNotActiveException 회원이 ACTIVE가 아닐 때
	 */
	public User login(SocialProfile profile) {
		try {
			return transaction.execute(status -> loginOnce(profile));
		}
		catch (DataIntegrityViolationException concurrentSignUp) {
			log.info("동시 가입 충돌로 다시 조회합니다. provider={}", profile.provider());
			return transaction.execute(status -> loginOnce(profile));
		}
	}

	private User loginOnce(SocialProfile profile) {
		var user = socialAccounts.findByProviderAndProviderUserId(profile.provider(), profile.providerUserId())
				.map(SocialAccount::getUser)
				.orElseGet(() -> signUp(profile));
		if (user.getStatus() != UserStatus.ACTIVE) {
			throw new UserNotActiveException(user.getId());
		}
		var role = adminWhitelist.isAdmin(profile.email(), profile.emailVerified()) ? UserRole.ADMIN : UserRole.USER;
		var previous = user.getRole();
		if (user.changeRole(role)) {
			log.info("회원 {} 역할 {} -> {}", user.getId(), previous, role);
		}
		return user;
	}

	private User signUp(SocialProfile profile) {
		var email = blankToNull(profile.email());
		var user = users.save(User.create(nickname(profile.name()), email, profileImageUrl(profile.profileImageUrl())));
		// 유일 제약 위반을 커밋이 아니라 여기서 드러내 login()이 재조회할 수 있게 한다.
		socialAccounts.saveAndFlush(SocialAccount.connect(user, profile.provider(), profile.providerUserId(), email));
		return user;
	}

	/** 제공자 이름을 다듬는다. 비면 기본값, 30자(코드 포인트)를 넘으면 앞 30자. */
	static String nickname(String name) {
		var nickname = name == null ? "" : name.strip();
		if (nickname.isEmpty()) {
			return DEFAULT_NICKNAME;
		}
		if (nickname.codePointCount(0, nickname.length()) > NICKNAME_MAX_LENGTH) {
			return nickname.substring(0, nickname.offsetByCodePoints(0, NICKNAME_MAX_LENGTH));
		}
		return nickname;
	}

	/** 비었거나 컬럼 길이(500)를 넘는 URL은 저장하지 않는다. */
	static String profileImageUrl(String url) {
		var value = blankToNull(url);
		return (value == null || value.length() > PROFILE_IMAGE_URL_MAX_LENGTH) ? null : value;
	}

	private static String blankToNull(String value) {
		return (value == null || value.isBlank()) ? null : value.strip();
	}

}
