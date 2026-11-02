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

	/** 연주 기록 활용 동의(V24). null은 아직 답하지 않음. 저장은 {@link UserRepository#updateDataConsent}가 한다. */
	private Boolean dataConsent;

	/** 현재 동의 값을 선택한 시각. {@link #dataConsent}가 null이면 null이다. */
	private Instant dataConsentAt;

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
	 * 탈퇴 전이(ACTIVE → WITHDRAWN, 되돌리지 않는다). 개인정보 컬럼도 같은 UPDATE로 비워 상태만 바뀐 채 개인정보가 남는 순간이 없게 한다.
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

}
