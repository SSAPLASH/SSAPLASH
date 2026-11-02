package com.ssafy.airdrum.user;

import java.time.Instant;
import java.util.List;
import java.util.Optional;

import jakarta.persistence.LockModeType;

import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

/** 회원 저장소. */
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

	/**
	 * 회원 행을 배타 잠금(PostgreSQL {@code FOR UPDATE})으로 읽는다. 탈퇴 트랜잭션이 첫 단계에서 호출한다.
	 * {@link #findByIdForShare}와 짝이라 같은 회원의 저장과 탈퇴는 직렬화된다.
	 */
	@Lock(LockModeType.PESSIMISTIC_WRITE)
	@Query("select u from User u where u.id = :id")
	Optional<User> findByIdForUpdate(@Param("id") Long id);

	/**
	 * {@code withdrawnAfter} 이후(포함) 탈퇴한 회원 id를 탈퇴 시각·id 순으로 돌려준다. 탈퇴 이벤트 리스너가 놓친 정리를 다시 찾을 때 쓴다.
	 */
	@Query("select u.id from User u where u.status = com.ssafy.airdrum.user.UserStatus.WITHDRAWN "
			+ "and u.withdrawnAt >= :withdrawnAfter order by u.withdrawnAt, u.id")
	List<Long> findWithdrawnIds(@Param("withdrawnAfter") Instant withdrawnAfter, Pageable page);

	/**
	 * ACTIVE 회원의 데이터 활용 동의를 한 문장으로 저장한다. 탈퇴 트랜잭션({@code FOR UPDATE})과 겹쳐도 탈퇴한 행에는 쓰이지 않는다.
	 *
	 * <p>값이 실제로 바뀔 때만 {@code data_consent_at}·{@code updated_at}을 {@code now}로 바꾸고, 같은 값이면 그대로 둔다
	 * (멱등). 영속성 컨텍스트는 비워 다음 조회가 DB 값을 읽게 한다.
	 *
	 * @return 바뀐(매칭된) 행 수. 0이면 ACTIVE가 아니거나 없는 회원이다
	 */
	@Modifying(flushAutomatically = true, clearAutomatically = true)
	@Query(value = """
			UPDATE users SET
			  data_consent_at = CASE WHEN data_consent IS DISTINCT FROM CAST(:agreed AS boolean)
			                         THEN CAST(:now AS timestamptz) ELSE data_consent_at END,
			  updated_at = CASE WHEN data_consent IS DISTINCT FROM CAST(:agreed AS boolean)
			                    THEN CAST(:now AS timestamptz) ELSE updated_at END,
			  data_consent = CAST(:agreed AS boolean)
			WHERE id = :id AND status = 'ACTIVE'
			""", nativeQuery = true)
	int updateDataConsent(@Param("id") long id, @Param("agreed") boolean agreed, @Param("now") Instant now);

}
