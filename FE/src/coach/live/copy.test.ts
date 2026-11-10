import { describe, expect, it } from 'vitest';
import { ALL_PADS, STICK_PADS } from '@/domain/pads';
import { coachCopy } from './copy';
import type { CoachMessage } from './LiveCoach';
import type { LiveTag } from './rules';

const msg = (over: Partial<CoachMessage>): CoachMessage => ({
  tag: 'LIVE_LATE',
  text: '',
  severity: 0.5,
  tMs: 1000,
  displayMs: 3000,
  target: null,
  repeat: 0,
  recoveredFrom: null,
  cause: null,
  ...over,
});

const CORRECTION_TAGS: LiveTag[] = ['LIVE_PAD_MISS', 'LIVE_MISS_STREAK', 'LIVE_LATE', 'LIVE_EARLY', 'LIVE_PAD_LATE', 'LIVE_PAD_EARLY', 'LIVE_HAND_WEAK', 'LIVE_UNSTEADY'];
const OTHER_TAGS: LiveTag[] = ['LIVE_GOOD_RECOVERED', 'LIVE_GOOD_STEADY', 'LIVE_GOOD_KEEP', 'LIVE_SETUP_OFFSET', 'LIVE_SETUP_PADS'];

/** 한 태그에 줄 수 있는 모든 대상 조합의 메시지(대상이 필요 없는 태그는 하나) */
function variants(tag: LiveTag): CoachMessage[] {
  const out: CoachMessage[] = [];
  const pads = STICK_PADS.map((pad) => ({ kind: 'pad', pad }) as const);
  const hands = ([0, 1] as const).map((hand) => ({ kind: 'hand', hand }) as const);
  const targets = tag === 'LIVE_PAD_MISS' || tag === 'LIVE_PAD_LATE' || tag === 'LIVE_PAD_EARLY' ? pads : tag === 'LIVE_HAND_WEAK' ? hands : [null];
  for (const target of targets) {
    for (let repeat = 0; repeat <= 3; repeat++) {
      if (tag === 'LIVE_GOOD_RECOVERED') {
        // 해소된 지적 종류별 보조 문구까지 모두 센다
        const froms = [null, ...CORRECTION_TAGS.flatMap((t) => [...pads, ...hands, null].map((tg) => ({ tag: t, target: tg })))];
        for (const recoveredFrom of froms) out.push(msg({ tag, target, repeat, recoveredFrom }));
      } else {
        out.push(msg({ tag, target, repeat }));
      }
    }
  }
  return out;
}

