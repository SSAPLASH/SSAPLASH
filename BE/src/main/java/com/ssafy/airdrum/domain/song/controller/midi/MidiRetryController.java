package com.ssafy.airdrum.domain.song.controller.midi;

import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RestController;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.security.SecurityRequirement;
import com.ssafy.airdrum.domain.song.service.midi.MidiRetryService;
import com.ssafy.airdrum.domain.user.model.AuthUser;
import com.ssafy.airdrum.global.config.OpenApiConfig;

@RestController
@SecurityRequirement(name = OpenApiConfig.BEARER_AUTH)
public class MidiRetryController {
    private final MidiRetryService service;

    public MidiRetryController(MidiRetryService service) {
        this.service = service;
    }

    @PostMapping("/api/v1/songs/{songId}/accompaniment/retry")
    @Operation(summary = "실패한 내 MIDI 반주 재시도")
    public ResponseEntity<Void> retry(@Parameter(hidden = true) AuthUser user, @PathVariable long songId) {
        service.retry(user.id(), songId);
        return ResponseEntity.accepted().build();
    }
}
