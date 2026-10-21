package com.ssafy.airdrum.chart;

import java.time.Instant;
import jakarta.persistence.*;
import org.hibernate.annotations.Immutable;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

/** V2 스키마의 조회 전용 매핑. 변경은 별도 등록 작업에서 담당한다. */
@Entity
@Table(name = "chart_versions")
@Immutable
public class ChartVersion {
	@Id
	@GeneratedValue(strategy = GenerationType.IDENTITY)
	private Long id;
	@Column(nullable = false)
	private Long chartId;
	@Column(nullable = false)
	private Integer version;
	@Column(nullable = false)
	private Integer schemaVersion;
	@JdbcTypeCode(SqlTypes.JSON)
	@Column(nullable = false, columnDefinition = "jsonb")
	private String notes;
	@JdbcTypeCode(SqlTypes.JSON)
	@Column(nullable = false, columnDefinition = "jsonb")
	private String timing;
	@Column(nullable = false, length = 12)
	private String notationStatus;
	@Column(nullable = false)
	private Integer noteCount;
	@Column(nullable = false, length = 20)
	private String generator;
	@Column(length = 50)
	private String generatorVersion;
	@JdbcTypeCode(SqlTypes.JSON)
	@Column(columnDefinition = "jsonb")
	private String sheetPages;
	@Column(nullable = false)
	private Instant createdAt;
	protected ChartVersion() {}
}
