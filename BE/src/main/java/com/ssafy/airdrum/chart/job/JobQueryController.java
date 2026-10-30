package com.ssafy.airdrum.chart.job;

import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.Positive;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.security.SecurityRequirement;
import com.ssafy.airdrum.common.response.PageResponse;
import com.ssafy.airdrum.config.OpenApiConfig;
import com.ssafy.airdrum.user.AuthUser;

@RestController
@RequestMapping("/api/v1/jobs")
@SecurityRequirement(name=OpenApiConfig.BEARER_AUTH)
public class JobQueryController {
    private final JobQueryService jobs;
    public JobQueryController(JobQueryService jobs) { this.jobs=jobs; }
    @GetMapping("/{jobId}")
    @Operation(summary="내 채보 작업 상태 조회")
    public JobSnapshot detail(@Parameter(hidden=true) AuthUser user,@PathVariable @Positive long jobId) { return jobs.detail(user.id(),jobId); }
    @GetMapping
    @Operation(summary="내 채보 작업 목록")
    public PageResponse<JobSnapshot> list(@Parameter(hidden=true) AuthUser user,@RequestParam(required=false) JobSnapshot.Status status,
            @RequestParam(defaultValue="0") @Min(0) @Max(100000) int page,
            @RequestParam(defaultValue="20") @Min(1) @Max(100) int size) { return jobs.list(user.id(),status,page,size); }
}
