package com.ssafy.airdrum.report;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.EnumMap;
import org.springframework.stereotype.Component;
import com.ssafy.airdrum.play.PlayUploadRequest;
import static com.ssafy.airdrum.play.PlayUploadRequest.*;
import static com.ssafy.airdrum.report.ReportAggregate.*;

/** 노트 검증을 통과한 요청만 집계한다. 판정·점수·MISS를 새로 만들지 않는다. */
@Component
public class ReportAggregator {
	private static final BigDecimal BIN_MS = BigDecimal.TEN;
	public ReportAggregate aggregate(PlayUploadRequest request) {
		if (!request.scored()) throw new IllegalArgumentException("판정 모드만 리포트를 생성합니다.");
		int extent = Math.max(1, BigDecimal.valueOf(request.judgementContext().timingWindows().goodMs())
				.divide(BIN_MS, 0, RoundingMode.CEILING).intValueExact()) * 10;
		Integer[] bins = new Integer[extent / 5];
		Arrays.fill(bins, 0);
		var pads = new EnumMap<Pad, Accumulator>(Pad.class);
		for (Pad pad : Pad.values()) pads.put(pad, new Accumulator());
		for (Hit hit : request.hits()) {
			if (hit.judgement() == null) continue;
			var pad = pads.get(hit.pad());
			if (hit.judgement() == Judgement.MISS) { pad.miss++; continue; }
			if (hit.judgement() == Judgement.PERFECT) pad.perfect++; else pad.good++;
			BigDecimal delta = BigDecimal.valueOf(hit.deltaMs());
			pad.delta = pad.delta.add(delta);
			pad.velocity += hit.velocity();
			// 십진수로 경계를 계산해 미세한 음수를 0ms 구간으로 반올림하지 않는다.
			int index = delta.add(BigDecimal.valueOf(extent)).divide(BIN_MS, 0, RoundingMode.FLOOR).intValueExact();
			index = Math.min(index, bins.length - 1); // 마지막 구간만 오른쪽 끝을 포함한다.
			bins[index]++;
		}
		var stats = new ArrayList<PadStats>();
		for (Pad pad : Pad.values()) stats.add(pads.get(pad).result(pad));
		return new ReportAggregate(new TimingHistogram(10, -extent, Arrays.asList(bins)), stats);
	}
	private static final class Accumulator {
		int perfect, good, miss;
		long velocity;
		BigDecimal delta = BigDecimal.ZERO;
		PadStats result(Pad pad) {
			int samples = perfect + good;
			int evaluated = samples + miss;
			BigDecimal accuracy = evaluated == 0 ? null : BigDecimal.valueOf(perfect * 10L + good * 6L)
					.divide(BigDecimal.valueOf(evaluated * 10L), 4, RoundingMode.HALF_UP);
			BigDecimal meanDelta = samples == 0 ? null : delta.divide(BigDecimal.valueOf(samples), 2, RoundingMode.HALF_UP);
			BigDecimal meanVelocity = samples == 0 ? null : BigDecimal.valueOf(velocity)
					.divide(BigDecimal.valueOf(samples), 2, RoundingMode.HALF_UP);
			return new PadStats(pad, accuracy, meanDelta, meanVelocity, new Counts(perfect, good, miss), samples);
		}
	}
}
