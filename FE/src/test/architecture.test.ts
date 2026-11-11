// 폴더 구조 의존 규칙 검사(설계 TECH-fe-feature-scaffolding 3-1). import 관계를 읽어 금지된 방향이 있으면 실패한다.
// 규칙을 어기는 import를 새로 넣지 않는다. 불가피하면 ALLOWED에 이유와 함께 추가하고, 풀리면 지운다(남아 있어도 실패한다).
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, normalize, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..');

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [relative(SRC, path)];
  });
}

const ALL = walk(SRC);
const EXISTS = new Set(ALL);
/** 검사 대상: 테스트·테스트 보조를 뺀 소스 */
const SOURCES = ALL.filter((f) => /\.tsx?$/.test(f) && !f.includes('.test.') && !f.startsWith('test/'));

function resolveImport(from: string, spec: string): string | null {
  const base = spec.startsWith('@/') ? spec.slice(2) : normalize(join(dirname(from), spec));
  return [base, `${base}.ts`, `${base}.tsx`].find((c) => EXISTS.has(c)) ?? null;
}

/** 소스 한 파일이 가져오는 src 안의 파일들 */
function importsOf(file: string): string[] {
  const text = readFileSync(join(SRC, file), 'utf8');
  const out: string[] = [];
  for (const m of text.matchAll(/(?:from|import)\s*\(?\s*['"]((?:@\/|\.\.?\/)[^'"]+)['"]/g)) {
    const target = resolveImport(file, m[1]);
    if (target && target !== file) out.push(target);
  }
  return out;
}

const EDGES = SOURCES.flatMap((from) => importsOf(from).map((to) => ({ from, to })));

/** `features/play/...` → `play`, 그 밖은 null */
const featureOf = (f: string) => (f.startsWith('features/') ? f.split('/')[1] : null);
const isShared = (f: string) => !f.startsWith('features/') && !f.startsWith('app/') && f !== 'main.tsx';

/**
 * 지금 남아 있는 예외. 모두 재편 전 구조에서 넘어온 것이다.
 * - 공유 → app: 입력 인스턴스·녹음 상태·빌드 스위치처럼 조립 폴더가 가진 단일 인스턴스를 읽는 곳
 * - 공유 → 기능 CSS: 공유로 내린 부품의 스타일이 아직 기능 CSS 파일에 들어 있는 곳(CSS 분리 뒤 지운다)
 */
const ALLOWED = new Set<string>([
  // 공유 → app
  'components/calibration/TimingCalDialog.tsx -> app/keyboardDrum.ts',
  'components/calibration/TimingCalDialog.tsx -> app/timingCalSession.ts',
  'components/calibration/useRealign.ts -> app/calibrationSession.ts',
  'components/lesson/LessonInvite.tsx -> app/authBootstrap.ts',
  'components/recording/RecordButton.tsx -> app/recordingStore.ts',
  'components/recording/RecordingToast.tsx -> app/recordingStore.ts',
  'components/recording/SaveRecordingDialog.tsx -> app/recordingStore.ts',
  'components/recording/toastContent.tsx -> app/recordingStore.ts',
  'components/recording/useRecordingList.ts -> app/queryClient.ts',
  'components/shell/GlassDock.tsx -> app/features.ts',
  'components/shell/GlassDock.tsx -> app/recordingStore.ts',
  'components/shell/RouteErrorBoundary.tsx -> app/chunkRecovery.ts',
  'components/shell/RouteErrorBoundary.tsx -> app/recordingStore.ts',
  'components/shell/Sidebar.tsx -> app/prefetchRoute.ts',
  'components/shell/TopBar.tsx -> app/sensorRegistry.ts',
  'components/song/useFreeAccompaniment.ts -> app/bootstrap.ts',
  // 공유 → 기능 CSS
  'components/drum/HitReadout.tsx -> features/play/components/play.css',
  'components/recording/RecordingList.tsx -> features/history/history.css',
  'components/song/SeekBar.tsx -> features/free/free.css',
]);

function violations(test: (from: string, to: string) => boolean): string[] {
  return EDGES.filter((e) => test(e.from, e.to)).map((e) => `${e.from} -> ${e.to}`);
}

describe('폴더 구조 의존 규칙', () => {
  const found = [
    // R1 기능 폴더끼리 import하지 않는다(개발 전용 화면 features/dev만 예외)
    ...violations((from, to) => {
      const a = featureOf(from);
      const b = featureOf(to);
      return a !== null && b !== null && a !== b && a !== 'dev';
    }),
    // R2 공유 층은 기능 폴더와 app을 import하지 않는다
    ...violations((from, to) => isShared(from) && (to.startsWith('features/') || to.startsWith('app/'))),
    // R4 components/ui는 store·domain·api를 모른다
    ...violations((from, to) => from.startsWith('components/ui/') && /^(store|domain|api|engine|input|audio)\//.test(to)),
  ];
  const unique = [...new Set(found)].sort();

  it('허용 목록 밖의 위반이 없다', () => {
    expect(unique.filter((v) => !ALLOWED.has(v))).toEqual([]);
  });

  it('허용 목록에 이미 풀린 항목이 남아 있지 않다', () => {
    expect([...ALLOWED].filter((v) => !unique.includes(v))).toEqual([]);
  });

  it('옛 폴더(pages·components 바로 아래 파일)가 다시 생기지 않는다', () => {
    expect(ALL.filter((f) => f.startsWith('pages/') || /^components\/[^/]+$/.test(f))).toEqual([]);
  });
});
