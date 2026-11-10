package com.ssafy.airdrum.song.admin;

import java.net.URI;
import java.util.Set;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.Positive;
import jakarta.validation.constraints.Size;

import org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.ModelAttribute;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RequestPart;
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
import com.ssafy.airdrum.song.CoverImage;
import com.ssafy.airdrum.song.SongManagementError;
import com.ssafy.airdrum.song.midi.MidiErrorCode;
import static com.ssafy.airdrum.song.admin.AdminSongResponses.*;

/** CHART-001 공용 곡 관리(156번). 모든 경로가 ADMIN 전용이며 개인 곡 ID는 404다. */
@RestController
@ConditionalOnWebApplication(type = ConditionalOnWebApplication.Type.SERVLET)
@RequestMapping("/api/v1/admin/songs")
@PreAuthorize("hasRole('ADMIN')")
@Tag(name = "Admin Songs", description = "공용 곡·채보 등록·수정·공개 전환 (ADMIN)")
@SecurityRequirement(name = OpenApiConfig.BEARER_AUTH)
@ApiResponse(responseCode = "401", description = "인증 필요", content = @Content(mediaType = "application/problem+json", schema = @Schema(implementation = ApiErrorResponse.class)))
@ApiResponse(responseCode = "403", description = "ADMIN 아님", content = @Content(mediaType = "application/problem+json", schema = @Schema(implementation = ApiErrorResponse.class)))
@ApiResponse(responseCode = "404", description = "없는 곡·삭제된 곡·개인 곡: SONG_NOT_FOUND", content = @Content(mediaType = "application/problem+json", schema = @Schema(implementation = ApiErrorResponse.class)))
public class AdminSongController {

	private static final Set<String> REGISTER_FIELDS = Set.of("title", "artist", "license", "published", "offsetMs");
	/** offsetMs: 부호·공백·소수 없는 정수 문자열만. 범위는 카탈로그와 같다(0~30분). */
	private static final java.util.regex.Pattern OFFSET = java.util.regex.Pattern.compile("[0-9]{1,7}");
	private static final Set<String> REGENERATE_FIELDS = Set.of("offsetMs");
	private static final Set<String> PATCH_FIELDS = Set.of("title", "artist", "license", "published");

	private final AdminSongService service;
	private final JsonMapper strict = JsonMapper.builder(JsonFactory.builder().enable(StreamReadFeature.STRICT_DUPLICATE_DETECTION).build())
			.enable(DeserializationFeature.FAIL_ON_TRAILING_TOKENS).build();

	AdminSongController(AdminSongService service) {
		this.service = service;
	}

	@ModelAttribute
	void noStore(HttpServletResponse response) {
		response.setHeader("Cache-Control", "private, no-store");
	}

