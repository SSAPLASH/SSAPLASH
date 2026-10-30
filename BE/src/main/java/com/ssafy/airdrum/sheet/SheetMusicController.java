package com.ssafy.airdrum.sheet;

import java.net.URI;
import java.util.List;
import java.util.Set;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;

import org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.ModelAttribute;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;
import org.springframework.web.multipart.MultipartHttpServletRequest;
import org.springframework.web.util.WebUtils;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.media.Content;
import io.swagger.v3.oas.annotations.media.Schema;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import io.swagger.v3.oas.annotations.security.SecurityRequirement;
import io.swagger.v3.oas.annotations.tags.Tag;
import tools.jackson.core.StreamReadFeature;
import tools.jackson.core.json.JsonFactory;
import tools.jackson.databind.DeserializationFeature;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

import com.ssafy.airdrum.common.error.ApiErrorResponse;
import com.ssafy.airdrum.common.error.BusinessException;
import com.ssafy.airdrum.common.response.PageResponse;
import com.ssafy.airdrum.config.OpenApiConfig;
import com.ssafy.airdrum.sheet.SheetResponses.SheetDetail;
import com.ssafy.airdrum.sheet.SheetResponses.SheetSummary;
import com.ssafy.airdrum.user.AuthUser;

/** CHART-001 내 악보 보관(155번). 곡과 연결하지 않는 회원별 악보이며 남의 악보는 404다. */
@RestController
@ConditionalOnWebApplication(type = ConditionalOnWebApplication.Type.SERVLET)
@RequestMapping("/api/v1/sheets")
@Tag(name = "Sheets", description = "내 악보 이미지·PDF 보관")
@SecurityRequirement(name = OpenApiConfig.BEARER_AUTH)
@ApiResponse(responseCode = "401", description = "인증 필요", content = @Content(mediaType = "application/problem+json", schema = @Schema(implementation = ApiErrorResponse.class)))
@ApiResponse(responseCode = "404", description = "없는 악보·삭제된 악보·남의 악보: SHEET_NOT_FOUND", content = @Content(mediaType = "application/problem+json", schema = @Schema(implementation = ApiErrorResponse.class)))
public class SheetMusicController {

	private static final Set<String> REGISTER_FIELDS = Set.of("title", "source");

	private final SheetMusicService service;
	private final JsonMapper strict = JsonMapper.builder(JsonFactory.builder().enable(StreamReadFeature.STRICT_DUPLICATE_DETECTION).build())
			.enable(DeserializationFeature.FAIL_ON_TRAILING_TOKENS).build();

	SheetMusicController(SheetMusicService service) {
		this.service = service;
	}

	@ModelAttribute
	void noStore(HttpServletResponse response) {
		response.setHeader("Cache-Control", "private, no-store");
	}

