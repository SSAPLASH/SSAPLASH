// 샘플 키트의 재생 설정 파일(public/sounds/<id>/kit-config.json) 스키마와 패드 매핑.
// 팀원이 키트를 교체해 보내면 이 JSON만 바꾸면 되도록, 게인·재생 속도는 코드에 박지 않는다.
import type { PadId } from '@/domain/kit/pads';

export interface KitPadConfig {
  file: string;
  gain: number;
  playbackRate: number;
  semitones?: number;
  label?: string;
}

export interface KitConfig {
  name: string;
  /** 키트 트림. 샘플 게인에 곱한다 */
  masterVolume: number;
  /** true면 gain·playbackRate가 WAV에 이미 반영된 것이므로 1로 취급한다 */
  adjustmentsBakedIntoWav: boolean;
  pads: Record<string, KitPadConfig>;
}

/**
 * 키트 패드 id → PadId. 대응하는 패드가 없는 항목은 null이라 무시한다(현재는 없음).
 * hihat은 페달 밟은 상태의 닫힌 타격, hihat_pedal은 페달 밟는 소리(chick)다. 열린 타격은 아래 KIT_VARIANT_KEYS.
 */
export const KIT_PAD_TO_PAD_ID: Record<string, PadId | null> = {
  kick: 'KICK',
  snare: 'SNARE',
  hihat: 'HIHAT',
  hihat_pedal: 'HIHAT_PEDAL',
  high: 'SMALL_TOM',
  mid: 'MID_TOM',
  floor: 'FLOOR_TOM',
  crash: 'CRASH',
  ride: 'RIDE',
};

export interface ResolvedKitPad {
  pad: PadId;
  file: string;
  gain: number;
  playbackRate: number;
}

/** 설정에서 PadId에 대응하는 항목만 골라 실제 적용할 게인·재생 속도를 정한다 */
export function resolveKitPads(config: KitConfig): ResolvedKitPad[] {
  const out: ResolvedKitPad[] = [];
  for (const [key, cfg] of Object.entries(config.pads)) {
    const pad = KIT_PAD_TO_PAD_ID[key];
    if (!pad) continue;
    const baked = config.adjustmentsBakedIntoWav === true;
    out.push({
      pad,
      file: cfg.file,
      gain: baked ? 1 : cfg.gain,
      playbackRate: baked ? 1 : cfg.playbackRate,
    });
  }
  return out;
}

/** 키트 선택 항목 id → 변형 키. pads 안에 이 키가 있을 때만 읽는다(없으면 변형 없음) */
export const KIT_VARIANT_KEYS = { hihat_open: 'HIHAT_OPEN' } as const;
export type KitVariantId = (typeof KIT_VARIANT_KEYS)[keyof typeof KIT_VARIANT_KEYS];

export interface ResolvedKitVariant {
  variant: KitVariantId;
  file: string;
  gain: number;
  playbackRate: number;
}

/** 설정의 선택 항목(hihat_open 등)을 골라 게인·재생 속도를 정한다. 패드 항목과 같은 형식이다 */
export function resolveKitVariants(config: KitConfig): ResolvedKitVariant[] {
  const out: ResolvedKitVariant[] = [];
  const baked = config.adjustmentsBakedIntoWav === true;
  for (const [key, variant] of Object.entries(KIT_VARIANT_KEYS)) {
    const cfg = config.pads[key];
    if (!cfg || typeof cfg.file !== 'string') continue;
    out.push({
      variant,
      file: cfg.file,
      gain: baked ? 1 : cfg.gain,
      playbackRate: baked ? 1 : cfg.playbackRate,
    });
  }
  return out;
}
