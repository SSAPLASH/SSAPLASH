package com.ssafy.airdrum.play.web;

import java.io.IOException;
import java.util.UUID;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;
import org.springframework.web.multipart.MultipartHttpServletRequest;
import org.springframework.web.util.WebUtils;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.media.Content;
import io.swagger.v3.oas.annotations.media.Schema;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import io.swagger.v3.oas.annotations.security.SecurityRequirement;
import com.ssafy.airdrum.config.OpenApiConfig;
import com.ssafy.airdrum.user.AuthUser;
import com.ssafy.airdrum.play.*;
import com.ssafy.airdrum.play.raw.PlayRawUploadService;
import static com.ssafy.airdrum.play.PlayUploadValidator.check;

@RestController
@RequestMapping("/api/v1/plays")
@SecurityRequirement(name=OpenApiConfig.BEARER_AUTH)
public class PlayUploadController {
	private final PlayJson json;
	private final PlayUploadService plays;
	private final PlayRawUploadService raw;
	public PlayUploadController(PlayJson json,PlayUploadService plays,PlayRawUploadService raw) { this.json=json; this.plays=plays; this.raw=raw; }
	@PostMapping(consumes=MediaType.APPLICATION_JSON_VALUE)
	@Operation(summary="플레이 요약·전체 hits 저장",description="schemaVersion 1. 신규 201, 동일 UUID·내용 재전송 200, 다른 내용 409. 신규 RHYTHM·SHEET는 BE 집계 리포트를 함께 저장합니다. rawLogStatus는 원본 로그 업로드 상태입니다.",
			requestBody=@io.swagger.v3.oas.annotations.parameters.RequestBody(required=true,content=@Content(schema=@Schema(implementation=PlayUploadRequest.class))))
	@ApiResponse(responseCode="201",description="최초 저장",content=@Content(schema=@Schema(implementation=PlayUploadResponse.class)))
	@ApiResponse(responseCode="200",description="동일 요청 재전송",content=@Content(schema=@Schema(implementation=PlayUploadResponse.class)))
	public ResponseEntity<PlayUploadResponse> upload(@Parameter(hidden=true) AuthUser me,HttpServletRequest request) throws IOException {
		var result=plays.upload(me.id(),json.read(request.getInputStream()));
		return ResponseEntity.status(result.created()?201:200).body(result);
	}
	@PostMapping(value="/{playId}/raw",consumes=MediaType.MULTIPART_FORM_DATA_VALUE)
	@Operation(summary="플레이 gzip 원본 접수",description="file 하나. 요약 저장 후 최초 JSON 바이트를 보관·재전송합니다. 키보드/센서 없는 로그의 raw hits는 빈 배열입니다.")
	@ApiResponse(responseCode="204",description="접수 또는 동일 원본 재전송")
	public ResponseEntity<Void> raw(@Parameter(hidden=true) AuthUser me,@PathVariable UUID playId,
			@RequestPart("file") MultipartFile file,HttpServletRequest request) throws Exception {
		var multipart=WebUtils.getNativeRequest(request,MultipartHttpServletRequest.class);
		check(multipart!=null && multipart.getMultiFileMap().size()==1 && multipart.getFiles("file").size()==1 && request.getParameterMap().isEmpty());
		raw.upload(me.id(),playId,file);
		return ResponseEntity.noContent().build();
	}
}
