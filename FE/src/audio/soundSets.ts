// 사운드 세트: 소리의 출처를 묶는 단위. 합성음(synth)은 코드에 내장, 샘플 세트는 kit-config.json을 읽어 만든다.
// 세트를 바꿔도 입력·판정·텔레메트리는 모른다. 파일 하나가 실패하면 그 패드만 합성음으로 폴백한다.
import type { PadId } from '@/domain/pads';
import { resolveKitPads, type KitConfig } from './kitConfig';

export type SoundSetId = 'synth' | 'ssaplash';

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
  /** 샘플이 없어 합성음으로 폴백하는 패드 */
  missing: PadId[];
}

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

  const results = await Promise.all(
    entries.map(async (e): Promise<[PadId, SamplePad | null]> => {
      try {
        const r = await fetch(`${dir}${e.file}`);
        if (!r.ok) return [e.pad, null];
        const buffer = await ctx.decodeAudioData(await r.arrayBuffer());
        return [e.pad, { buffer, gain: e.gain, playbackRate: e.playbackRate }];
      } catch {
        return [e.pad, null];
      }
    }),
  );

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
    missing,
  };
}
