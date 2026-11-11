import { describe, expect, it } from 'vitest';
import { BULK_TEMPLATE_HEADERS, bulkTemplateCsv, decodeCsvBytes, parseCsv, planBulk, type BulkFile } from './adminBulk';
import type { AdminSong } from './adminSong';

const file = (name: string, size = 10): BulkFile => ({ name, size, type: '' }) as BulkFile;
const existing = (title: string, hasAccompaniment = false): AdminSong => ({
  id: 1, title, artist: null, license: 'x', status: 'READY', hasAccompaniment, published: true, difficulties: [],
});

describe('parseCsv', () => {
  it('BOM·CRLF·따옴표 안 쉼표와 따옴표를 처리한다', () => {
    const rows = parseCsv('\uFEFF제목,아티스트\r\n"Sugar, We\'re Goin Down",Fall Out Boy\r\n"말 ""인용"" 곡",\r\n');
    expect(rows).toEqual([
      ['제목', '아티스트'],
      ["Sugar, We're Goin Down", 'Fall Out Boy'],
      ['말 "인용" 곡', ''],
    ]);
  });

  it('빈 줄은 건너뛴다', () => {
    expect(parseCsv('a,b\n\n1,2\n')).toEqual([['a', 'b'], ['1', '2']]);
  });
});

describe('decodeCsvBytes', () => {
  it('UTF-8(BOM 포함)은 그대로, UTF-8이 아니면 엑셀 한글(CP949)로 읽는다', () => {
    expect(decodeCsvBytes(new TextEncoder().encode('\uFEFF제목\n곡'))).toBe('\uFEFF제목\n곡');
    // "제목,곡" 의 CP949 바이트
    const cp949 = new Uint8Array([0xc1, 0xa6, 0xb8, 0xf1, 0x2c, 0xb0, 0xee]);
    expect(decodeCsvBytes(cp949)).toBe('제목,곡');
  });
});

describe('bulkTemplateCsv', () => {
  it('열 이름과 #으로 시작하는 예시 한 줄만 있다', () => {
    const rows = parseCsv(bulkTemplateCsv());
    expect(rows[0]).toEqual([...BULK_TEMPLATE_HEADERS]);
    expect(rows).toHaveLength(2);
    expect(rows[1][0]).toBe('# 예시) Billie Jean');
  });

  it('양식을 그대로 올리면 곡이 없다는 안내만 나오고, 곡을 적으면 #줄은 미리보기에 없다', () => {
    expect(planBulk(bulkTemplateCsv(), [], []).error).toContain('곡');
    const filled = bulkTemplateCsv() + '새 곡,,new.mid,,,,\n';
    const plan = planBulk(filled, [file('new.mid')], []);
    expect(plan.rows.map((r) => [r.title, r.action])).toEqual([['새 곡', 'REGISTER']]);
  });

  it('#줄은 위아래 어디에 있어도 읽지 않는다', () => {
    const csv = '제목,MIDI\n# 메모,x.mid\nA,a.mid\n#예시 B,b.mid\n';
    const plan = planBulk(csv, [file('a.mid'), file('b.mid')], []);
    expect(plan.rows.map((r) => [r.line, r.title])).toEqual([[3, 'A']]);
  });
});

