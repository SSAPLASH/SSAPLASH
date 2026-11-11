// 공용 곡 CSV 일괄 추가 (Jira 262, 설계 CHART-001-관리자-공용곡-화면 v0.3). CSV 파싱·양식·파일 짝 맞추기·행 판정.
// 브라우저는 CSV의 경로로 파일을 열 수 없어, 사용자가 함께 고른 파일을 이름으로 짝짓는다. React·fetch 의존 없음.
import {
  ADMIN_DRAFT_TEXT,
  ADMIN_LICENSE_EXAMPLE,
  precheckAccompaniment,
  validateAdminDraft,
  type AdminSong,
  type AdminSongDraft,
} from './adminSong';

/** 사용자가 고른 파일. 브라우저 File(테스트에서는 이름·크기·형식만 있는 값) */
export type BulkFile = File;

/** 양식 열. 앞 다섯 개는 AI `곡별_첫박.csv`와 같은 이름이라 그 표를 그대로 읽는다 */
export const BULK_TEMPLATE_HEADERS = ['제목', '아티스트', 'MIDI', '드럼리스 MR', 'offsetMs', '라이선스', '공개'] as const;

export const BULK_TEMPLATE_FILENAME = '공용곡_일괄추가_양식.csv';

/** 메모 줄 표시. 첫 칸이 이것으로 시작하는 줄은 읽지 않는다 — 양식의 안내·예시 줄이 쓴다(CSV는 색을 담지 못한다) */
export const BULK_COMMENT_PREFIX = '#';

export type BulkAction = 'REGISTER' | 'ACCOMPANIMENT_ONLY' | 'SKIP' | 'ERROR';

export interface BulkRow {
  /** CSV 줄 번호(머리 = 1) */
  line: number;
  title: string;
  action: BulkAction;
  /** 건너뜀·오류 사유, 반주만일 때 안내 */
  message: string | null;
  draft: AdminSongDraft;
  /** 반주만 올릴 기존 곡 id */
  songId: number | null;
}

export interface BulkPlan {
  /** 표 전체 오류(필수 열 없음·곡 없음). 있으면 rows는 비어 있다 */
  error: string | null;
  rows: BulkRow[];
}

interface CsvRow {
  cells: string[];
  /** 이 줄이 시작하는 파일의 실제 줄 번호(1부터) */
  line: number;
}

/** RFC 4180 CSV. 맨 앞 BOM 제거, CRLF·LF, 따옴표 안 쉼표·줄바꿈·"" 처리. 빈 줄은 버리고 줄 번호는 파일 그대로 둔다 */
function parseCsvRows(text: string): CsvRow[] {
  const src = text.startsWith('\uFEFF') ? text.slice(1) : text;
  const rows: CsvRow[] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  let physical = 1;
  let start = 1;
  const endRow = () => {
    row.push(cell);
    if (!(row.length === 1 && row[0].trim() === '')) rows.push({ cells: row, line: start });
    row = [];
    cell = '';
    physical++;
    start = physical;
  };
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else {
        if (c === '\n' || (c === '\r' && src[i + 1] !== '\n')) physical++;
        cell += c;
      }
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      row.push(cell);
      cell = '';
    } else if (c === '\n') endRow();
    else if (c === '\r') {
      if (src[i + 1] === '\n') i++;
      endRow();
    } else cell += c;
  }
  if (cell !== '' || row.length > 0) endRow();
  return rows;
}

/** CSV 칸만. 빈 줄은 버린다 */
export function parseCsv(text: string): string[][] {
  return parseCsvRows(text).map((r) => r.cells);
}

/** CSV 파일 바이트 → 글자. UTF-8(BOM 포함)이 아니면 한글 Windows 엑셀의 「CSV(쉼표로 분리)」 저장 형식(CP949)으로 읽는다 */
export function decodeCsvBytes(bytes: Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    return new TextDecoder('euc-kr').decode(bytes);
  }
}

