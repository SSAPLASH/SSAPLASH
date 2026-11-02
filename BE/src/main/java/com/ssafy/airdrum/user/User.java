package com.ssafy.airdrum.user;

import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.Objects;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.PrePersist;
import jakarta.persistence.PreUpdate;
import jakarta.persistence.Table;

/**
 * 회원 ({@code users}). 스키마는 V1 마이그레이션이 정의하고 이 매핑은 그것과 맞아야 한다(Hibernate validate).
 *
 * <p>세터를 두지 않는다(동의 값은 저장소의 조건부 UPDATE가 바꾼다). 상태는 전이 메서드({@link #withdraw})로만 바꾼다.
 */
@Entity
@Table(name = "users")
public class User {

	/** 탈퇴 회원의 닉네임. 컬럼이 NOT NULL이라 비우지 않고 이 문구로 바꾼다(ERD 3-1). */
	public static final String WITHDRAWN_NICKNAME = "탈퇴한 사용자";

	@Id
	@GeneratedValue(strategy = GenerationType.IDENTITY)
	private Long id;

	@Column(nullable = false, length = 30)
	private String nickname;

	@Column(length = 255)
	private String email;

	@Column(length = 500)
	private String profileImageUrl;

	@Enumerated(EnumType.STRING)
	@Column(nullable = false, length = 10)
	private UserRole role;

	@Enumerated(EnumType.STRING)
	@Column(nullable = false, length = 10)
	private UserStatus status;

	@Column(nullable = false, updatable = false)
	private Instant createdAt;

	@Column(nullable = false)
	private Instant updatedAt;

	private Instant withdrawnAt;

	/** 연주 기록 활용 동의(V25). null은 아직 답하지 않음. 저장은 {@link UserRepository#updateSignupConsent}가 한다. */
	private Boolean dataConsent;

	/** 현재 동의 값을 선택한 시각. {@link #dataConsent}가 null이면 null이다. */
	private Instant dataConsentAt;

	/** 동의한 연주 기록 활용 안내문의 판(V26). {@link #dataConsent}와 함께 있거나 함께 없다. */
	@Column(length = 50)
	private String dataConsentVersion;

	/** 동의한 이용약관의 판(V26). 서버는 비교·해석하지 않고 저장만 한다. */
	@Column(length = 50)
	private String termsVersion;

	/** 현재 이용약관 판에 동의한 시각. {@link #termsVersion}과 함께 있거나 함께 없다. */
	private Instant termsAgreedAt;

	/** 동의한 개인정보 수집·이용 안내의 판(V26). */
	@Column(length = 50)
	private String privacyVersion;

	/** 현재 개인정보 판에 동의한 시각. {@link #privacyVersion}과 함께 있거나 함께 없다. */
	private Instant privacyAgreedAt;

	protected User() {
		// JPA 전용
	}

	private User(String nickname, String email, String profileImageUrl) {
		this.nickname = Objects.requireNonNull(nickname, "nickname");
		this.email = email;
		this.profileImageUrl = profileImageUrl;
		this.role = UserRole.USER;
		this.status = UserStatus.ACTIVE;
	}

	/** 최초 가입 회원을 만든다. 권한은 USER, 상태는 ACTIVE다. */
	public static User create(String nickname, String email, String profileImageUrl) {
		return new User(nickname, email, profileImageUrl);
	}

	/**
	 * 권한을 바꾼다. 로그인마다 ADMIN 화이트리스트로 다시 정한다.
	 *
	 * @return 값이 실제로 바뀌었으면 true
	 */
	public boolean changeRole(UserRole role) {
		Objects.requireNonNull(role, "role");
		if (this.role == role) {
			return false;
		}
		this.role = role;
		return true;
	}

	/**
	 * 탈퇴 전이(ACTIVE → WITHDRAWN, 되돌리지 않는다). 개인정보·동의 컬럼도 같은 UPDATE로 비워 상태만 바뀐 채 개인정보가 남는 순간이 없게 한다.
	 * 호출자는 행을 {@code FOR UPDATE}로 잠근 뒤 상태를 먼저 확인한다.
	 *
	 * @throws IllegalStateException 이미 탈퇴한 회원
	 */
	public void withdraw(Instant now) {
		Objects.requireNonNull(now, "now");
		if (status == UserStatus.WITHDRAWN) {
			throw new IllegalStateException("회원 " + id + "은(는) 이미 탈퇴했습니다.");
		}
		status = UserStatus.WITHDRAWN;
		withdrawnAt = now.truncatedTo(ChronoUnit.MICROS);
		nickname = WITHDRAWN_NICKNAME;
		email = null;
		profileImageUrl = null;
		// 가입 동의 기록도 함께 비운다(가입 동의 설계 U1). 7개가 모두 null이라 동의 CHECK를 통과한다
		dataConsent = null;
		dataConsentAt = null;
		dataConsentVersion = null;
		termsVersion = null;
		termsAgreedAt = null;
		privacyVersion = null;
		privacyAgreedAt = null;
	}

	/** 이용약관·개인정보 동의 시각이 둘 다 있으면 가입 완료다. 연주 기록 활용 값·역할과는 무관하다. */
	public boolean isSignupCompleted() {
		return termsAgreedAt != null && privacyAgreedAt != null;
	}

	@PrePersist
	void onCreate() {
		var now = now();
		createdAt = now;
		updatedAt = now;
	}

	@PreUpdate
	void onUpdate() {
		updatedAt = now();
	}

	/** PostgreSQL timestamptz 정밀도(마이크로초)에 맞춰 저장 전후 값이 같게 한다. */
	private static Instant now() {
		return Instant.now().truncatedTo(ChronoUnit.MICROS);
	}

	public Long getId() {
		return id;
	}

	public String getNickname() {
		return nickname;
	}

	public String getEmail() {
		return email;
	}

	public String getProfileImageUrl() {
		return profileImageUrl;
	}

	public UserRole getRole() {
		return role;
	}

	public UserStatus getStatus() {
		return status;
	}

	public Instant getCreatedAt() {
		return createdAt;
	}

	public Instant getUpdatedAt() {
		return updatedAt;
	}

	public Instant getWithdrawnAt() {
		return withdrawnAt;
	}

	public Boolean getDataConsent() {
		return dataConsent;
	}

	public Instant getDataConsentAt() {
		return dataConsentAt;
	}

	public String getDataConsentVersion() {
		return dataConsentVersion;
	}

	public String getTermsVersion() {
		return termsVersion;
	}

	public Instant getTermsAgreedAt() {
		return termsAgreedAt;
	}

	public String getPrivacyVersion() {
		return privacyVersion;
	}

	public Instant getPrivacyAgreedAt() {
		return privacyAgreedAt;
	}

}