describe('planBulk', () => {
  const header = '제목,아티스트,MIDI,드럼리스 MR,offsetMs,라이선스,공개\n';

  it('새 곡은 등록, 기본 라이선스·공개를 채우고 반주 파일은 이름으로 짝짓는다', () => {
    const plan = planBulk(header + 'Billie Jean,Michael Jackson,billie_jean.mid,billie_jean.mp3,1226,,\n', [file('BILLIE_JEAN.MID'), file('billie_jean.mp3')], []);
    expect(plan.error).toBeNull();
    expect(plan.rows).toHaveLength(1);
    const r = plan.rows[0];
    expect(r.action).toBe('REGISTER');
    expect(r.draft.title).toBe('Billie Jean');
    expect(r.draft.license).toBe('원곡 Michael Jackson, 드럼 채보 AI 팀 제작, 비상업 프로젝트 내부 시연용');
    expect(r.draft.published).toBe(true);
    expect(r.draft.offsetMs).toBe('1226');
    expect(r.draft.file?.name).toBe('BILLIE_JEAN.MID');
    expect(r.draft.accompaniment?.name).toBe('billie_jean.mp3');
  });

  it('AI 표(다른 열 포함, 반주 칸이 flac)를 그대로 읽고 _drumless를 뺀 이름의 MP3를 찾는다', () => {
    const ai = '\uFEFF곡 폴더,아티스트,제목,MIDI,드럼리스 MR,offsetMs,bpm\nbillie_jean,Michael Jackson,Billie Jean,billie_jean.mid,billie_jean_drumless.flac,1226,116.76\n';
    const plan = planBulk(ai, [file('billie_jean.mid'), file('billie_jean.mp3')], []);
    expect(plan.rows[0].action).toBe('REGISTER');
    expect(plan.rows[0].draft.accompaniment?.name).toBe('billie_jean.mp3');
  });

  it('같은 제목 공용 곡이 있으면 반주만 올리거나 건너뛴다', () => {
    const csv = header + 'A,,a.mid,a.mp3,,,\nB,,b.mid,b.mp3,,,\nC,,c.mid,,,,\n';
    const plan = planBulk(csv, [file('a.mp3'), file('b.mp3')], [existing('A'), existing('B', true), existing('C')]);
    expect(plan.rows.map((r) => r.action)).toEqual(['ACCOMPANIMENT_ONLY', 'SKIP', 'SKIP']);
    expect(plan.rows[0].songId).toBe(1);
  });

  it('입력 오류·파일 없음·CSV 안 제목 중복은 오류', () => {
    const csv = header + ',,x.mid,,,,\nD,,없음.mid,,,,\nE,,e.mid,,-5,,\nF,,f.mid,,,,아마\nG,,g.mid,g.flac,,,\nH,,h.mid,,,,\nH,,h.mid,,,,\n';
    const plan = planBulk(csv, [file('x.mid'), file('e.mid'), file('f.mid'), file('g.mid'), file('g.flac'), file('h.mid')], []);
    expect(plan.rows.map((r) => [r.line, r.action])).toEqual([
      [2, 'ERROR'],
      [3, 'ERROR'],
      [4, 'ERROR'],
      [5, 'ERROR'],
      [6, 'ERROR'],
      [7, 'REGISTER'],
      [8, 'ERROR'],
    ]);
    expect(plan.rows[1].message).toContain('없음.mid');
    expect(plan.rows[2].message).toContain('첫 박');
    expect(plan.rows[6].message).toContain('중복');
  });

  it('줄 번호는 빈 줄·따옴표 안 줄바꿈이 있어도 파일의 실제 줄이다', () => {
    const csv = '제목,MIDI\n\nA,a.mid\n"B\n둘째 줄",b.mid\nC,c.mid\n';
    const plan = planBulk(csv, [file('a.mid'), file('b.mid'), file('c.mid')], []);
    expect(plan.rows.map((r) => r.line)).toEqual([3, 4, 6]);
  });

  it('열 이름 줄 위에 있는 #줄도 건너뛴다', () => {
    const plan = planBulk('# 메모\n제목,MIDI\nA,a.mid\n', [file('a.mid')], []);
    expect(plan.error).toBeNull();
    expect(plan.rows.map((r) => [r.line, r.title])).toEqual([[3, 'A']]);
  });

  it('기존 곡 제목은 대소문자·앞뒤 공백을 무시하고 맞춘다(중복 등록 방지)', () => {
    const plan = planBulk('제목,MIDI,드럼리스 MR\n billie jean ,b.mid,b.mp3\n', [file('b.mid'), file('b.mp3')], [existing('Billie Jean')]);
    expect(plan.rows[0].action).toBe('ACCOMPANIMENT_ONLY');
  });

  it('필수 열이 없거나 데이터가 없으면 표 전체 오류', () => {
    expect(planBulk('아티스트,MIDI\nx,y\n', [], []).error).toContain('제목');
    expect(planBulk(header, [], []).error).toContain('곡');
  });
});
