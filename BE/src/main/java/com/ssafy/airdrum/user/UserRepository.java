package com.ssafy.airdrum.user;

import java.util.Optional;

import jakarta.persistence.LockModeType;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

/** 회원 저장소. 탈퇴 회원 조회 등은 그 기능을 구현하는 작업에서 추가한다. */
public interface UserRepository extends JpaRepository<User, Long> {

	/** 인증이 매 요청 호출한다. ACTIVE 회원만 id·현재 권한으로 돌려주고 엔티티는 읽지 않는다. */
	@Query("select new com.ssafy.airdrum.user.AuthUser(u.id, u.role) from User u "
			+ "where u.id = :id and u.status = com.ssafy.airdrum.user.UserStatus.ACTIVE")
	Optional<AuthUser> findActiveAuthUser(@Param("id") Long id);

	/**
	 * 회원 행을 공유 잠금(PostgreSQL {@code FOR SHARE})으로 읽는다. <b>호출자 트랜잭션 안에서만</b> 의미가 있다.
	 *
	 * <p>회원이 소유한 데이터를 최종 저장하는 트랜잭션(채보 결과 커밋·업로드 접수)이 첫 단계에서 호출해 상태가 ACTIVE인지
	 * 다시 확인한다. 탈퇴는 같은 행을 {@code FOR UPDATE}로 잠그므로 둘이 겹치면 한쪽이 기다린다. 잠금 순서는
	 * {@code users} → {@code songs} → {@code chart_jobs}다. 같은 회원의 저장끼리는 서로 막지 않는다.
	 */
	@Lock(LockModeType.PESSIMISTIC_READ)
	@Query("select u from User u where u.id = :id")
	Optional<User> findByIdForShare(@Param("id") Long id);

}
