// 사운드 세트: 소리의 출처를 묶는 단위. 합성음(synth)은 코드에 내장, 샘플 세트는 kit-config.json을 읽어 만든다.
// 세트를 바꿔도 입력·판정·텔레메트리는 모른다. 파일 하나가 실패하면 그 패드만 합성음으로 폴백한다.
import type { PadId } from '@/domain/kit/pads';
import { resolveKitPads, resolveKitVariants, type KitConfig, type KitVariantId } from './kitConfig';

import type { SoundSetId } from '@/domain/kit/soundSet';

export type { SoundSetId };

export interface SamplePad {
  buffer: AudioBuffer;
  gain: number;
  playbackRate: number;
}

export interface SoundSet {
  id: SoundSetId;
  label: string;
  kind: 'synth' | 'sample';
  /** kit.masterVolume. 샘플 게인에 곱하는 키트 트림. synth는 1 */
  masterTrim: number;
  /** synth는 비어 있다 */
  pads: Partial<Record<PadId, SamplePad>>;
  /** 선택 변형 샘플(하이햇 열림 등). 키트에 항목이 없으면 비어 있고 missing에 넣지 않는다 */
  variants: Partial<Record<KitVariantId, SamplePad>>;
  /** 샘플이 없어 합성음으로 폴백하는 패드 */
  missing: PadId[];
}

/**
 * 샘플이 없는 패드가 대신 쓰는 패드 샘플 (AudioEngine이 게인 0.7배로 재생).
 * 키트에 hihat_pedal이 있으면 그 샘플을 쓰고, 없는 키트에서만 하이햇 닫힌 타격으로 대신한다
 */
export const SAMPLE_FALLBACK: Partial<Record<PadId, PadId>> = { HIHAT_PEDAL: 'HIHAT' };

export const SOUND_SET_LABELS: Record<SoundSetId, string> = {
  ssaplash: 'SSAPLASH 키트',
  synth: '합성음(임시)',
};

export const SYNTH_SET: SoundSet = {
  id: 'synth',
  label: SOUND_SET_LABELS.synth,
  kind: 'synth',
  masterTrim: 1,
  pads: {},
  variants: {},
  missing: [],
};

function baseUrl(id: SoundSetId): string {
  const base = import.meta.env?.BASE_URL ?? '/';
  return `${base}sounds/${id}/`;
}

/**
 * public/sounds/<id>/kit-config.json과 WAV를 읽어 세트를 만든다.
 * 설정 파일을 못 읽으면 예외. 개별 WAV의 fetch·디코드 실패는 건너뛰고 missing에 담는다.
 */
export async function loadSampleSet(ctx: AudioContext, id: SoundSetId): Promise<SoundSet> {
  if (id === 'synth') return SYNTH_SET;
  const dir = baseUrl(id);
  const res = await fetch(`${dir}kit-config.json`);
  if (!res.ok) throw new Error(`kit-config.json을 읽지 못했습니다 (${res.status})`);
  const config = (await res.json()) as KitConfig;
  const entries = resolveKitPads(config);

  const loadSample = async (e: { file: string; gain: number; playbackRate: number }): Promise<SamplePad | null> => {
    try {
      const r = await fetch(`${dir}${e.file}`);
      if (!r.ok) return null;
      const buffer = await ctx.decodeAudioData(await r.arrayBuffer());
      return { buffer, gain: e.gain, playbackRate: e.playbackRate };
    } catch {
      return null;
    }
  };

  const results = await Promise.all(
    entries.map(async (e): Promise<[PadId, SamplePad | null]> => [e.pad, await loadSample(e)]),
  );
  // 선택 변형은 실패해도 missing에 넣지 않는다(합성음 열림 보이스로 폴백)
  const variantResults = await Promise.all(
    resolveKitVariants(config).map(async (e) => [e.variant, await loadSample(e)] as const),
  );
  const variants: SoundSet['variants'] = {};
  for (const [variant, sample] of variantResults) if (sample) variants[variant] = sample;

  const pads: SoundSet['pads'] = {};
  const missing: PadId[] = [];
  for (const [pad, sample] of results) {
    if (sample) pads[pad] = sample;
    else missing.push(pad);
  }
  return {
    id,
    label: SOUND_SET_LABELS[id],
    kind: 'sample',
    masterTrim: typeof config.masterVolume === 'number' ? config.masterVolume : 1,
    pads,
    variants,
    missing,
  };
}
