package com.ssafy.airdrum.domain.chart.service.generation;

import java.math.BigDecimal;

/** 채보 저장 트랜잭션 안에서 곡을 완료하고 난이도를 갱신한다. */
public interface TranscriptionSongCompletion {
    void complete(long songId, BigDecimal bpm, int offsetMs, String timeSignature);
}
