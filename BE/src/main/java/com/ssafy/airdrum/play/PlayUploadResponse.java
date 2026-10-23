package com.ssafy.airdrum.play;

import java.util.UUID;
import com.fasterxml.jackson.annotation.JsonIgnore;
import io.swagger.v3.oas.annotations.media.Schema;

public record PlayUploadResponse(UUID playId, String rawLogStatus, @JsonIgnore @Schema(hidden = true) boolean created) {}