	@PostMapping(consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
	@Operation(summary = "악보 등록",
			description = "files에 JPG·PNG·WEBP 이미지 1~20장(장당 10 MiB, 가로·세로 8000px·4000만 화소 이하) 또는 PDF 1개(20 MiB 이하). "
					+ "요청 전체 50 MiB. 회원당 악보 100개·500 MiB. source는 UPLOADED(기본) 또는 RENDERED(FE가 채보로 렌더링한 악보).")
	@ApiResponse(responseCode = "201", description = "등록. 페이지별 보기 URL(1시간)을 포함한 상세")
	@ApiResponse(responseCode = "400", description = "SHEET_INVALID: 제목·source 형식, 파일 없음·빈 파일·21장 이상·이미지와 PDF 섞음·PDF 2개 이상, 깨진 파일, 화소 상한",
			content = @Content(mediaType = "application/problem+json", schema = @Schema(implementation = ApiErrorResponse.class)))
	@ApiResponse(responseCode = "413", description = "SHEET_TOO_LARGE(파일 크기), SHEET_QUOTA_EXCEEDED(회원당 개수·용량)",
			content = @Content(mediaType = "application/problem+json", schema = @Schema(implementation = ApiErrorResponse.class)))
	@ApiResponse(responseCode = "415", description = "SHEET_UNSUPPORTED: JPG·PNG·WEBP·PDF가 아님",
			content = @Content(mediaType = "application/problem+json", schema = @Schema(implementation = ApiErrorResponse.class)))
	@ApiResponse(responseCode = "503", description = "SHEET_UNAVAILABLE: 저장소 비활성·쓰기 실패, 동시 처리 초과",
			content = @Content(mediaType = "application/problem+json", schema = @Schema(implementation = ApiErrorResponse.class)))
	public ResponseEntity<SheetDetail> register(@Parameter(hidden = true) AuthUser me,
			@Parameter(description = "악보 제목, 1~100자") @RequestParam(value = "title", required = false) String title,
			@Parameter(description = "UPLOADED(기본) 또는 RENDERED") @RequestParam(value = "source", required = false) String source,
			HttpServletRequest request) {
		if (!fields(request)) throw invalid();
		String cleanTitle = title(title);
		String cleanSource = source == null ? "UPLOADED" : switch (source) {
			case "UPLOADED", "RENDERED" -> source;
			default -> throw invalid();
		};
		var detail = service.register(me.id(), cleanTitle, cleanSource, files(request));
		return ResponseEntity.created(URI.create("/api/v1/sheets/" + detail.id())).body(detail);
	}

	@GetMapping
	@Operation(summary = "내 악보 목록", description = "본인 악보만 최신순. q는 제목 부분 검색. 이미지 악보는 1쪽 thumbnailUrl(1시간)을 준다.")
	public PageResponse<SheetSummary> list(@Parameter(hidden = true) AuthUser me,
			@Parameter(description = "제목 검색어") @RequestParam(required = false) String q,
			@RequestParam(defaultValue = "0") @Min(value = 0, message = "페이지는 0 이상이어야 합니다") @Max(value = 100000, message = "페이지는 100000 이하여야 합니다") int page,
			@RequestParam(defaultValue = "20") @Min(value = 1, message = "크기는 1 이상이어야 합니다") @Max(value = 100, message = "크기는 100 이하여야 합니다") int size) {
		return service.list(me.id(), q, page, size);
	}

	@GetMapping("/{id}")
	@Operation(summary = "악보 상세", description = "페이지별 보기 URL(1시간, 브라우저에서 바로 열림). 만료되면 다시 호출한다.")
	public SheetDetail detail(@Parameter(hidden = true) AuthUser me, @PathVariable long id) {
		return service.detail(me.id(), id);
	}

	@PatchMapping(value = "/{id}", consumes = MediaType.APPLICATION_JSON_VALUE)
	@Operation(summary = "악보 제목 수정", description = "JSON {\"title\": \"...\"}만 받는다. 모르는 필드·중복 키·후행 JSON은 SHEET_INVALID.")
	@ApiResponse(responseCode = "400", description = "SHEET_INVALID",
			content = @Content(mediaType = "application/problem+json", schema = @Schema(implementation = ApiErrorResponse.class)))
	public SheetDetail rename(@Parameter(hidden = true) AuthUser me, @PathVariable long id, HttpServletRequest request) {
		JsonNode node;
		try {
			byte[] bytes = request.getInputStream().readNBytes(4097);
			if (bytes.length > 4096) throw invalid();
			node = strict.readTree(bytes);
		} catch (BusinessException ex) {
			throw ex;
		} catch (Exception ex) {
			throw invalid();
		}
		if (node == null || !node.isObject() || node.size() != 1 || !node.has("title") || !node.path("title").isString()) throw invalid();
		return service.rename(me.id(), id, title(node.path("title").asString()));
	}

	@DeleteMapping("/{id}")
	@Operation(summary = "악보 삭제", description = "목록·상세에서 사라지고 파일은 정리 작업자가 지운다.")
	@ApiResponse(responseCode = "204", description = "삭제")
	public ResponseEntity<Void> delete(@Parameter(hidden = true) AuthUser me, @PathVariable long id) {
		service.delete(me.id(), id);
		return ResponseEntity.noContent().build();
	}

	/** 일반 필드는 title·source만, 각 1개씩. */
	private static boolean fields(HttpServletRequest request) {
		for (var entry : request.getParameterMap().entrySet())
			if (!REGISTER_FIELDS.contains(entry.getKey()) || entry.getValue().length != 1) return false;
		return true;
	}

	/** 파일 파트는 files 이름만 받는다. 순서가 페이지 순서다. */
	private static List<MultipartFile> files(HttpServletRequest request) {
		var multipart = WebUtils.getNativeRequest(request, MultipartHttpServletRequest.class);
		if (multipart == null || multipart.getMultiFileMap().size() != 1 || multipart.getFiles("files").isEmpty()) throw invalid();
		return multipart.getFiles("files");
	}

	private static String title(String value) {
		if (value == null) throw invalid();
		String stripped = value.strip();
		if (stripped.isEmpty() || stripped.length() > 100 || stripped.indexOf(0) >= 0) throw invalid();
		return stripped;
	}

	private static BusinessException invalid() {
		return new BusinessException(SheetError.SHEET_INVALID);
	}
}
