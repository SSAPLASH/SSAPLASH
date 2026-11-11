package com.ssafy.airdrum.domain.song.controller.audio;

import com.ssafy.airdrum.domain.song.exception.AudioErrorCode;
import com.ssafy.airdrum.domain.song.repository.audio.AudioUploadRepository;
import com.ssafy.airdrum.domain.song.service.audio.AudioUploadService;
import com.ssafy.airdrum.global.error.BusinessException;
import com.ssafy.airdrum.global.config.OpenApiConfig;
import com.ssafy.airdrum.domain.user.model.AuthUser;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import io.swagger.v3.oas.annotations.security.SecurityRequirement;

import jakarta.servlet.http.HttpServletRequest;

import org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;
import org.springframework.web.multipart.MultipartHttpServletRequest;
import org.springframework.web.util.WebUtils;

@RestController
@ConditionalOnWebApplication(type = ConditionalOnWebApplication.Type.SERVLET)
@RequestMapping("/api/v1/songs/audio")
@SecurityRequirement(name = OpenApiConfig.BEARER_AUTH)
public class AudioUploadController {
    private final AudioUploadService service;

    public AudioUploadController(AudioUploadService service) {
        this.service = service;
    }

    @Operation(
            summary = "음원 접수",
            description = "MP3/WAV, MPEG-4 오디오(AAC/ALAC), Ogg Opus, 최대 50MiB와 10분. 같은 UUID 요청 키·내용은 기존 작업을 반환합니다.")
    @ApiResponse(responseCode = "202", description = "접수 또는 동일 요청 재전송")
    @ApiResponse(responseCode = "409", description = "같은 키에 다른 내용")
    @ApiResponse(responseCode = "413", description = "파일 또는 요청 크기 초과")
    @ApiResponse(responseCode = "422", description = "지원하지 않는 음원이나 길이")
    @ApiResponse(responseCode = "429", description = "다른 활성 작업 존재")
    @ApiResponse(responseCode = "503", description = "검사 도구 또는 저장소 장애")
    @PostMapping(consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public ResponseEntity<AudioUploadRepository.Response> upload(
            @Parameter(hidden = true) AuthUser me,
            @RequestHeader("Idempotency-Key") String key,
            @RequestParam("title") String title,
            @RequestParam(value = "artist", required = false) String artist,
            @RequestPart("file") MultipartFile file,
            HttpServletRequest request) {
        var m = WebUtils.getNativeRequest(request, MultipartHttpServletRequest.class);
        if (m == null
                || m.getMultiFileMap().size() != 1
                || m.getFiles("file").size() != 1
                || request.getParameterMap().size() > (artist == null ? 1 : 2)
                || request.getParameterValues("title").length != 1
                || (artist != null && request.getParameterValues("artist").length != 1))
            throw new BusinessException(AudioErrorCode.INVALID);
        return ResponseEntity.accepted().body(service.upload(me.id(), key, title, artist, file));
    }
}
