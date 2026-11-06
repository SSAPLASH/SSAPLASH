package com.ssafy.airdrum.song;

import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import com.ssafy.airdrum.chart.*;
import com.ssafy.airdrum.chart.job.JobErrors;
import com.ssafy.airdrum.chart.job.JobSnapshot.JobError;
import com.ssafy.airdrum.common.error.BusinessException;
import com.ssafy.airdrum.common.response.PageResponse;
import static com.ssafy.airdrum.song.SongResponses.*;

@Service
@Transactional(readOnly = true)
public class SongQueryService {
	private final SongRepository songs;
	private final ChartVersionRepository versions;
	private final ChartQueryAccess access;
	private final CoverUrls covers;
	public SongQueryService(SongRepository songs, ChartVersionRepository versions, ChartQueryAccess access, CoverUrls covers) {
		this.songs = songs; this.versions = versions; this.access = access; this.covers=covers;
	}
	public PageResponse<SongSummary> list(long userId, SongScope scope, String q, String level, boolean playableOnly, int page, int size) {
		access.requireActive(userId);
		String pattern = "%" + (q == null ? "" : q.strip()).replace("!", "!!").replace("%", "!%").replace("_", "!_") + "%";
		var rows = songs.page(userId, scope.name(), pattern, level, playableOnly, size, (long) page * size);
		long total = songs.count(userId, scope.name(), pattern, level, playableOnly);
		Map<Long, List<ChartVersionRepository.Summary>> summaries = rows.isEmpty() ? Map.of() :
				versions.summaries(rows.stream().map(SongRepository.View::getId).toList(), userId)
						.stream().collect(Collectors.groupingBy(ChartVersionRepository.Summary::getSongId));
		var coverUrls=covers.forSongs(userId,rows);
		var items = rows.stream().map(s -> summary(s, summaries, coverUrls)).toList();
		return PageResponse.of(items, page, size, total);
	}
	/** 추천이 곡 목록과 같은 모양의 요약을 쓰도록, 보이는 곡만 주어진 순서대로 돌려준다(없거나 못 보는 곡은 건너뜀). */
	public List<SongSummary> byIds(long userId, List<Long> ids) {
		var rows = ids.stream().map(id -> songs.visible(id, userId)).flatMap(java.util.Optional::stream).toList();
		if (rows.isEmpty()) return List.of();
		Map<Long, List<ChartVersionRepository.Summary>> summaries = versions.summaries(rows.stream().map(SongRepository.View::getId).toList(), userId)
				.stream().collect(Collectors.groupingBy(ChartVersionRepository.Summary::getSongId));
		var coverUrls = covers.forSongs(userId, rows);
		return rows.stream().map(s -> summary(s, summaries, coverUrls)).toList();
	}
	private SongSummary summary(SongRepository.View s, Map<Long, List<ChartVersionRepository.Summary>> summaries, Map<Long, String> coverUrls) {
		return new SongSummary(s.getId(), s.getTitle(), s.getArtist(), s.getSource(),
				s.getStatus(), s.getBpm(), s.getTimeSignature(), s.getDurationMs(), s.getHasAccompaniment(), s.getAccompanimentStatus(),
				distinct(summaries.getOrDefault(s.getId(), List.of())).stream().map(ChartVersionRepository.Summary::getDifficulty).toList(),
				s.getCreatedAt(), coverUrls.get(s.getId()), s.getSongLevel(), failure(s), s.getSheetId());
	}
	public SongDetail detail(long userId, long songId) {
		access.requireActive(userId);
		var s = songs.visible(songId, userId).orElseThrow(() -> new BusinessException(ChartErrorCode.SONG_NOT_FOUND));
		var charts = distinct(versions.summaries(List.of(songId), userId)).stream()
				.map(v -> new ChartSummary(v.getChartId(), v.getDifficulty(), v.getChartVersionId(), v.getVersion(),
						v.getNoteCount(), v.getNotationStatus())).toList();
		return new SongDetail(s.getId(), s.getTitle(), s.getArtist(), s.getSource(), s.getStatus(), s.getBpm(),
				s.getTimeSignature(), s.getDurationMs(), s.getHasAccompaniment(), s.getAccompanimentStatus(),
				charts.stream().map(ChartSummary::difficulty).toList(), s.getCreatedAt(), s.getLicense(), s.getUpdatedAt(), charts,covers.forSongs(userId,List.of(s)).get(s.getId()),s.getSongLevel(),failure(s),
				s.getSheetId());
	}
	/**
	 * 노트가 NORMAL과 같은 HARD·EASY를 뺀다(260번 설계 3-4절). NORMAL·EASY는 HARD에서 노트를 빼기만 해서 만들므로
	 * 최신 버전 노트 수가 같으면 같은 채보로 본다. NORMAL은 항상 남기고, NORMAL이 없는 곡은 그대로 둔다.
	 * 저장된 채보는 지우지 않으므로 채보 직접 조회·플레이 기록·ADMIN 응답에는 영향이 없다.
	 */
	static List<ChartVersionRepository.Summary> distinct(List<ChartVersionRepository.Summary> charts) {
		var normal = charts.stream().filter(c -> "NORMAL".equals(c.getDifficulty())).findFirst().orElse(null);
		if (normal == null) return charts;
		return charts.stream().filter(c -> c == normal || c.getNoteCount() != normal.getNoteCount()).toList();
	}
	private JobError failure(SongRepository.View song) {
		return "FAILED".equals(song.getStatus()) && "FAILED".equals(song.getJobStatus()) ? JobErrors.safe(song.getJobErrorCode()) : null;
	}
}