	@PostMapping(value = "/midi", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
	@Operation(summary = "MIDI로 공용 곡 등록",
			description = "151번과 같은 규칙(midi-rule-2.0)으로 EASY·NORMAL·HARD 채보(version 1)를 만들어 공용 곡으로 저장한다. "
					+ "license(출처·라이선스) 필수. published 기본 true이며 false면 일반 사용자에게 보이지 않는다. "
					+ "offsetMs(선택, 기본 0)는 0틱 = 음원 0초인 MIDI의 첫 마디 첫 박 시각(ms)으로, 카탈로그(260번)와 같이 솎기 격자·악보 마디의 원점이 된다.")
	@ApiResponse(responseCode = "201", description = "등록")
	@ApiResponse(responseCode = "400", description = "필드 형식: SONG_INVALID, 파일 없음·빈 파일: MIDI_INVALID",
			content = @Content(mediaType = "application/problem+json", schema = @Schema(implementation = ApiErrorResponse.class)))
	@ApiResponse(responseCode = "413", description = "MIDI 1 MiB 초과: MIDI_TOO_LARGE",
			content = @Content(mediaType = "application/problem+json", schema = @Schema(implementation = ApiErrorResponse.class)))
	@ApiResponse(responseCode = "422", description = "MIDI_UNSUPPORTED(첫 박보다 앞선 노트 포함), MIDI_NO_DRUM_NOTES",
			content = @Content(mediaType = "application/problem+json", schema = @Schema(implementation = ApiErrorResponse.class)))
	public ResponseEntity<AdminSongDetail> register(
			@Parameter(description = "곡 제목, 1~100자") @RequestParam(value = "title", required = false) String title,
			@Parameter(description = "아티스트, 0~100자") @RequestParam(value = "artist", required = false) String artist,
			@Parameter(description = "출처·라이선스, 1~200자") @RequestParam(value = "license", required = false) String license,
			@Parameter(description = "true(기본) 또는 false") @RequestParam(value = "published", required = false) String published,
			@Parameter(description = "첫 마디 첫 박 시각 ms, 0~1,800,000 정수(기본 0)") @RequestParam(value = "offsetMs", required = false) String offsetMs,
			@RequestPart(value = "file", required = false) MultipartFile file, HttpServletRequest request) {
		if (!fields(request, REGISTER_FIELDS)) throw invalid();
		String cleanTitle = required(title, 100);
		String cleanArtist = optional(artist, 100);
		String cleanLicense = required(license, 200);
		boolean open = published == null || flag(published);
		int offset = offsetMs == null ? 0 : offset(offsetMs);
		var detail = service.register(cleanTitle, cleanArtist, cleanLicense, open, file(request, file), offset);
		return ResponseEntity.created(URI.create("/api/v1/admin/songs/" + detail.id())).body(detail);
	}

	@GetMapping
	@Operation(summary = "공용 곡 목록(비공개 포함)", description = "삭제된 곡은 뺀다. 생성 내림차순. published로 공개·비공개만 볼 수 있다.")
	public PageResponse<AdminSongSummary> list(
			@Parameter(description = "생략하면 전체") @RequestParam(required = false) Boolean published,
			@RequestParam(required = false) @Size(max = 100, message = "검색어는 100자 이하여야 합니다") String q,
			@RequestParam(defaultValue = "0") @Min(value = 0, message = "페이지는 0 이상이어야 합니다") @Max(value = 100000, message = "페이지는 100000 이하여야 합니다") int page,
			@RequestParam(defaultValue = "20") @Min(value = 1, message = "크기는 1 이상이어야 합니다") @Max(value = 100, message = "크기는 100 이하여야 합니다") int size) {
		return service.list(published, q, page, size);
	}

	@GetMapping("/{id}")
	@Operation(summary = "공용 곡 상세", description = "난이도별 최신 버전과 생성기 정보, 커버 URL(1시간)")
	public AdminSongDetail detail(@PathVariable @Positive(message = "곡 ID는 양수여야 합니다") long id) {
		return service.detail(id);
	}

	@PatchMapping(value = "/{id}", consumes = MediaType.APPLICATION_JSON_VALUE)
	@Operation(summary = "공용 곡 정보 수정·공개 전환",
			description = "title·artist·license·published 중 보낸 것만 바꾼다. 빈 artist는 null. 모르는 필드·중복 키·후행 JSON은 SONG_INVALID.")
	@ApiResponse(responseCode = "400", description = "SONG_INVALID",
			content = @Content(mediaType = "application/problem+json", schema = @Schema(implementation = ApiErrorResponse.class)))
	public AdminSongDetail patch(@PathVariable long id, HttpServletRequest request) {
		JsonNode node;
		try {
			byte[] bytes = request.getInputStream().readNBytes(8193);
			if (bytes.length > 8192) throw invalid();
			node = strict.readTree(bytes);
		} catch (BusinessException ex) {
			throw ex;
		} catch (Exception ex) {
			throw invalid();
		}
		if (node == null || !node.isObject() || node.isEmpty()
				|| node.properties().stream().anyMatch(e -> !PATCH_FIELDS.contains(e.getKey())))
			throw invalid();
		boolean hasTitle = node.has("title"), hasArtist = node.has("artist"), hasLicense = node.has("license");
		if ((hasTitle && !node.path("title").isString()) || (hasArtist && !node.path("artist").isString())
				|| (hasLicense && !node.path("license").isString()) || (node.has("published") && !node.path("published").isBoolean()))
			throw invalid();
		var change = new AdminSongService.Change(
				hasTitle, hasTitle ? required(node.path("title").asString(), 100) : null,
				hasArtist, hasArtist ? optional(node.path("artist").asString(), 100) : null,
				hasLicense, hasLicense ? required(node.path("license").asString(), 200) : null,
				node.has("published") ? node.path("published").asBoolean() : null);
		return service.patch(id, change);
	}

	@PutMapping(value = "/{id}/charts/midi", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
	@Operation(summary = "고친 MIDI로 채보 새 버전 생성",
			description = "난이도별 version + 1을 만든다. 기존 버전과 그 버전의 플레이 기록은 그대로 남는다. 빠진 난이도는 version 1로 채운다. "
					+ "offsetMs(선택)를 생략하면 곡에 저장된 첫 박 시각을 그대로 쓴다. 첫 박이 다른 MIDI로 바꿀 때만 준다.")
	@ApiResponse(responseCode = "400", description = "필드 형식: SONG_INVALID, 파일 없음·빈 파일: MIDI_INVALID",
			content = @Content(mediaType = "application/problem+json", schema = @Schema(implementation = ApiErrorResponse.class)))
	@ApiResponse(responseCode = "422", description = "MIDI_UNSUPPORTED(첫 박보다 앞선 노트 포함), MIDI_NO_DRUM_NOTES",
			content = @Content(mediaType = "application/problem+json", schema = @Schema(implementation = ApiErrorResponse.class)))
	public AdminSongDetail regenerate(@PathVariable long id,
			@Parameter(description = "첫 마디 첫 박 시각 ms, 0~1,800,000 정수(생략하면 곡의 기존 값)") @RequestParam(value = "offsetMs", required = false) String offsetMs,
			@RequestPart(value = "file", required = false) MultipartFile file, HttpServletRequest request) {
		if (!fields(request, REGENERATE_FIELDS)) throw invalid();
		Integer offset = offsetMs == null ? null : offset(offsetMs);
		return service.regenerate(id, file(request, file), offset);
	}

	@DeleteMapping("/{id}")
	@Operation(summary = "공용 곡 삭제", description = "소프트 삭제. 채보·플레이 기록은 남고 반주·커버 객체는 정리 큐에 넣는다.")
	public ResponseEntity<Void> delete(@PathVariable long id) {
		service.delete(id);
		return ResponseEntity.noContent().build();
	}

	@PutMapping(value = "/{id}/cover", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
	@Operation(summary = "공용 곡 커버 등록·교체",
			description = "multipart file 1개, JPEG·PNG·WebP 2 MiB 이하(187번 규칙). 모든 회원의 곡 목록·상세 coverUrl에 보인다.")
	@ApiResponse(responseCode = "400", description = "COVER_INVALID",
			content = @Content(mediaType = "application/problem+json", schema = @Schema(implementation = ApiErrorResponse.class)))
	@ApiResponse(responseCode = "413", description = "COVER_TOO_LARGE",
			content = @Content(mediaType = "application/problem+json", schema = @Schema(implementation = ApiErrorResponse.class)))
	@ApiResponse(responseCode = "415", description = "COVER_UNSUPPORTED",
			content = @Content(mediaType = "application/problem+json", schema = @Schema(implementation = ApiErrorResponse.class)))
	@ApiResponse(responseCode = "503", description = "COVER_UNAVAILABLE",
			content = @Content(mediaType = "application/problem+json", schema = @Schema(implementation = ApiErrorResponse.class)))
	public CoverResponse cover(@PathVariable long id, @RequestPart(value = "file", required = false) MultipartFile file,
			HttpServletRequest request) {
		if (!fields(request, Set.of()) || !singleFile(request)) throw new BusinessException(SongManagementError.COVER_INVALID);
		if (file.getSize() > CoverImage.MAX_BYTES) throw new BusinessException(SongManagementError.COVER_TOO_LARGE);
		byte[] data;
		try (var in = file.getInputStream()) {
			data = in.readNBytes(CoverImage.MAX_BYTES + 1);
		} catch (Exception ex) {
			throw new BusinessException(SongManagementError.COVER_INVALID);
		}
		if (data.length > CoverImage.MAX_BYTES) throw new BusinessException(SongManagementError.COVER_TOO_LARGE);
		return service.cover(id, data);
	}

	@DeleteMapping("/{id}/cover")
	@Operation(summary = "공용 곡 커버 삭제", description = "없어도 204")
	public ResponseEntity<Void> deleteCover(@PathVariable long id) {
		service.deleteCover(id);
		return ResponseEntity.noContent().build();
	}

	@PutMapping(value = "/{id}/accompaniment", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
	@Operation(summary = "공용 곡 반주 등록·교체",
			description = "multipart file 1개, WAV·MP3 50 MiB·10분 이하(ffprobe로 실제 바이트 검사). 응답 URL은 assets와 같은 서명(1~10분).")
	@ApiResponse(responseCode = "400", description = "ACCOMPANIMENT_INVALID",
			content = @Content(mediaType = "application/problem+json", schema = @Schema(implementation = ApiErrorResponse.class)))
	@ApiResponse(responseCode = "413", description = "ACCOMPANIMENT_TOO_LARGE",
			content = @Content(mediaType = "application/problem+json", schema = @Schema(implementation = ApiErrorResponse.class)))
	@ApiResponse(responseCode = "422", description = "ACCOMPANIMENT_UNSUPPORTED",
			content = @Content(mediaType = "application/problem+json", schema = @Schema(implementation = ApiErrorResponse.class)))
	@ApiResponse(responseCode = "503", description = "ACCOMPANIMENT_UNAVAILABLE",
			content = @Content(mediaType = "application/problem+json", schema = @Schema(implementation = ApiErrorResponse.class)))
	public AccompanimentResponse accompaniment(@PathVariable long id,
			@RequestPart(value = "file", required = false) MultipartFile file, HttpServletRequest request) {
		if (!fields(request, Set.of()) || !singleFile(request)) throw new BusinessException(AdminSongError.ACCOMPANIMENT_INVALID);
		return service.accompaniment(id, file);
	}

	@DeleteMapping("/{id}/accompaniment")
	@Operation(summary = "공용 곡 반주 삭제", description = "없어도 204")
	public ResponseEntity<Void> deleteAccompaniment(@PathVariable long id) {
		service.deleteAccompaniment(id);
		return ResponseEntity.noContent().build();
	}

	private static boolean singleFile(HttpServletRequest request) {
		var multipart = WebUtils.getNativeRequest(request, MultipartHttpServletRequest.class);
		return multipart != null && multipart.getMultiFileMap().size() == 1 && multipart.getFiles("file").size() == 1;
	}

	/** 일반 필드는 허용 목록만, 각 1개씩. */
	private static boolean fields(HttpServletRequest request, Set<String> allowed) {
		for (var entry : request.getParameterMap().entrySet())
			if (!allowed.contains(entry.getKey()) || entry.getValue().length != 1) return false;
		return true;
	}

	/** 파일 파트는 file 1개만. 없으면 MIDI_INVALID. */
	private static MultipartFile file(HttpServletRequest request, MultipartFile file) {
		var multipart = WebUtils.getNativeRequest(request, MultipartHttpServletRequest.class);
		if (multipart == null || multipart.getMultiFileMap().isEmpty()) throw new BusinessException(MidiErrorCode.INVALID);
		if (multipart.getMultiFileMap().size() != 1 || multipart.getFiles("file").size() != 1) throw invalid();
		return file;
	}

	private static String required(String value, int limit) {
		var text = optional(value, limit);
		if (text == null) throw invalid();
		return text;
	}

	/** 앞뒤 공백을 지운 값. 비었으면 null, 길거나 NUL이 있으면 거절한다. */
	private static String optional(String value, int limit) {
		if (value == null) return null;
		var stripped = value.strip();
		if (stripped.length() > limit || stripped.indexOf(0) >= 0) throw invalid();
		return stripped.isEmpty() ? null : stripped;
	}

	private static int offset(String value) {
		if (!OFFSET.matcher(value).matches()) throw invalid();
		int ms = Integer.parseInt(value);
		if (ms > BuiltinSongCatalog.MAX_OFFSET_MS) throw invalid();
		return ms;
	}

	private static boolean flag(String value) {
		if (value.equals("true")) return true;
		if (value.equals("false")) return false;
		throw invalid();
	}

	private static BusinessException invalid() {
		return new BusinessException(SongManagementError.SONG_INVALID);
	}

}
