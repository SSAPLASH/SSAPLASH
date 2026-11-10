package com.ssafy.airdrum.song.musicxml;

import java.net.URI;

import jakarta.servlet.http.HttpServletRequest;

import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
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

import com.ssafy.airdrum.common.error.ApiErrorResponse;
import com.ssafy.airdrum.common.error.BusinessException;
import com.ssafy.airdrum.config.OpenApiConfig;
import com.ssafy.airdrum.song.SongResponses.SongDetail;
import com.ssafy.airdrum.user.AuthUser;

/** CHART-001 MusicXML 악보 업로드 곡 등록(293번). MIDI 업로드(151번)와 같은 요청 모양이며 변환은 AI 서버가 한다. */
@RestController
@RequestMapping("/api/v1/songs/musicxml")
@Tag(name = "Songs", description = "곡·채보")
@SecurityRequirement(name = OpenApiConfig.BEARER_AUTH)
@ApiResponse(responseCode = "401", description = "인증 필요", content = @Content(mediaType = "application/problem+json", schema = @Schema(implementation = ApiErrorResponse.class)))
public class MusicXmlUploadController {

	private final MusicXmlUploadService service;

	MusicXmlUploadController(MusicXmlUploadService service) {
		this.service = service;
	}

	@PostMapping(consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
	@Operation(summary = "MusicXML 업로드 → 채보 변환",
			description = "드럼 MusicXML(.musicxml·.xml·.mxl) 5 MiB 이하. AI 서버가 드럼 파트를 채보로 바꾸고 BE가 음원 채보와 같은 규칙으로 "
					+ "HARD·NORMAL·EASY를 만들어 내 곡(source=MUSICXML)으로 저장한다. 요청 안에서 끝나며 응답은 곡 상세와 같다. 원본은 보관하지 않고 반주는 없다. "
					+ "이미지·PDF 악보는 받지 않는다.")
	@ApiResponse(responseCode = "201", description = "곡·채보 생성")
	@ApiResponse(responseCode = "400", description = "요청 형태·제목 오류, 빈 파일: MUSICXML_INVALID",
			content = @Content(mediaType = "application/problem+json", schema = @Schema(implementation = ApiErrorResponse.class)))
	@ApiResponse(responseCode = "413", description = "파일 5 MiB 초과: MUSICXML_TOO_LARGE",
			content = @Content(mediaType = "application/problem+json", schema = @Schema(implementation = ApiErrorResponse.class)))
	@ApiResponse(responseCode = "422", description = "MusicXML 아님·timewise·깨진 파일·길이 초과: MUSICXML_UNSUPPORTED(detail에 이유), 드럼 파트 없음: MUSICXML_NO_DRUM_NOTES",
			content = @Content(mediaType = "application/problem+json", schema = @Schema(implementation = ApiErrorResponse.class)))
	@ApiResponse(responseCode = "503", description = "AI 변환 서버 연결 불가·시간 초과·계약 밖 응답: MUSICXML_UNAVAILABLE",
			content = @Content(mediaType = "application/problem+json", schema = @Schema(implementation = ApiErrorResponse.class)))
	public ResponseEntity<SongDetail> upload(@Parameter(hidden = true) AuthUser me,
			@Parameter(description = "곡 제목, 1~100자") @RequestParam(value = "title", required = false) String title,
			@Parameter(description = "아티스트, 0~100자") @RequestParam(value = "artist", required = false) String artist,
			@RequestPart(value = "file", required = false) MultipartFile file, HttpServletRequest request) {
		var multipart = WebUtils.getNativeRequest(request, MultipartHttpServletRequest.class);
		if (multipart == null || multipart.getMultiFileMap().size() != 1 || multipart.getFiles("file").size() != 1
				|| !singleValues(request))
			throw new BusinessException(MusicXmlErrorCode.INVALID);
		var song = service.upload(me.id(), title, artist, file);
		return ResponseEntity.created(URI.create("/api/v1/songs/" + song.id()))
				.header(HttpHeaders.CACHE_CONTROL, "private, no-store").body(song);
	}

	/** 일반 필드는 title 1개와 선택 artist 1개만 허용한다. */
	private static boolean singleValues(HttpServletRequest request) {
		for (var entry : request.getParameterMap().entrySet()) {
			if (!entry.getKey().equals("title") && !entry.getKey().equals("artist")) return false;
			if (entry.getValue().length != 1) return false;
		}
		return true;
	}

}
