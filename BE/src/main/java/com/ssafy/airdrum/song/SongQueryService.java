package com.ssafy.airdrum.song;

import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import com.ssafy.airdrum.chart.*;
import com.ssafy.airdrum.common.error.BusinessException;
import com.ssafy.airdrum.common.response.PageResponse;
import static com.ssafy.airdrum.song.SongResponses.*;

@Service
@Transactional(readOnly = true)
public class SongQueryService {
	private final SongRepository songs;
	private final ChartVersionRepository versions;
	private final ChartQueryAccess access;
	public SongQueryService(SongRepository songs, ChartVersionRepository versions, ChartQueryAccess access) {
		this.songs = songs; this.versions = versions; this.access = access;
	}
	public PageResponse<SongSummary> list(long userId, SongScope scope, String q, int page, int size) {
		access.requireActive(userId);
		String pattern = "%" + (q == null ? "" : q.strip()).replace("!", "!!").replace("%", "!%").replace("_", "!_") + "%";
		var rows = songs.page(userId, scope.name(), pattern, size, (long) page * size);
		long total = songs.count(userId, scope.name(), pattern);
		Map<Long, List<ChartVersionRepository.Summary>> summaries = rows.isEmpty() ? Map.of() :
				versions.summaries(rows.stream().map(SongRepository.View::getId).toList(), userId)
						.stream().collect(Collectors.groupingBy(ChartVersionRepository.Summary::getSongId));
		var items = rows.stream().map(s -> new SongSummary(s.getId(), s.getTitle(), s.getArtist(), s.getSource(),
				s.getStatus(), s.getBpm(), s.getTimeSignature(), s.getDurationMs(), s.getHasAccompaniment(),
				summaries.getOrDefault(s.getId(), List.of()).stream().map(ChartVersionRepository.Summary::getDifficulty).toList(),
				s.getCreatedAt())).toList();
		return PageResponse.of(items, page, size, total);
	}
	public SongDetail detail(long userId, long songId) {
		access.requireActive(userId);
		var s = songs.visible(songId, userId).orElseThrow(() -> new BusinessException(ChartErrorCode.SONG_NOT_FOUND));
		var charts = versions.summaries(List.of(songId), userId).stream()
				.map(v -> new ChartSummary(v.getChartId(), v.getDifficulty(), v.getChartVersionId(), v.getVersion(),
						v.getNoteCount(), v.getNotationStatus())).toList();
		return new SongDetail(s.getId(), s.getTitle(), s.getArtist(), s.getSource(), s.getStatus(), s.getBpm(),
				s.getTimeSignature(), s.getDurationMs(), s.getHasAccompaniment(),
				charts.stream().map(ChartSummary::difficulty).toList(), s.getCreatedAt(), s.getLicense(), s.getUpdatedAt(), charts);
	}
}
