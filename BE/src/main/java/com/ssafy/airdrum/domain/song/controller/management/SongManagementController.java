package com.ssafy.airdrum.domain.song.controller.management;

import java.io.IOException;
import jakarta.servlet.http.HttpServletRequest;
import org.apache.commons.fileupload2.core.FileUploadSizeException;
import org.apache.commons.fileupload2.core.FileUploadFileCountLimitException;
import org.apache.commons.fileupload2.jakarta.servlet6.JakartaServletFileUpload;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.security.SecurityRequirement;
import tools.jackson.core.StreamReadFeature;
import tools.jackson.core.json.JsonFactory;
import tools.jackson.databind.DeserializationFeature;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;
import com.ssafy.airdrum.domain.song.dto.SongResponses;
import com.ssafy.airdrum.domain.song.exception.SongManagementError;
import com.ssafy.airdrum.domain.song.service.catalog.SongQueryService;
import com.ssafy.airdrum.domain.song.service.management.CoverImage;
import com.ssafy.airdrum.domain.song.service.management.SongManagementService;
import com.ssafy.airdrum.global.error.BusinessException;
import com.ssafy.airdrum.global.config.OpenApiConfig;
import com.ssafy.airdrum.domain.user.model.AuthUser;

@RestController
@RequestMapping("/api/v1/songs/{id}")
@SecurityRequirement(name=OpenApiConfig.BEARER_AUTH)
public class SongManagementController {
    private final SongManagementService service; private final SongQueryService query; private final CoverImage images;
    private final JsonMapper strict=JsonMapper.builder(JsonFactory.builder().enable(StreamReadFeature.STRICT_DUPLICATE_DETECTION).build())
            .enable(DeserializationFeature.FAIL_ON_TRAILING_TOKENS).build();
    public SongManagementController(SongManagementService service,SongQueryService query,CoverImage images) { this.service=service;this.query=query;this.images=images; }
    private BusinessException invalid() { return new BusinessException(SongManagementError.SONG_INVALID); }
    @PatchMapping(consumes=MediaType.APPLICATION_JSON_VALUE)
    @Operation(summary="내 곡 표시명 변경")
    public SongResponses.SongDetail patch(@Parameter(hidden=true) AuthUser user,@PathVariable long id,HttpServletRequest request) {
        JsonNode node;
        try { byte[] bytes=request.getInputStream().readNBytes(8193); if(bytes.length>8192) throw invalid(); node=strict.readTree(bytes); }
        catch(BusinessException ex) { throw ex; } catch(Exception ex) { throw invalid(); }
        if(node==null || !node.isObject() || node.isEmpty() || node.size()>2 || node.properties().stream().anyMatch(e->!e.getKey().equals("title") && !e.getKey().equals("artist"))) throw invalid();
        boolean hasTitle=node.has("title"),hasArtist=node.has("artist");
        if((hasTitle && !node.path("title").isString()) || (hasArtist && !node.path("artist").isString())) throw invalid();
        String title=hasTitle?node.path("title").asString().strip():null;
        String artist=hasArtist?node.path("artist").asString().strip():null;
        if(hasTitle && (title.isEmpty() || title.length()>100 || title.indexOf('\0')>=0)) throw invalid();
        if(hasArtist && (artist.length()>100 || artist.indexOf('\0')>=0)) throw invalid();
        if(hasArtist && artist.isEmpty()) artist=null;
        service.patch(user.id(),id,hasTitle,title,hasArtist,artist);
        return query.detail(user.id(),id);
    }
    public record CoverResponse(String coverUrl) {}
    @PutMapping("/cover")
    @Operation(summary="내 곡 커버 등록·교체")
    public CoverResponse cover(@Parameter(hidden=true) AuthUser user,@PathVariable long id,HttpServletRequest request) {
        service.requireWritable(user.id(),id);
        byte[] data;
        try {
            var upload=new JakartaServletFileUpload<>();
            upload.setMaxSize(CoverImage.MAX_BYTES+65536L); upload.setMaxFileSize(CoverImage.MAX_BYTES);
            upload.setMaxFileCount(1); upload.setMaxPartHeaderSize(8192);
            var iterator=upload.getItemIterator(request);
            if(!iterator.hasNext()) throw new BusinessException(SongManagementError.COVER_INVALID);
            var part=iterator.next();
            if(part.isFormField() || !"file".equals(part.getFieldName())) throw new BusinessException(SongManagementError.COVER_INVALID);
            try(var input=part.getInputStream()) { data=input.readNBytes(CoverImage.MAX_BYTES+1); }
            if(data.length>CoverImage.MAX_BYTES) throw new BusinessException(SongManagementError.COVER_TOO_LARGE);
            if(iterator.hasNext()) throw new BusinessException(SongManagementError.COVER_INVALID);
        } catch(BusinessException ex) { throw ex; }
        catch(FileUploadFileCountLimitException ex) { throw new BusinessException(SongManagementError.COVER_INVALID); }
        catch(FileUploadSizeException ex) { throw new BusinessException(SongManagementError.COVER_TOO_LARGE); }
        catch(Exception ex) { throw new BusinessException(SongManagementError.COVER_INVALID); }
        return new CoverResponse(service.upload(user.id(),id,images.decode(data)));
    }
    @DeleteMapping("/cover") @Operation(summary="내 곡 커버 삭제")
    public ResponseEntity<Void> deleteCover(@Parameter(hidden=true) AuthUser user,@PathVariable long id) { service.deleteCover(user.id(),id); return ResponseEntity.noContent().build(); }
    @DeleteMapping @Operation(summary="내 곡 삭제")
    public ResponseEntity<Void> delete(@Parameter(hidden=true) AuthUser user,@PathVariable long id) { service.deleteSong(user.id(),id); return ResponseEntity.noContent().build(); }
}
