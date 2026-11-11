package com.ssafy.airdrum.global.response;

import java.util.List;

import org.junit.jupiter.api.Test;
import tools.jackson.databind.json.JsonMapper;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/** 설계 3-13: offset 기반 페이지 응답의 계산 규칙과 직렬화 필드명을 확인한다. */
class PageResponseTest {

	private final JsonMapper mapper = new JsonMapper();

	@Test
	void computesTotalPagesAndHasNext() {
		var page = PageResponse.of(List.of("a", "b"), 0, 2, 5);

		assertThat(page.items()).containsExactly("a", "b");
		assertThat(page.page()).isEqualTo(0);
		assertThat(page.size()).isEqualTo(2);
		assertThat(page.totalElements()).isEqualTo(5);
		assertThat(page.totalPages()).isEqualTo(3);
		assertThat(page.hasNext()).isTrue();
	}

	@Test
	void lastPageHasNoNext() {
		assertThat(PageResponse.of(List.of("e"), 2, 2, 5).hasNext()).isFalse();
		assertThat(PageResponse.of(List.of("c", "d"), 1, 2, 4).hasNext()).isFalse();
	}

	@Test
	void emptyResultHasZeroPages() {
		var page = PageResponse.of(List.of(), 0, 20, 0);

		assertThat(page.items()).isEmpty();
		assertThat(page.totalPages()).isEqualTo(0);
		assertThat(page.hasNext()).isFalse();
	}

	@Test
	void rejectsInvalidPaging() {
		assertThatThrownBy(() -> PageResponse.of(List.of(), -1, 10, 0)).isInstanceOf(IllegalArgumentException.class);
		assertThatThrownBy(() -> PageResponse.of(List.of(), 0, 0, 0)).isInstanceOf(IllegalArgumentException.class);
		assertThatThrownBy(() -> PageResponse.of(List.of(), 0, 10, -1)).isInstanceOf(IllegalArgumentException.class);
	}

	@Test
	void serializesWithDesignedFieldNames() {
		var json = mapper.readTree(mapper.writeValueAsString(PageResponse.of(List.of(1, 2), 1, 2, 3)));

		assertThat(json.propertyNames()).containsExactlyInAnyOrder(
				"items", "page", "size", "totalElements", "totalPages", "hasNext");
		assertThat(json.path("items").size()).isEqualTo(2);
		assertThat(json.path("page").asInt()).isEqualTo(1);
		assertThat(json.path("totalPages").asInt()).isEqualTo(2);
		assertThat(json.path("hasNext").asBoolean()).isFalse();
	}

}
