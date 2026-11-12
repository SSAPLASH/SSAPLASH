package com.ssafy.airdrum.global.media;

import static org.assertj.core.api.Assertions.*;
import org.junit.jupiter.api.Test;

class AudioDurationTest {
    @Test void decimalRoundingIsExactAndBoundsRemainStrict() {
        assertThat(AudioDuration.milliseconds("4.001000")).isEqualTo(4001);
        assertThat(AudioDuration.milliseconds("4.030000")).isEqualTo(4030);
        assertThat(AudioDuration.milliseconds("4.00100000000000001")).isEqualTo(4002);
        assertThat(AudioDuration.milliseconds("0.000001")).isEqualTo(1);
        assertThat(AudioDuration.milliseconds("1e-10000")).isEqualTo(1);
        assertThat(AudioDuration.milliseconds("600.000000")).isEqualTo(600000);
        for (String invalid : new String[] {"", "N/A", "NaN", "Infinity", "-Infinity", "0", "-0.001", "600.000001", "1e9999999999"}) {
            assertThatThrownBy(() -> AudioDuration.milliseconds(invalid)).isInstanceOf(IllegalArgumentException.class);
        }
    }
}
