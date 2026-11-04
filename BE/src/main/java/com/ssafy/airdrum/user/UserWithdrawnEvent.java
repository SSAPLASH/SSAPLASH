package com.ssafy.airdrum.user;

/**
 * 회원이 탈퇴했다. 탈퇴 트랜잭션 안에서 한 번 발행한다(롤백되면 {@code AFTER_COMMIT} 리스너는 호출되지 않는다).
 *
 * <p>정리를 맡는 모듈은 {@code @TransactionalEventListener(phase = AFTER_COMMIT)}로 받고 DB 변경은 {@code REQUIRES_NEW}로 연다.
 * 예외는 삼킨다(이미 커밋된 탈퇴를 실패로 만들지 않는다). 놓친 정리는 {@link UserRepository#findWithdrawnIds}로 다시 찾는다.
 *
 * @param userId 탈퇴한 회원 id. 개인정보는 싣지 않는다
 */
public record UserWithdrawnEvent(Long userId) {
}
