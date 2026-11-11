package com.ssafy.airdrum.domain.song.controller.midi;

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

import com.ssafy.airdrum.domain.song.exception.MidiErrorCode;
import com.ssafy.airdrum.domain.song.service.midi.MidiUploadService;
import com.ssafy.airdrum.global.error.ApiErrorResponse;
import com.ssafy.airdrum.global.error.BusinessException;
import com.ssafy.airdrum.global.config.OpenApiConfig;
import com.ssafy.airdrum.domain.song.dto.SongResponses.SongDetail;
import com.ssafy.airdrum.domain.user.model.AuthUser;

/** CHART-002 MIDI 업로드. 요청 안에서 변환해 내 곡으로 저장한다. */
@RestController
@RequestMapping("/api/v1/songs/midi")
@SecurityRequirement(name = OpenApiConfig.BEARER_AUTH)
@ApiResponse(responseCode = "401", description = "인증 필요", content = @Content(mediaType = "application/problem+json", schema = @Schema(implementation = ApiErrorResponse.class)))
public class MidiUploadController {

	private final MidiUploadService service;

	MidiUploadController(MidiUploadService service) {
		this.service = service;
	}

	@PostMapping(consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
	@Operation(summary = "MIDI 업로드 → 채보 변환",
			description = "표준 MIDI(format 0·1) 1 MiB 이하. 드럼 채널(10)의 GM 노트를 패드로 바꿔 EASY·NORMAL·HARD 채보를 만들고 "
					+ "내 곡으로 저장한다. 응답은 곡 상세와 같다. 원본은 비공개로 보관하며 드럼 외 노트가 있으면 반주를 별도로 비동기 생성한다.")
	@ApiResponse(responseCode = "201", description = "곡·채보 생성")
	@ApiResponse(responseCode = "400", description = "요청 형태·제목 오류: MIDI_INVALID",
			content = @Content(mediaType = "application/problem+json", schema = @Schema(implementation = ApiErrorResponse.class)))
	@ApiResponse(responseCode = "413", description = "파일 1 MiB 초과: MIDI_TOO_LARGE",
			content = @Content(mediaType = "application/problem+json", schema = @Schema(implementation = ApiErrorResponse.class)))
	@ApiResponse(responseCode = "422", description = "변환 불가: MIDI_UNSUPPORTED, 드럼 노트 없음: MIDI_NO_DRUM_NOTES",
			content = @Content(mediaType = "application/problem+json", schema = @Schema(implementation = ApiErrorResponse.class)))
	@ApiResponse(responseCode = "503", description = "원본 저장소 장애 또는 접수 시간 초과: MIDI_STORAGE_UNAVAILABLE",
			content = @Content(mediaType = "application/problem+json", schema = @Schema(implementation = ApiErrorResponse.class)))
	public ResponseEntity<SongDetail> upload(@Parameter(hidden = true) AuthUser me,
			@Parameter(description = "곡 제목, 1~100자") @RequestParam(value = "title", required = false) String title,
			@Parameter(description = "아티스트, 0~100자") @RequestParam(value = "artist", required = false) String artist,
			@RequestPart(value = "file", required = false) MultipartFile file, HttpServletRequest request) {
		var multipart = WebUtils.getNativeRequest(request, MultipartHttpServletRequest.class);
		if (multipart == null || multipart.getMultiFileMap().size() != 1 || multipart.getFiles("file").size() != 1
				|| !singleValues(request))
			throw new BusinessException(MidiErrorCode.INVALID);
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
		return request.getParameterMap().containsKey("title");
	}

}