function csvCell(v: string): string {
  return /[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

/** 양식 CSV 본문(BOM은 내려줄 때 붙인다). 열 이름과 # 예시 줄. #줄은 지우든 남기든, 그 위아래 어디에 곡을 적든 읽지 않는다 */
export function bulkTemplateCsv(): string {
  const example = [
    `${BULK_COMMENT_PREFIX} 예시) Billie Jean`,
    'Michael Jackson',
    'billie_jean.mid',
    'billie_jean.mp3',
    '1226',
    ADMIN_LICENSE_EXAMPLE.replace('{아티스트}', 'Michael Jackson'),
    'true',
  ];
  return [BULK_TEMPLATE_HEADERS.join(','), example.map(csvCell).join(',')].join('\r\n') + '\r\n';
}

function defaultLicense(artist: string): string {
  return ADMIN_LICENSE_EXAMPLE.replace('{아티스트}', artist || '미상');
}

function parsePublished(raw: string): boolean | null {
  const v = raw.trim().toLowerCase();
  if (v === '' || v === 'true' || v === '공개') return true;
  if (v === 'false' || v === '비공개') return false;
  return null;
}

const stem = (name: string) => name.replace(/\.[^.]+$/, '');

/** 반주 파일 찾기: 정확한 이름(대소문자 무시)의 WAV·MP3 → 확장자를 뺀 이름 → 끝의 `_drumless`까지 뺀 이름의 .mp3·.wav */
function findAccompaniment(name: string, files: BulkFile[]): BulkFile | null {
  const byName = new Map(files.map((f) => [f.name.toLowerCase(), f]));
  const exact = byName.get(name.toLowerCase());
  if (exact && precheckAccompaniment(exact).ok) return exact;
  const base = stem(name).toLowerCase();
  for (const s of [base, base.replace(/_drumless$/, '')])
    for (const ext of ['.mp3', '.wav']) {
      const f = byName.get(s + ext);
      if (f && precheckAccompaniment(f).ok) return f;
    }
  return null;
}

/** CSV 본문과 고른 파일, 지금 공용 곡 목록으로 행마다 할 일을 정한다 */
export function planBulk(csv: string, files: BulkFile[], songs: AdminSong[]): BulkPlan {
  const isComment = (r: CsvRow) => (r.cells[0] ?? '').trim().startsWith(BULK_COMMENT_PREFIX);
  // 열 이름 줄 위에 있는 #줄도 건너뛴다
  const table = parseCsvRows(csv);
  const headAt = table.findIndex((r) => !isComment(r));
  if (headAt < 0) return { error: 'CSV가 비어 있어요. 양식을 받아 채워 주세요.', rows: [] };
  const head = table[headAt].cells.map((h) => h.trim());
  const col = (name: string) => head.indexOf(name);
  if (col('제목') < 0) return { error: '「제목」 열이 없어요. 양식의 열 이름을 그대로 써 주세요.', rows: [] };
  // 첫 칸이 #으로 시작하는 줄(안내·예시·메모)은 버린다. 줄 번호는 CSV 그대로 둔다
  const data = table.slice(headAt + 1).filter((r) => !isComment(r));
  if (data.length === 0) return { error: '올릴 곡이 없어요. 안내 줄(#) 말고 곡을 한 줄 이상 적어 주세요.', rows: [] };

  const get = (r: string[], name: string) => {
    const i = col(name);
    return i >= 0 ? (r[i] ?? '').trim() : '';
  };
  const midiByName = new Map(files.map((f) => [f.name.toLowerCase(), f]));
  // 같은 곡 판정은 대소문자·앞뒤 공백을 무시한다(중복 등록 방지)
  const key = (t: string) => t.trim().toLowerCase();
  const existing = new Map(songs.map((s) => [key(s.title), s]));
  const seen = new Set<string>();

  const rows = data.map(({ cells: r, line }): BulkRow => {
    const title = get(r, '제목');
    const artist = get(r, '아티스트');
    const draft: AdminSongDraft = {
      file: null,
      title,
      artist,
      license: get(r, '라이선스') || defaultLicense(artist),
      offsetMs: get(r, 'offsetMs'),
      published: true,
      accompaniment: null,
    };
    const fail = (message: string): BulkRow => ({ line, title, action: 'ERROR', message, draft, songId: null });

    if (title === '') return fail('제목이 비어 있어요.');
    if (seen.has(key(title))) return fail('표 안에서 제목이 중복돼요. 한 줄만 남겨 주세요.');
    seen.add(key(title));

    const published = parsePublished(get(r, '공개'));
    if (published === null) return fail('공개 칸은 true·false(또는 공개·비공개)로 적어 주세요.');
    draft.published = published;

    const accName = get(r, '드럼리스 MR');
    if (accName !== '') {
      const acc = findAccompaniment(accName, files);
      if (!acc) return fail(`반주 파일 「${accName}」(또는 같은 이름의 WAV·MP3)을 고르지 않았어요.`);
      draft.accompaniment = acc;
    }

    const song = existing.get(key(title));
    if (song) {
      if (song.hasAccompaniment) return { line, title, action: 'SKIP', message: '이미 등록된 곡이고 반주도 있어요.', draft, songId: song.id };
      if (!draft.accompaniment) return { line, title, action: 'SKIP', message: '이미 등록된 곡이에요(반주 파일 없음).', draft, songId: song.id };
      return { line, title, action: 'ACCOMPANIMENT_ONLY', message: '이미 등록된 곡이라 반주만 올려요.', draft, songId: song.id };
    }

    const midiName = get(r, 'MIDI');
    if (midiName === '') return fail('새 곡은 MIDI 칸이 필요해요.');
    const midi = midiByName.get(midiName.toLowerCase());
    if (!midi) return fail(`MIDI 파일 「${midiName}」을 고르지 않았어요.`);
    draft.file = midi;

    const check = validateAdminDraft(draft);
    if (!check.ok) return fail(ADMIN_DRAFT_TEXT[check.reason]);
    return { line, title, action: 'REGISTER', message: null, draft, songId: null };
  });
  return { error: null, rows };
}
