package com.ssafy.airdrum.user;

import java.util.Collection;
import java.util.Locale;
import java.util.Objects;
import java.util.Set;
import java.util.stream.Collectors;

/**
 * ADMIN 화이트리스트({@code ADMIN_EMAILS}). 앞뒤 공백과 대소문자를 무시하고, 제공자가 검증한 이메일만 인정한다.
 * 빈은 인증 설정이 만든다(회원 모듈은 설정 위치를 모른다).
 */
public class AdminEmailWhitelist {

	private final Set<String> emails;

	public AdminEmailWhitelist(Collection<String> emails) {
		this.emails = emails == null ? Set.of() : emails.stream()
				.filter(Objects::nonNull)
				.map(AdminEmailWhitelist::normalize)
				.filter(email -> !email.isEmpty())
				.collect(Collectors.toUnmodifiableSet());
	}

	public boolean isAdmin(String email, boolean emailVerified) {
		return emailVerified && email != null && emails.contains(normalize(email));
	}

	private static String normalize(String email) {
		return email.strip().toLowerCase(Locale.ROOT);
	}

}
