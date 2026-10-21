package com.ssafy.airdrum.auth;

import java.time.Instant;

import com.ssafy.airdrum.user.AuthUser;

/**
 * {@link AuthenticationService#authenticate}의 결과.
 *
 * @param user ACTIVE 회원과 DB의 현재 권한
 * @param expiresAt access 토큰 만료 시각. WS는 이 시각이 지나면 연결을 끊는다
 */
public record AuthenticatedUser(AuthUser user, Instant expiresAt) {
}
