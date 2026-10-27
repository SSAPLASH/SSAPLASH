package com.ssafy.airdrum.preset;

import java.util.List;
import java.util.Optional;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

/** 키트 프리셋 저장소. 모든 조회는 소유자({@code userId}) 조건을 건다. */
public interface KitPresetRepository extends JpaRepository<KitPreset, Long> {

	/** 목록: 기본 프리셋 먼저, 그다음 최근 생성 순. 생성 시각이 같으면 id 내림차순. */
	List<KitPreset> findAllByUserIdOrderByIsDefaultDescCreatedAtDescIdDesc(Long userId);

	/** 소유자 조건 단건. 타인 프리셋은 없는 것과 같다. */
	Optional<KitPreset> findByIdAndUserId(Long id, Long userId);

	boolean existsByUserIdAndName(Long userId, String name);

	boolean existsByUserIdAndNameAndIdNot(Long userId, String name, Long id);

	long countByUserId(Long userId);

	/** 기본 프리셋을 지운 뒤 승계 대상: 남은 것 중 가장 최근 생성. */
	Optional<KitPreset> findFirstByUserIdOrderByCreatedAtDescIdDesc(Long userId);

	/**
	 * 그 회원의 기본 표시를 모두 지운다. 영속성 컨텍스트를 먼저 flush하고 끝나면 비운다.
	 *
	 * @return 바뀐 행 수(0 또는 1)
	 */
	@Modifying(flushAutomatically = true, clearAutomatically = true)
	@Query("update KitPreset p set p.isDefault = false where p.userId = :userId and p.isDefault = true")
	int clearDefault(@Param("userId") Long userId);

	/** 탈퇴 트랜잭션({@code withdrawal.WithdrawalService})이 호출한다. 프리셋 API에서는 쓰지 않는다. */
	@Modifying(flushAutomatically = true, clearAutomatically = true)
	@Query("delete from KitPreset p where p.userId = :userId")
	int deleteAllByUserId(@Param("userId") Long userId);

}
