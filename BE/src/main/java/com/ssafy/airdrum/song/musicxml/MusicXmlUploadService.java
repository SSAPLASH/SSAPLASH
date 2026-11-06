package com.ssafy.airdrum.song.musicxml;

import java.io.IOException;
import java.util.List;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.web.multipart.MultipartFile;

import com.ssafy.airdrum.chart.worker.TranscriptionCharts;
import com.ssafy.airdrum.common.error.BusinessException;
import com.ssafy.airdrum.song.SongLevelService;
import com.ssafy.airdrum.song.SongQueryService;
import com.ssafy.airdrum.song.SongResponses.SongDetail;

/**
 * MusicXML 업로드 → AI 변환 → 내 곡 저장(293번 설계 4장). 바이트 검사 → {@code ai-api} 동기 호출 → 음원 워커와 같은 검증·3난이도 파생 →
 * 한 트랜잭션에 곡·채보 3개. AI 호출 전에는 DB를 건드리지 않으므로 거절·장애 때 곡 행이 남지 않는다. 원본 파일은 보관하지 않는다(설계 U3).
 */
@Service
public class MusicXmlUploadService {

	private static final Logger log = LoggerFactory.getLogger(MusicXmlUploadService.class);
	private static final int TEXT_LIMIT = 100;
	private static final List<String> DIFFICULTIES = List.of("HARD", "NORMAL", "EASY");

	private final MusicXmlConvertClient client;
	private final TranscriptionCharts charts;
	private final MusicXmlChartRepository repository;
	private final SongQueryService songs;
	private final SongLevelService levels;
	private final TransactionTemplate tx;

	MusicXmlUploadService(MusicXmlConvertClient client, TranscriptionCharts charts, MusicXmlChartRepository repository,
			SongQueryService songs, SongLevelService levels, PlatformTransactionManager manager) {
		this.client = client;
		this.charts = charts;
		this.repository = repository;
		this.songs = songs;
		this.levels = levels;
		this.tx = new TransactionTemplate(manager);
		this.tx.setTimeout(15);
	}

	SongDetail upload(long userId, String title, String artist, MultipartFile file) {
		String cleanTitle = text(title);
		String cleanArtist = text(artist);
		if (cleanTitle == null || file == null) throw new BusinessException(MusicXmlErrorCode.INVALID);
		byte[] bytes = read(file);
		var kind = MusicXmlSniffer.sniff(bytes);
		var converted = client.convert(bytes, kind);
		TranscriptionCharts.ChartData data;
		try {
			data = charts.parse(converted.chart(), converted.durationMs());
		} catch (BusinessException ex) {
			// AI가 계약 밖 채보를 보낸 것이라 사용자 입력 문제가 아니다
			log.warn("musicxml chart from ai-api violates contract: {}", ex.getErrorCode().code());
			throw new BusinessException(MusicXmlErrorCode.UNAVAILABLE);
		}
		Long songId = tx.execute(s -> {
			repository.requireActive(userId);
			long id = repository.insertSong(userId, cleanTitle, cleanArtist, data, converted.durationMs());
			for (var difficulty : DIFFICULTIES) repository.insertVersion(repository.insertChart(id, difficulty), difficulty, data);
			levels.process(id, true);
			return id;
		});
		return songs.detail(userId, songId);
	}

	/** 선언 크기를 믿지 않고 상한 + 1바이트까지 읽어 넘치면 413. */
	private static byte[] read(MultipartFile file) {
		if (file.getSize() > MusicXmlSniffer.MAX_BYTES) throw new BusinessException(MusicXmlErrorCode.TOO_LARGE);
		try (var in = file.getInputStream()) {
			byte[] bytes = in.readNBytes(MusicXmlSniffer.MAX_BYTES + 1);
			if (bytes.length > MusicXmlSniffer.MAX_BYTES) throw new BusinessException(MusicXmlErrorCode.TOO_LARGE);
			return bytes;
		} catch (IOException ex) {
			throw new BusinessException(MusicXmlErrorCode.INVALID);
		}
	}

	/** 앞뒤 공백 제거 후 1~100자, U+0000 없음. 비면 null(아티스트는 null 허용, 제목은 호출자가 거절). */
	private static String text(String value) {
		if (value == null) return null;
		String stripped = value.strip();
		if (stripped.isEmpty()) return null;
		if (stripped.length() > TEXT_LIMIT || stripped.indexOf(0) >= 0) throw new BusinessException(MusicXmlErrorCode.INVALID);
		return stripped;
	}

}
