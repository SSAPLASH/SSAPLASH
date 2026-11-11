package com.ssafy.airdrum.domain.chart.tool;

/** 등록 도구가 쓰는 기존 비공개 오브젝트 저장소의 제한된 인터페이스. */
public interface PracticeBackingObjectStore {
	boolean ensureBytes(String bucket, String key, byte[] expectedBytes, String expectedSha256);
}
