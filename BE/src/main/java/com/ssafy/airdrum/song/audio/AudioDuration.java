package com.ssafy.airdrum.song.audio;

import java.math.BigDecimal;
import java.math.RoundingMode;

/** ffprobe가 출력한 초 단위 십진수를 밀리초 올림 값으로 변환한다. */
public final class AudioDuration {
    private static final BigDecimal MAX_SECONDS = BigDecimal.valueOf(600);
    private static final BigDecimal ONE_MILLISECOND = new BigDecimal("0.001");
    private AudioDuration() {}

    public static int milliseconds(String raw) {
        if (raw == null || raw.length() > 128) throw new IllegalArgumentException("유효하지 않은 음원 길이");
        BigDecimal seconds = new BigDecimal(raw.trim());
        if (seconds.signum() <= 0 || seconds.compareTo(MAX_SECONDS) > 0)
            throw new IllegalArgumentException("유효하지 않은 음원 길이");
        // 매우 작은 지수의 입력도 큰 중간 정수를 만들지 않고 올림한다.
        if (seconds.compareTo(ONE_MILLISECOND) <= 0) return 1;
        return seconds.movePointRight(3).setScale(0, RoundingMode.CEILING).intValueExact();
    }
}
