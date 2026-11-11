package com.ssafy.airdrum.domain.song.service.catalog;

import java.util.List;
import java.util.Map;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import com.ssafy.airdrum.domain.song.model.SongScope;
import com.ssafy.airdrum.domain.song.repository.SongRepository;
import com.ssafy.airdrum.domain.chart.exception.ChartErrorCode;
import com.ssafy.airdrum.domain.chart.dto.ChartResponses.ChartSummary;
import com.ssafy.airdrum.domain.chart.service.query.ChartQueryService;
import com.ssafy.airdrum.domain.chart.service.query.ChartQueryAccess;
import com.ssafy.airdrum.domain.chart.exception.JobErrors;
import com.ssafy.airdrum.domain.chart.dto.job.JobSnapshot.JobError;
import com.ssafy.airdrum.global.error.BusinessException;
import com.ssafy.airdrum.global.response.PageResponse;
import com.ssafy.airdrum.domain.song.model.SongMetadata;
import com.ssafy.airdrum.domain.song.repository.SongMetadataRepository;
import static com.ssafy.airdrum.domain.song.dto.SongResponses.*;

@Service
@Transactional(readOnly = true)
public class SongQueryService {
	private final SongRepository songs;
	private final ChartQueryService charts;
	private final ChartQueryAccess access;
	private final CoverUrls covers;
	private final SongMetadataRepository metadata;
	public SongQueryService(SongRepository songs, ChartQueryService charts, ChartQueryAccess access, CoverUrls covers, SongMetadataRepository metadata) {
		this.songs = songs; this.charts = charts; this.access = access; this.covers=covers; this.metadata=metadata;
	}
	/** 이미 선별된 곡의 메타데이터를 한 번에 조회한다. */
	public Map<Long, SongMetadata> metadataByIds(List<Long> ids) { return metadata.findBySongIds(ids); }
	public PageResponse<SongSummary> list(long userId, SongScope scope, String q, String level, boolean playableOnly, boolean withAccompaniment, int page, int size) {
		access.requireActive(userId);
		String pattern = "%" + (q == null ? "" : q.strip()).replace("!", "!!").replace("%", "!%").replace("_", "!_") + "%";
		var rows = songs.page(userId, scope.name(), pattern, level, playableOnly, withAccompaniment, size, (long) page * size);
		long total = songs.count(userId, scope.name(), pattern, level, playableOnly, withAccompaniment);
		var summaries = charts.summaries(userId, rows.stream().map(SongRepository.View::getId).toList());
		var coverUrls=covers.forSongs(userId,rows);
		var items = rows.stream().map(s -> summary(s, summaries, coverUrls)).toList();
		return PageResponse.of(items, page, size, total);
	}
	/** 추천이 곡 목록과 같은 모양의 요약을 쓰도록, 보이는 곡만 주어진 순서대로 돌려준다(없거나 못 보는 곡은 건너뜀). */
	public List<SongSummary> byIds(long userId, List<Long> ids) {
		var rows = ids.stream().map(id -> songs.visible(id, userId)).flatMap(java.util.Optional::stream).toList();
		if (rows.isEmpty()) return List.of();
		var summaries = charts.summaries(userId, rows.stream().map(SongRepository.View::getId).toList());
		var coverUrls = covers.forSongs(userId, rows);
		return rows.stream().map(s -> summary(s, summaries, coverUrls)).toList();
	}
	private SongSummary summary(SongRepository.View s, Map<Long, List<ChartSummary>> summaries, Map<Long, String> coverUrls) {
		return new SongSummary(s.getId(), s.getTitle(), s.getArtist(), s.getSource(),
				s.getStatus(), s.getBpm(), s.getTimeSignature(), s.getDurationMs(), s.getHasAccompaniment(), s.getAccompanimentStatus(),
				summaries.getOrDefault(s.getId(), List.of()).stream().map(ChartSummary::difficulty).toList(),
				s.getCreatedAt(), coverUrls.get(s.getId()), s.getSongLevel(), failure(s), s.getSheetId());
	}
	public SongDetail detail(long userId, long songId) {
		access.requireActive(userId);
		var s = songs.visible(songId, userId).orElseThrow(() -> new BusinessException(ChartErrorCode.SONG_NOT_FOUND));
		var chartSummaries = charts.summaries(userId, List.of(songId)).getOrDefault(songId, List.of());
		return new SongDetail(s.getId(), s.getTitle(), s.getArtist(), s.getSource(), s.getStatus(), s.getBpm(),
				s.getTimeSignature(), s.getDurationMs(), s.getHasAccompaniment(), s.getAccompanimentStatus(),
				chartSummaries.stream().map(ChartSummary::difficulty).toList(), s.getCreatedAt(), s.getLicense(), s.getUpdatedAt(), chartSummaries,covers.forSongs(userId,List.of(s)).get(s.getId()),s.getSongLevel(),failure(s),
				s.getSheetId());
	}
	private JobError failure(SongRepository.View song) {
		return "FAILED".equals(song.getStatus()) && "FAILED".equals(song.getJobStatus()) ? JobErrors.safe(song.getJobErrorCode(),song.getJobErrorReason()) : null;
	}
}
