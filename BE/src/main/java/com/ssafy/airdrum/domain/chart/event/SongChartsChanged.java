package com.ssafy.airdrum.domain.chart.event;

/** 곡의 채보·난이도가 저장됐다. 커밋 뒤 채보 특징을 계산하라는 신호이며 개인정보는 싣지 않는다. */
public record SongChartsChanged(long songId) {}
