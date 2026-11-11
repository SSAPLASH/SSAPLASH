package com.ssafy.airdrum.domain.chart.entity;

import java.time.Instant;
import jakarta.persistence.*;
import org.hibernate.annotations.Immutable;

/** V2 스키마의 조회 전용 매핑. 변경은 별도 등록 작업에서 담당한다. */
@Entity
@Table(name = "charts")
@Immutable
public class Chart {
	@Id
	@GeneratedValue(strategy = GenerationType.IDENTITY)
	private Long id;
	@Column(nullable = false)
	private Long songId;
	@Column(nullable = false, length = 6)
	private String difficulty;
	@Column(nullable = false)
	private Instant createdAt;
	@Column(nullable = false)
	private Instant updatedAt;
	protected Chart() {}
}
