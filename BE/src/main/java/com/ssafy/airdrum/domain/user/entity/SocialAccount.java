package com.ssafy.airdrum.domain.user.entity;

import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.Objects;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.FetchType;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.ManyToOne;
import jakarta.persistence.PrePersist;
import jakarta.persistence.Table;
import com.ssafy.airdrum.domain.user.model.SocialProvider;

/**
 * 소셜 로그인 연동 ({@code social_accounts}). (제공자, 제공자 측 식별자)가 유일하다.
 * 회원 1명이 여러 제공자를 연결할 수 있는 1:N 구조다.
 */
@Entity
@Table(name = "social_accounts")
public class SocialAccount {

	@Id
	@GeneratedValue(strategy = GenerationType.IDENTITY)
	private Long id;

	@ManyToOne(fetch = FetchType.LAZY, optional = false)
	@JoinColumn(name = "user_id", nullable = false)
	private User user;

	@Enumerated(EnumType.STRING)
	@Column(nullable = false, length = 20)
	private SocialProvider provider;

	/** 제공자 측 사용자 식별자. 구글은 ID 토큰의 sub(이메일이 아니다). */
	@Column(nullable = false, length = 255)
	private String providerUserId;

	/** 제공자 응답 원본 이메일. 회원 이메일과 별도로 보관한다. */
	@Column(length = 255)
	private String email;

	@Column(nullable = false, updatable = false)
	private Instant connectedAt;

	protected SocialAccount() {
		// JPA 전용
	}

	private SocialAccount(User user, SocialProvider provider, String providerUserId, String email) {
		this.user = Objects.requireNonNull(user, "user");
		this.provider = Objects.requireNonNull(provider, "provider");
		this.providerUserId = Objects.requireNonNull(providerUserId, "providerUserId");
		this.email = email;
	}

	/** 회원에 소셜 계정을 연결한다. */
	public static SocialAccount connect(User user, SocialProvider provider, String providerUserId, String email) {
		return new SocialAccount(user, provider, providerUserId, email);
	}

	@PrePersist
	void onCreate() {
		connectedAt = Instant.now().truncatedTo(ChronoUnit.MICROS);
	}

	public Long getId() {
		return id;
	}

	public User getUser() {
		return user;
	}

	public SocialProvider getProvider() {
		return provider;
	}

	public String getProviderUserId() {
		return providerUserId;
	}

	public String getEmail() {
		return email;
	}

	public Instant getConnectedAt() {
		return connectedAt;
	}

}
