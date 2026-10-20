package com.ssafy.airdrum.user;

import org.springframework.data.jpa.repository.JpaRepository;

/** 회원 저장소. 탈퇴 회원 조회 등은 그 기능을 구현하는 작업에서 추가한다. */
public interface UserRepository extends JpaRepository<User, Long> {
}