describe('coachCopy', () => {
  it('대상 없는 지적 태그는 구령·보조·모드를 돌려주고 target은 null이다', () => {
    expect(coachCopy(msg({ tag: 'LIVE_MISS_STREAK' }))).toEqual({ title: '킥·스네어만!', sub: '박이 잡히면 다시 다 쳐요', mode: 'coach-warn', target: null });
    expect(coachCopy(msg({ tag: 'LIVE_LATE' }))).toEqual({ title: '스틱 미리 들기', sub: '노트가 닿기 전에 들어요', mode: 'coach-info', target: null });
    expect(coachCopy(msg({ tag: 'LIVE_EARLY' }))).toEqual({ title: '닿을 때 쳐요', sub: '노트를 끝까지 보고 쳐요', mode: 'coach-info', target: null });
    expect(coachCopy(msg({ tag: 'LIVE_UNSTEADY' }))).toEqual({ title: '하나 둘 세며', sub: '킥에 맞춰 속으로 세요', mode: 'coach-info', target: null });
  });

  it('연속 놓침은 반복되면 다른 지시로 바꾼다(제목과 보조를 함께 돌린다)', () => {
    expect(coachCopy(msg({ tag: 'LIVE_MISS_STREAK', repeat: 1 }))).toMatchObject({ title: '발로 박을 세요', sub: '킥 소리에 맞춰 들어가요' });
  });

  it('패드 태그는 패드 라벨을 제목에 넣고 target을 싣는다', () => {
    const target = { kind: 'pad', pad: 'SNARE' } as const;
    expect(coachCopy(msg({ tag: 'LIVE_PAD_LATE', target }))).toEqual({ title: '스네어 먼저', sub: '앞 노트 치고 바로 옮겨요', mode: 'coach-info', target });
    const floor = { kind: 'pad', pad: 'FLOOR_TOM' } as const;
    expect(coachCopy(msg({ tag: 'LIVE_PAD_EARLY', target: floor }))).toEqual({ title: '플로어탐 차분히', sub: '플로어탐만 서두르고 있어요', mode: 'coach-info', target: floor });
  });

  it('패드 이름은 화면 키트와 같은 탐1·탐2를 쓴다', () => {
    expect(coachCopy(msg({ tag: 'LIVE_PAD_LATE', target: { kind: 'pad', pad: 'SMALL_TOM' } }))?.title).toBe('탐1 먼저');
    expect(coachCopy(msg({ tag: 'LIVE_PAD_EARLY', target: { kind: 'pad', pad: 'MID_TOM' } }))?.title).toBe('탐2 차분히');
  });

  it('패드 놓침 구령은 패드 이름으로 가리키며 돌려 쓴다', () => {
    const titles = (pad: 'SMALL_TOM' | 'SNARE') => [0, 1, 2].map((repeat) => coachCopy(msg({ tag: 'LIVE_PAD_MISS', target: { kind: 'pad', pad }, repeat }))?.title);
    expect(titles('SMALL_TOM')).toEqual(['탐1 보세요', '탐1 챙겨요', '탐1 보세요']);
    expect(titles('SNARE')[0]).toBe('스네어 보세요');
  });

  it('패드 놓침 보조 문구는 키보드면 키를, 스틱이면 위치를 알려 준다', () => {
    const tom = msg({ tag: 'LIVE_PAD_MISS', target: { kind: 'pad', pad: 'SMALL_TOM' } });
    expect(coachCopy(tom)?.sub).toBe('왼쪽 탐을 보고 쳐요');
    expect(coachCopy(tom, { keyboard: true })?.sub).toBe('E·I 키를 쳐 보세요');
    expect(coachCopy(msg({ tag: 'LIVE_PAD_MISS', target: { kind: 'pad', pad: 'HIHAT' } }), { keyboard: true })?.sub).toBe('D·K 키를 쳐 보세요');
    expect(coachCopy(msg({ tag: 'LIVE_PAD_MISS', target: { kind: 'pad', pad: 'SNARE' } }))?.sub).toBe('그 패드를 보고 쳐요');
  });

  it('세팅 안내는 연주를 멈추지 않도록 "끝나고"로 안내한다', () => {
    for (const tag of ['LIVE_SETUP_OFFSET', 'LIVE_SETUP_PADS'] as const) {
      const c = coachCopy(msg({ tag }));
      expect(c?.mode).toBe('coach-info');
      expect(c?.target).toBeNull();
      expect(c!.sub).toMatch(/^끝나고/);
    }
  });

  it('손 태그는 왼손·오른손을 제목에 넣고 손 대상을 싣는다', () => {
    const left = { kind: 'hand', hand: 0 } as const;
    expect(coachCopy(msg({ tag: 'LIVE_HAND_WEAK', target: left }))).toMatchObject({ title: '왼손 높이!', sub: '오른손만큼 높이 들어요', target: left });
    expect(coachCopy(msg({ tag: 'LIVE_HAND_WEAK', target: { kind: 'hand', hand: 1 }, repeat: 1 }))?.title).toBe('오른손도 똑같이');
  });

  it('LIVE_PAD_MISS·LIVE_MISS_STREAK만 coach-warn이다', () => {
    for (const tag of CORRECTION_TAGS) {
      const m = variants(tag)[0];
      expect(coachCopy(m)?.mode, tag).toBe(tag === 'LIVE_MISS_STREAK' || tag === 'LIVE_PAD_MISS' ? 'coach-warn' : 'coach-info');
    }
  });

  it('지적 제목은 8자, 칭찬·세팅 제목은 13자, 보조는 16자 이내다(모든 패드·손·반복·해소 대상)', () => {
    for (const tag of [...CORRECTION_TAGS, ...OTHER_TAGS]) {
      for (const keyboard of [false, true]) {
        for (const m of variants(tag)) {
          const c = coachCopy(m, { keyboard });
          expect(c, tag).not.toBeNull();
          const limit = CORRECTION_TAGS.includes(tag) ? 8 : 13;
          expect(c!.title.length, c!.title).toBeLessThanOrEqual(limit);
          expect(c!.sub.length, c!.sub).toBeLessThanOrEqual(16);
        }
      }
    }
  });

  it('금지어(점수·정확도·단정·영어)가 없다', () => {
    const banned = [/점수/, /정확도/, /틀렸/, /못 /, /[A-Za-z]/];
    for (const tag of [...CORRECTION_TAGS, ...OTHER_TAGS]) {
      for (const keyboard of [false, true]) {
        for (const m of variants(tag)) {
          const c = coachCopy(m, { keyboard })!;
          // 키보드 안내(E·I 키)는 키 이름이라 영어 검사에서 뺀다
          const texts = [c.title, keyboard && tag === 'LIVE_PAD_MISS' ? c.sub.replace(/[A-Z·]+ 키/, '') : c.sub];
          for (const t of texts) for (const re of banned) expect(t, `${tag}: ${t}`).not.toMatch(re);
        }
      }
    }
  });

  it('칭찬은 coach-good이다. 일반 칭찬은 보조가 비어 있다', () => {
    for (const tag of ['LIVE_GOOD_RECOVERED', 'LIVE_GOOD_STEADY', 'LIVE_GOOD_KEEP'] as const) {
      expect(coachCopy(msg({ tag }))?.mode).toBe('coach-good');
    }
    expect(coachCopy(msg({ tag: 'LIVE_GOOD_KEEP' }))?.sub).toBe('');
    expect(coachCopy(msg({ tag: 'LIVE_GOOD_STEADY' }))?.title).toBe('박이 딱 맞아요');
  });

  it('해소 칭찬 보조와 대상은 recoveredFrom을 따른다', () => {
    const sub = (recoveredFrom: CoachMessage['recoveredFrom']) => coachCopy(msg({ tag: 'LIVE_GOOD_RECOVERED', recoveredFrom }))?.sub;
    expect(sub({ tag: 'LIVE_LATE', target: null })).toBe('늦던 박이 맞았어요');
    expect(sub({ tag: 'LIVE_EARLY', target: null })).toBe('급하던 박이 맞았어요');
    expect(sub({ tag: 'LIVE_PAD_LATE', target: { kind: 'pad', pad: 'SMALL_TOM' } })).toBe('탐1 박이 맞아요');
    expect(sub({ tag: 'LIVE_PAD_EARLY', target: { kind: 'pad', pad: 'SNARE' } })).toBe('스네어 박이 맞아요');
    expect(sub({ tag: 'LIVE_HAND_WEAK', target: { kind: 'hand', hand: 1 } })).toBe('오른손 소리가 살았어요');
    expect(sub({ tag: 'LIVE_UNSTEADY', target: null })).toBe('박이 고르게 됐어요');
    expect(sub({ tag: 'LIVE_PAD_MISS', target: { kind: 'pad', pad: 'SNARE' } })).toBe('다시 잘 따라와요');
    expect(sub({ tag: 'LIVE_MISS_STREAK', target: null })).toBe('다시 잘 따라와요');
    expect(sub(null)).toBe('방금처럼 계속 쳐요');
    const pad = { kind: 'pad', pad: 'SNARE' } as const;
    expect(coachCopy(msg({ tag: 'LIVE_GOOD_RECOVERED', recoveredFrom: { tag: 'LIVE_PAD_LATE', target: pad } }))?.target).toEqual(pad);
    expect(coachCopy(msg({ tag: 'LIVE_GOOD_RECOVERED' }))?.target).toBeNull();
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

  describe('놓침 원인 문구', () => {
    const tom = { kind: 'pad', pad: 'SMALL_TOM' } as const;
    const withCause = (cause: CoachMessage['cause'], over: Partial<CoachMessage> = {}) =>
      coachCopy(msg({ tag: 'LIVE_PAD_MISS', target: tom, cause, ...over }));

    it('원인이 있으면 제목은 그대로 두고 보조만 원인 문구로 바꾼다', () => {
      const c = withCause({ cause: 'WRONG_PAD', strength: 1, pad: 'SMALL_TOM', intoPad: 'MID_TOM' });
      expect(c).toEqual({ title: '탐1 보세요', sub: '탐1은 왼쪽 탐이에요', mode: 'coach-warn', target: tom });
      expect(withCause({ cause: 'TRANSITION', strength: 1, pad: 'SMALL_TOM', fromPad: 'SNARE' })?.sub).toBe('스네어 치고 바로 탐1로');
      expect(withCause({ cause: 'DENSE', strength: 1, pad: 'SMALL_TOM' })?.sub).toBe('빠른 곳은 손목만 써요');
      expect(withCause({ cause: 'DRIFT_LATE', strength: 1, pad: 'SMALL_TOM' })?.sub).toBe('킥에 맞춰 당겨 쳐요');
    });

    it('다른 패드는 위치를 말할 수 있으면 위치로, 아니면 "대신 친 패드 말고 이 패드"로 말한다', () => {
      expect(withCause({ cause: 'WRONG_PAD', strength: 1, pad: 'MID_TOM', intoPad: 'SMALL_TOM' })?.sub).toBe('탐2는 오른쪽 탐이에요');
      const snare = coachCopy(msg({ tag: 'LIVE_PAD_MISS', target: { kind: 'pad', pad: 'SNARE' }, cause: { cause: 'WRONG_PAD', strength: 1, pad: 'SNARE', intoPad: 'HIHAT' } }));
      expect(snare?.sub).toBe('하이햇 말고 스네어');
    });

    it('패드 이동의 도착이 페달이면 손 이동 지시를 하지 않는다', () => {
      expect(coachCopy(msg({ tag: 'LIVE_MISS_STREAK', cause: { cause: 'TRANSITION', strength: 1, pad: 'KICK', fromPad: 'SNARE' } }))?.sub).toBe('박이 잡히면 다시 다 쳐요');
    });

    it('패드 이동은 받침에 맞춰 로·으로를 붙인다', () => {
      const sub = (pad: 'HIHAT' | 'CRASH' | 'FLOOR_TOM') => withCause({ cause: 'TRANSITION', strength: 1, pad, fromPad: 'SNARE' })?.sub;
      expect(sub('HIHAT')).toBe('스네어 치고 바로 하이햇으로');
      expect(sub('CRASH')).toBe('스네어 치고 바로 크래시로');
      expect(sub('FLOOR_TOM')).toBe('스네어 치고 바로 플로어탐으로');
    });

    it('연속 놓침에도 원인 문구를 붙인다', () => {
      const c = coachCopy(msg({ tag: 'LIVE_MISS_STREAK', cause: { cause: 'DENSE', strength: 1, pad: 'SNARE' } }));
      expect(c).toMatchObject({ title: '킥·스네어만!', sub: '빠른 곳은 손목만 써요', target: null });
    });

    it('UNKNOWN이거나 필요한 패드가 없으면 원래 보조 문구를 쓴다', () => {
      expect(withCause({ cause: 'UNKNOWN', strength: 0, pad: null })?.sub).toBe('왼쪽 탐을 보고 쳐요');
      expect(withCause({ cause: 'WRONG_PAD', strength: 1, pad: 'SMALL_TOM' })?.sub).toBe('왼쪽 탐을 보고 쳐요');
      expect(withCause({ cause: 'TRANSITION', strength: 1, pad: 'SMALL_TOM' })?.sub).toBe('왼쪽 탐을 보고 쳐요');
      expect(withCause({ cause: 'UNKNOWN', strength: 0, pad: null }, { tag: 'LIVE_MISS_STREAK', target: null })?.sub).toBe('박이 잡히면 다시 다 쳐요');
    });

    it('놓침이 아닌 지적은 원인이 있어도 보조 문구를 바꾸지 않는다', () => {
      expect(coachCopy(msg({ tag: 'LIVE_LATE', cause: { cause: 'DENSE', strength: 1, pad: null } }))?.sub).toBe('노트가 닿기 전에 들어요');
    });

    it('모든 패드 조합에서 원인 보조는 16자 이내이고 금지어가 없다', () => {
      const banned = [/점수/, /정확도/, /틀렸/, /못 /, /[A-Za-z]/];
      for (const pad of ALL_PADS) {
        for (const other of ALL_PADS) {
          if (other === pad) continue;
          const causes: CoachMessage['cause'][] = [
            { cause: 'WRONG_PAD', strength: 1, pad, intoPad: other },
            // 원인 계산은 손 패드에서 출발한 이동만 낸다
            ...(STICK_PADS.includes(other) ? [{ cause: 'TRANSITION' as const, strength: 1, pad, fromPad: other }] : []),
            { cause: 'DENSE', strength: 1, pad },
            { cause: 'DRIFT_LATE', strength: 1, pad },
          ];
          for (const cause of causes) {
            const sub = coachCopy(msg({ tag: 'LIVE_MISS_STREAK', cause }))!.sub;
            expect(sub.length, sub).toBeLessThanOrEqual(16);
            for (const re of banned) expect(sub, sub).not.toMatch(re);
          }
        }
      }
    });
  });

  it('모르는 태그는 null', () => {
    expect(coachCopy(msg({ tag: 'LIVE_NOPE' as CoachMessage['tag'] }))).toBeNull();
  });
});
