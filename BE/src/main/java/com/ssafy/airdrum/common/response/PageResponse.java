package com.ssafy.airdrum.common.response;

import java.util.List;

/**
 * offset 기반 목록 응답. 페이지네이션이 필요한 목록 API는 이 레코드로 감싸고, 작은 고정 목록은 JSON 배열을 그대로 낸다.
 *
 * @param items         현재 페이지 항목
 * @param page          0부터 시작하는 페이지 번호
 * @param size          요청한 페이지 크기(1 이상)
 * @param totalElements 전체 개수
 * @param totalPages    전체 페이지 수. 전체가 0이면 0
 * @param hasNext       다음 페이지 존재 여부
 */
public record PageResponse<T>(
		List<T> items,
		int page,
		int size,
		long totalElements,
		int totalPages,
		boolean hasNext) {

	public static <T> PageResponse<T> of(List<T> items, int page, int size, long totalElements) {
		if (page < 0) {
			throw new IllegalArgumentException("page는 0 이상이어야 합니다: " + page);
		}
		if (size < 1) {
			throw new IllegalArgumentException("size는 1 이상이어야 합니다: " + size);
		}
		if (totalElements < 0) {
			throw new IllegalArgumentException("totalElements는 0 이상이어야 합니다: " + totalElements);
		}
		int totalPages = (int) Math.ceil(totalElements / (double) size);
		boolean hasNext = (long) (page + 1) * size < totalElements;
		return new PageResponse<>(items == null ? List.of() : List.copyOf(items), page, size, totalElements, totalPages, hasNext);
	}

}
