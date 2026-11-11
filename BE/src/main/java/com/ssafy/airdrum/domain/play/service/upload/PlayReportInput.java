package com.ssafy.airdrum.domain.play.service.upload;

import com.ssafy.airdrum.domain.play.dto.PlayUploadRequest;
import com.ssafy.airdrum.domain.report.model.ReportSummaryInput;

final class PlayReportInput {
	private PlayReportInput() {}
	static ReportSummaryInput from(PlayUploadRequest request) {
		return new ReportSummaryInput(request.judgementContext().timingWindows().goodMs(),
				request.hits().stream().map(hit -> new ReportSummaryInput.Hit(
						ReportSummaryInput.Pad.valueOf(hit.pad().name()),
						hit.judgement() == null ? null : ReportSummaryInput.Judgement.valueOf(hit.judgement().name()),
						hit.deltaMs(), hit.velocity())).toList());
	}
}
