import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ALL_PADS } from '@/domain/kit/pads';
import { KIT_PAD_TO_PAD_ID, resolveKitPads, resolveKitVariants, type KitConfig } from './kitConfig';

const config = (baked: boolean): KitConfig => ({
  name: 't',
  masterVolume: 0.21,
  adjustmentsBakedIntoWav: baked,
  pads: {
    kick: { file: 'audio/kick.wav', gain: 1, playbackRate: 1 },
    snare: { file: 'audio/snare.wav', gain: 1.2, playbackRate: 1 },
    high: { file: 'audio/high.wav', gain: 1, playbackRate: 1.414 },
    mid: { file: 'audio/mid.wav', gain: 1, playbackRate: 1.19 },
    unknown: { file: 'audio/x.wav', gain: 1, playbackRate: 1 },
  },
});

describe('kitConfig', () => {
  it('키트 패드 id를 PadId로 매핑한다(mid는 MID_TOM)', () => {
    expect(KIT_PAD_TO_PAD_ID).toMatchObject({
      kick: 'KICK',
      snare: 'SNARE',
      hihat: 'HIHAT',
      high: 'SMALL_TOM',
      floor: 'FLOOR_TOM',
      crash: 'CRASH',
      ride: 'RIDE',
      mid: 'MID_TOM',
      hihat_pedal: 'HIHAT_PEDAL',
    });
    const pads = resolveKitPads(config(false)).map((p) => p.pad);
    expect(pads).toEqual(['KICK', 'SNARE', 'SMALL_TOM', 'MID_TOM']);
  });

  it('게인·재생 속도를 설정대로 적용한다', () => {
    const snare = resolveKitPads(config(false)).find((p) => p.pad === 'SNARE')!;
    expect(snare.gain).toBe(1.2);
    const high = resolveKitPads(config(false)).find((p) => p.pad === 'SMALL_TOM')!;
    expect(high.playbackRate).toBeCloseTo(1.414);
  });

  it('adjustmentsBakedIntoWav면 게인·재생 속도를 1로 취급한다', () => {
    for (const p of resolveKitPads(config(true))) {
      expect(p.gain).toBe(1);
      expect(p.playbackRate).toBe(1);
    }
  });
});

describe('resolveKitVariants (PLAY-002 하이햇 열림 선택 항목)', () => {
  const withOpen = (baked: boolean): KitConfig => ({
    ...config(baked),
    pads: { ...config(baked).pads, hihat_open: { file: 'audio/hihat_open.wav', gain: 0.9, playbackRate: 1.1 } },
  });

  // 인수 조건: hihat_open 키가 있을 때만 변형 항목, 게인·재생 속도는 설정대로
  it('pads.hihat_open이 있으면 HIHAT_OPEN 항목을 낸다', () => {
    expect(resolveKitVariants(withOpen(false))).toEqual([
      { variant: 'HIHAT_OPEN', file: 'audio/hihat_open.wav', gain: 0.9, playbackRate: 1.1 },
    ]);
  });

  it('adjustmentsBakedIntoWav면 gain·rate를 1로 취급한다', () => {
    expect(resolveKitVariants(withOpen(true))[0]).toMatchObject({ gain: 1, playbackRate: 1 });
  });

  it('hihat_open이 없으면 빈 배열', () => {
    expect(resolveKitVariants(config(false))).toEqual([]);
  });

  it('hihat_open은 일반 패드 목록에 들어가지 않는다', () => {
    expect(resolveKitPads(withOpen(false)).map((p) => p.pad)).toEqual(['KICK', 'SNARE', 'SMALL_TOM', 'MID_TOM']);
  });
});

describe('기본 키트 public/sounds/ssaplash (하이햇 닫힘·열림·페달 소리)', () => {
  const kitUrl = new URL('../../public/sounds/ssaplash/', import.meta.url);
  const kit = JSON.parse(readFileSync(fileURLToPath(new URL('kit-config.json', kitUrl)), 'utf8')) as KitConfig;

  it('패드 9개 모두 샘플 항목이 있고 하이햇 열림 변형도 있다', () => {
    expect(resolveKitPads(kit).map((p) => p.pad).sort()).toEqual([...ALL_PADS].sort());
    expect(resolveKitVariants(kit).map((v) => v.variant)).toEqual(['HIHAT_OPEN']);
  });

  it('설정이 가리키는 WAV가 모두 있다', () => {
    for (const e of [...resolveKitPads(kit), ...resolveKitVariants(kit)]) {
      expect(existsSync(fileURLToPath(new URL(e.file, kitUrl))), e.file).toBe(true);
    }
  });

  it('하이햇 닫힘·열림·페달은 서로 다른 파일이다', () => {
    const files = [kit.pads.hihat.file, kit.pads.hihat_open.file, kit.pads.hihat_pedal.file];
    expect(new Set(files).size).toBe(3);
  });
});
