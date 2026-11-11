package com.ssafy.airdrum.domain.chart.tool;

import java.net.URI;
import java.time.Duration;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import software.amazon.awssdk.services.s3.S3Client;
import com.ssafy.airdrum.domain.chart.storage.ChartStorageConfiguration;
import com.ssafy.airdrum.domain.chart.storage.ChartStorageProperties;

/** 환경 변수를 명시해 실행하는 기본 8비트 연습 반주 등록 진입점. */
public final class RegisterBasic8Backing {
	private RegisterBasic8Backing() {}

	public static void main(String[] args) {
		try {
			run();
		} catch (RuntimeException ex) {
			System.err.println("기본 8비트 반주 등록을 중단했습니다. 설정과 검증 결과를 확인하세요.");
			System.exit(1);
		}
	}

	private static void run() {
		var dataSource = new DriverManagerDataSource();
		dataSource.setDriverClassName("org.postgresql.Driver");
		dataSource.setUrl(required("DB_URL"));
		dataSource.setUsername(required("DB_USERNAME"));
		dataSource.setPassword(required("DB_PASSWORD"));
		var properties = new ChartStorageProperties(true, uri("CHART_ASSET_ENDPOINT"),
				uri("CHART_ASSET_PUBLIC_ENDPOINT"), value("CHART_ASSET_REGION", "us-east-1"),
				required("CHART_ASSET_SHEET_BUCKET"), required("CHART_ASSET_ACCOMPANIMENT_BUCKET"),
				required("CHART_ASSET_ACCESS_KEY"), required("CHART_ASSET_SECRET_KEY"), Duration.ofMinutes(10));
		S3Client client = new ChartStorageConfiguration.Enabled().chartS3Client(properties);
		try (client) {
			var result = new PracticeBackingRegistrar(dataSource, new S3PracticeBackingObjectStore(client))
					.register(properties.accompanimentBucket());
			System.out.printf("기본 8비트 반주 등록 확인: songId=%d, key=%s, bytes=%d, sha256=%s, 객체재사용=%s, DB기존연결=%s%n",
				result.songId(), result.objectKey(), result.byteLength(), result.sha256(),
				result.reusedObject(), result.alreadyLinked());
		}
	}

	private static URI uri(String name) {
		try { return URI.create(required(name)); }
		catch (IllegalArgumentException ex) { throw new IllegalStateException(name + " 형식이 올바르지 않습니다."); }
	}

	private static String required(String name) {
		String value = System.getenv(name);
		if (value == null || value.isBlank()) throw new IllegalStateException(name + " 환경 변수가 필요합니다.");
		return value;
	}

	private static String value(String name, String fallback) {
		String value = System.getenv(name);
		return value == null || value.isBlank() ? fallback : value;
	}
}
