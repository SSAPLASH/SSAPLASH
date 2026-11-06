import { describe, expect, it } from 'vitest';
import { PAD_META, STICK_PADS } from '@/domain/pads';
import { coachCopy } from './copy';
import type { CoachMessage } from './LiveCoach';

const msg = (over: Partial<CoachMessage>): CoachMessage => ({
  tag: 'LIVE_LATE',
  text: '',
  severity: 0.5,
  tMs: 1000,
  displayMs: 3000,
  target: null,
  repeat: 0,
  ...over,
});

describe('coachCopy', () => {
  it('대상 없는 네 태그는 고정 문구와 모드를 돌려준다', () => {
    expect(coachCopy(msg({ tag: 'LIVE_MISS_STREAK' }))).toEqual({ title: '놓친 노트가 많아요', sub: '다음 노트부터 맞춰요', mode: 'coach-warn' });
    expect(coachCopy(msg({ tag: 'LIVE_LATE' }))).toEqual({ title: '조금씩 늦어요', sub: '박보다 살짝 앞서 쳐 보세요', mode: 'coach-info' });
    expect(coachCopy(msg({ tag: 'LIVE_EARLY' }))).toEqual({ title: '조금씩 빨라요', sub: '박을 끝까지 기다렸다 치세요', mode: 'coach-info' });
    expect(coachCopy(msg({ tag: 'LIVE_UNSTEADY' }))).toEqual({ title: '박자가 흔들려요', sub: '같은 속도를 유지해 보세요', mode: 'coach-info' });
  });

  it('패드 태그는 패드 라벨을 제목에 넣는다', () => {
    const late = coachCopy(msg({ tag: 'LIVE_PAD_LATE', target: { kind: 'pad', pad: 'SNARE' } }));
    expect(late).toEqual({ title: '스네어만 늦어요', sub: '손을 먼저 옮겨 두세요', mode: 'coach-info' });
    const early = coachCopy(msg({ tag: 'LIVE_PAD_EARLY', target: { kind: 'pad', pad: 'FLOOR_TOM' } }));
    expect(early).toEqual({ title: '플로어탐만 빨라요', sub: '박에 맞춰 쳐요', mode: 'coach-info' });
  });

  it('패드 이름은 화면 키트와 같은 탐1·탐2를 쓴다', () => {
    expect(coachCopy(msg({ tag: 'LIVE_PAD_LATE', target: { kind: 'pad', pad: 'SMALL_TOM' } }))?.title).toBe('탐1만 늦어요');
    expect(coachCopy(msg({ tag: 'LIVE_PAD_EARLY', target: { kind: 'pad', pad: 'MID_TOM' } }))?.title).toBe('탐2만 빨라요');
  });

  it('패드 놓침은 패드에 집중하라고 안내하고 조사를 맞춘다', () => {
    const titles = (pad: 'SMALL_TOM' | 'MID_TOM' | 'SNARE' | 'HIHAT') =>
      [0, 1, 2].map((repeat) => coachCopy(msg({ tag: 'LIVE_PAD_MISS', target: { kind: 'pad', pad }, repeat }))?.title);
    expect(titles('SMALL_TOM')).toEqual(['탐1에 집중해요', '탐1을 놓쳤어요', '탐1을 챙겨요']);
    expect(titles('MID_TOM')[1]).toBe('탐2를 놓쳤어요');
    expect(titles('SNARE')[1]).toBe('스네어를 놓쳤어요');
    expect(titles('HIHAT')[1]).toBe('하이햇을 놓쳤어요');
  });

  it('패드 놓침 보조 문구는 키보드면 키를, 스틱이면 위치를 알려 준다', () => {
    const tom = msg({ tag: 'LIVE_PAD_MISS', target: { kind: 'pad', pad: 'SMALL_TOM' } });
    expect(coachCopy(tom)?.sub).toBe('왼쪽 탐을 보고 쳐요');
    expect(coachCopy(tom, { keyboard: true })?.sub).toBe('E·I 키를 쳐 보세요');
    expect(coachCopy(msg({ tag: 'LIVE_PAD_MISS', target: { kind: 'pad', pad: 'HIHAT' } }), { keyboard: true })?.sub).toBe('D·K 키를 쳐 보세요');
    expect(coachCopy(msg({ tag: 'LIVE_PAD_MISS', target: { kind: 'pad', pad: 'SNARE' } }))?.sub).toBe('그 패드를 보고 쳐요');
    expect(coachCopy(msg({ tag: 'LIVE_PAD_MISS', target: { kind: 'pad', pad: 'FLOOR_TOM' } }), { keyboard: true })!.sub.length).toBeLessThanOrEqual(16);
  });

  it('세팅 안내는 제목 13자, 보조 16자 이내이고 고칠 곳을 가리킨다', () => {
    for (const tag of ['LIVE_SETUP_OFFSET', 'LIVE_SETUP_PADS'] as const) {
      const c = coachCopy(msg({ tag }));
      expect(c?.mode).toBe('coach-info');
      expect(c!.title.length, c!.title).toBeLessThanOrEqual(13);
      expect(c!.sub.length, c!.sub).toBeLessThanOrEqual(16);
      expect(c!.sub).toMatch(/세팅|설정/);
    }
  });

  it('손 태그는 왼손·오른손을 제목에 넣는다', () => {
    expect(coachCopy(msg({ tag: 'LIVE_HAND_WEAK', target: { kind: 'hand', hand: 0 } }))?.title).toBe('왼손이 약해요');
    expect(coachCopy(msg({ tag: 'LIVE_HAND_WEAK', target: { kind: 'hand', hand: 1 } }))?.title).toBe('오른손이 약해요');
  });

  it('LIVE_MISS_STREAK만 coach-warn이다', () => {
    const tags = ['LIVE_MISS_STREAK', 'LIVE_LATE', 'LIVE_EARLY', 'LIVE_PAD_LATE', 'LIVE_PAD_EARLY', 'LIVE_HAND_WEAK', 'LIVE_UNSTEADY'] as const;
    for (const tag of tags) {
      const c = coachCopy(msg({ tag, target: tag.startsWith('LIVE_HAND') ? { kind: 'hand', hand: 0 } : { kind: 'pad', pad: 'SNARE' } }));
      expect(c?.mode).toBe(tag === 'LIVE_MISS_STREAK' ? 'coach-warn' : 'coach-info');
    }
  });

  it('제목은 10자, 보조는 16자 이내다(모든 스틱 패드 라벨과 돌려 쓰는 문구 포함)', () => {
    const all: CoachMessage[] = [msg({ tag: 'LIVE_MISS_STREAK' }), msg({ tag: 'LIVE_LATE' }), msg({ tag: 'LIVE_EARLY' }), msg({ tag: 'LIVE_UNSTEADY' })];
    for (const pad of STICK_PADS) {
      all.push(msg({ tag: 'LIVE_PAD_MISS', target: { kind: 'pad', pad } }), msg({ tag: 'LIVE_PAD_LATE', target: { kind: 'pad', pad } }), msg({ tag: 'LIVE_PAD_EARLY', target: { kind: 'pad', pad } }));
    }
    for (const hand of [0, 1] as const) all.push(msg({ tag: 'LIVE_HAND_WEAK', target: { kind: 'hand', hand } }));
    for (const m of all) {
      for (const repeat of [0, 1, 2]) {
        const c = coachCopy({ ...m, repeat });
        expect(c, `${m.tag}`).not.toBeNull();
        expect(c!.title.length, c!.title).toBeLessThanOrEqual(10);
        expect(c!.sub.length, c!.sub).toBeLessThanOrEqual(16);
      }
    }
    expect(PAD_META.HIHAT.label).toBe('하이햇');
  });

  it('칭찬은 coach-good이고 제목은 13자, 보조는 16자 이내다', () => {
    for (const tag of ['LIVE_GOOD_RECOVERED', 'LIVE_GOOD_STEADY', 'LIVE_GOOD_KEEP'] as const) {
      for (let repeat = 0; repeat < 12; repeat++) {
        const c = coachCopy(msg({ tag, repeat }));
        expect(c?.mode).toBe('coach-good');
        expect(c!.title.length, c!.title).toBeLessThanOrEqual(13);
        expect(c!.sub.length, c!.sub).toBeLessThanOrEqual(16);
      }
    }
    expect(coachCopy(msg({ tag: 'LIVE_GOOD_STEADY' }))?.title).toBe('좋아요! 이대로만 치세요');
  });

  it('같은 태그가 다시 뜨면 문구를 차례로 돌려 쓴다', () => {
    const titles = [0, 1, 2, 3].map((repeat) => coachCopy(msg({ tag: 'LIVE_LATE', repeat }))?.title);
    expect(new Set(titles.slice(0, 3)).size).toBe(3);
    expect(titles[3]).toBe(titles[0]);
  });

  it('대상이 필요한 태그에 target이 없거나 종류가 다르면 null', () => {
    expect(coachCopy(msg({ tag: 'LIVE_PAD_LATE', target: null }))).toBeNull();
    expect(coachCopy(msg({ tag: 'LIVE_PAD_EARLY', target: { kind: 'hand', hand: 0 } }))).toBeNull();
    expect(coachCopy(msg({ tag: 'LIVE_HAND_WEAK', target: null }))).toBeNull();
    expect(coachCopy(msg({ tag: 'LIVE_HAND_WEAK', target: { kind: 'pad', pad: 'SNARE' } }))).toBeNull();
  });

  it('모르는 태그는 null', () => {
    expect(coachCopy(msg({ tag: 'LIVE_NOPE' as CoachMessage['tag'] }))).toBeNull();
  });
});
