package com.ssafy.airdrum.domain.lesson.service;

import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.Map;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.ssafy.airdrum.domain.lesson.dto.LessonsResponse;
import com.ssafy.airdrum.domain.lesson.model.LessonKind;
import com.ssafy.airdrum.domain.lesson.model.LessonSpec;
import com.ssafy.airdrum.domain.lesson.repository.LessonRepository;
import com.ssafy.airdrum.domain.auth.security.AuthenticationService;
import com.ssafy.airdrum.domain.chart.exception.ChartErrorCode;
import com.ssafy.airdrum.global.error.BusinessException;
import com.ssafy.airdrum.global.error.CommonErrorCode;
import com.ssafy.airdrum.domain.play.service.history.PlayQueryService;

/**
 * 입문 코스 진도(331번 설계 4-2절). 연주 레슨의 통과는 이미 저장되는 악보 연습 기록에서 계산하고, 알아보기 레슨만 완료 기록을 쓴다.
 * 잠금은 화면 안내라 서버는 순서를 강제하지 않는다.
 */
@Service
public class LessonService {

	/** 연주 레슨 통과 기준 정확도(백분율). */
	static final int PASS_ACCURACY = 70;
	private static final BigDecimal PASS = BigDecimal.valueOf(PASS_ACCURACY);

	private final LessonRepository lessons;
	private final PlayQueryService plays;
	private final AuthenticationService authentication;

	LessonService(LessonRepository lessons, PlayQueryService plays, AuthenticationService authentication) {
		this.lessons = lessons;
		this.plays = plays;
		this.authentication = authentication;
	}

	/** 카탈로그 레슨을 한 트랜잭션에서 전체 교체한다. */
	@Transactional
	public void replaceAll(Map<Long, LessonSpec> lessonSongs) {
		lessons.replaceAll(lessonSongs);
	}

	@Transactional(readOnly = true)
	public LessonsResponse list(long userId) {
		requireActive(userId);
		var rows = lessons.visible();
		var best = new HashMap<Long, BigDecimal>();
		if (!rows.isEmpty()) {
			var chartOf = new HashMap<Long, Long>();
			for (var row : rows) chartOf.put(row.songId(), row.chartId());
			for (var record : plays.bestForUser(userId, rows.stream().map(LessonRepository.Row::songId).toList())) {
				if (!"SHEET".equals(record.mode()) || record.bestAccuracy() == null) continue;
				if (record.chartId() != chartOf.getOrDefault(record.songId(), -1L)) continue;
				best.merge(record.songId(), record.bestAccuracy(), BigDecimal::max);
			}
		}
		var completed = rows.isEmpty() ? java.util.Set.<Long>of() : lessons.completed(userId);
		var items = new ArrayList<LessonsResponse.Item>();
		boolean blocked = false;
		for (var row : rows) {
			BigDecimal accuracy = row.kind() == LessonKind.PLAY ? best.get(row.songId()) : null;
			boolean passed = row.kind() == LessonKind.READ ? completed.contains(row.songId()) : accuracy != null && accuracy.compareTo(PASS) >= 0;
			items.add(new LessonsResponse.Item(row.position(), row.kind().name(), row.songId(), row.chartId(), row.title(), row.summary(), row.pads(),
					row.guide(), row.bpm(), row.durationMs(), row.noteCount(), accuracy, passed, blocked));
			if (!passed) blocked = true;
		}
		return new LessonsResponse(PASS_ACCURACY, items);
	}

	/** 알아보기 레슨 완료. 이미 완료했으면 아무것도 바꾸지 않는다. */
	@Transactional
	public void complete(long userId, long songId) {
		requireActive(userId);
		var kind = lessons.kind(songId).orElseThrow(() -> new BusinessException(ChartErrorCode.SONG_NOT_FOUND));
		if (kind != LessonKind.READ) throw new BusinessException(CommonErrorCode.VALIDATION_FAILED);
		lessons.complete(userId, songId);
	}

	private void requireActive(long userId) {
		if (authentication.findActive(userId).isEmpty()) throw new BusinessException(CommonErrorCode.UNAUTHORIZED);
	}
}
