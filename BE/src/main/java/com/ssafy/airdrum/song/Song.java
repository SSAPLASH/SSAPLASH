package com.ssafy.airdrum.song;

import java.math.BigDecimal;
import java.time.Instant;
import jakarta.persistence.*;
import org.hibernate.annotations.Immutable;

/** V2 스키마의 조회 전용 매핑. 변경은 별도 등록 작업에서 담당한다. */
@Entity
@Table(name = "songs")
@Immutable
public class Song {
	@Id
	@GeneratedValue(strategy = GenerationType.IDENTITY)
	private Long id;
	private Long ownerId;
	@Column(nullable = false, length = 100)
	private String title;
	@Column(length = 100)
	private String artist;
	@Column(nullable = false, length = 10)
	private String source;
	@Column(nullable = false, length = 12)
	private String status;
	@Column(precision = 6, scale = 2)
	private BigDecimal bpm;
	@Column(nullable = false)
	private Integer offsetMs;
	@Column(length = 5)
	private String timeSignature;
	private Integer durationMs;
	@Column(length = 200)
	private String license;
	@Column(length = 300)
	private String accompanimentKey;
	@Column(length = 300)
	private String coverKey;
	@Column(nullable = false)
	private Instant createdAt;
	@Column(nullable = false)
	private Instant updatedAt;
	private Instant deletedAt;
	protected Song() {}
}
