// 폴더 구조 의존 규칙 검사(설계 TECH-fe-feature-scaffolding 3-1). import 관계를 읽어 금지된 방향이 있으면 실패한다.
// 규칙을 어기는 import를 새로 넣지 않는다. 불가피하면 ALLOWED에 이유와 함께 추가하고, 풀리면 지운다(남아 있어도 실패한다).
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
// 경로 비교는 `/` 기준이다. Windows에서도 같은 결과가 나오게 posix 경로 함수로 다룬다.
import { dirname, join as joinPosix, normalize } from 'node:path/posix';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC = join(fileURLToPath(new URL('..', import.meta.url)));

function walk(dir: string, rel = ''): string[] {
  return readdirSync(join(dir, rel)).flatMap((name) => {
    const path = rel ? `${rel}/${name}` : name;
    return statSync(join(dir, path)).isDirectory() ? walk(dir, path) : [path];
  });
}

const ALL = walk(SRC);
// 목록이 비면 모든 규칙이 그냥 통과한다. 경로 처리가 깨지지 않았는지 먼저 본다.
if (!ALL.includes('main.tsx')) throw new Error(`src 목록을 읽지 못했다: ${SRC}`);
const EXISTS = new Set(ALL);
/** 검사 대상: 테스트·테스트 보조를 뺀 소스 */
const SOURCES = ALL.filter((f) => /\.tsx?$/.test(f) && !f.includes('.test.') && !f.startsWith('test/'));

function resolveImport(from: string, spec: string): string | null {
  const base = spec.startsWith('@/') ? spec.slice(2) : normalize(joinPosix(dirname(from), spec));
  return [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`, `${base}/index.tsx`].find((c) => EXISTS.has(c)) ?? null;
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
// 타입 선언만 내보내는 파일은 구현 소유권을 소비 수로 단정하지 않는다.
const VALUE_EXPORTS = new Set(SOURCES.filter((file) => /\bexport\s+(?:default\s+|async\s+)?(?:class|function|const|let|var|enum)\b/.test(readFileSync(join(SRC, file), 'utf8'))));

/** `features/play/...` → `play`, 그 밖은 null */
const featureOf = (f: string) => (f.startsWith('features/') ? f.split('/')[1] : null);
const isShared = (f: string) => !f.startsWith('features/') && !f.startsWith('app/') && f !== 'main.tsx';

/** 공유 화면 컴포넌트와 코어 구현의 역방향 import를 따라 소비자를 찾는다.
 * dev는 진단 화면이므로 소유 기능에 세지 않고, app의 소비는 공용으로 본다.
 * 코어 구현을 다른 공유 계층이 쓰면 공용으로 보고, domain·api 및 타입 전용 계약은 검사하지 않는다.
 */
function featureOnlyFiles(files: string[], edges: { from: string; to: string }[], valueExports: Set<string>): string[] {
  const importers = new Map<string, string[]>();
  for (const { from, to } of edges) importers.set(to, [...(importers.get(to) ?? []), from]);

  return files.filter((file) => {
    const component = file.startsWith('components/') && !file.startsWith('components/ui/');
    const core = /^(engine|audio|coach)\//.test(file) && valueExports.has(file);
    if (!component && !core) return false;
    const coreRoot = file.split('/')[0];
    const seen = new Set([file]);
    const pending = [file];
    const owners = new Set<string>();
    while (pending.length) {
      for (const from of importers.get(pending.pop()!) ?? []) {
        const feature = featureOf(from);
        if (feature && feature !== 'dev') owners.add(`feature:${feature}`);
        else if (feature === 'dev') continue;
        else if (from.startsWith('app/') || from === 'main.tsx') owners.add('shared');
        else if (core && !from.startsWith(`${coreRoot}/`) && !from.startsWith('components/')) owners.add('shared');
        else if (!seen.has(from)) {
          seen.add(from);
          pending.push(from);
        }
      }
    }
    return owners.size === 1 && !owners.has('shared');
  }).sort();
}

/**
 * 허용하는 예외(`from -> to` 형식). 지금은 비어 있다.
 * 새 항목은 막을 수 없는 이유를 주석으로 함께 적고, 풀리면 지운다.
 */
const ALLOWED = new Set<string>([]);

/** domain 파일 여부와 그 파일이 속한 기능(공유 domain이면 null) */
const domainOwner = (f: string): { feature: string | null } | null => {
  if (f.startsWith('domain/')) return { feature: null };
  const m = /^features\/([^/]+)\/domain\//.exec(f);
  return m ? { feature: m[1] } : null;
};

/** 소스 한 파일이 가져오는 패키지(`@/`·상대 경로가 아닌 import 대상). EDGES는 src 파일만 담아 따로 읽는다 */
function packageImportsOf(file: string): string[] {
  const text = readFileSync(join(SRC, file), 'utf8');
  return [...text.matchAll(/(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g)].map((m) => m[1]).filter((spec) => !spec.startsWith('@/') && !spec.startsWith('.'));
}

function violations(test: (from: string, to: string) => boolean): string[] {
  return EDGES.filter((e) => test(e.from, e.to)).map((e) => `${e.from} -> ${e.to}`);
}

describe('단일 기능 소유권 판정', () => {
  it('전이 소비와 app·공유 계층·다른 기능의 소비 및 공용 계약을 구분한다', () => {
    const files = [
      'components/song/featureOnly.tsx', 'components/song/through.tsx',
      'components/song/multi.tsx', 'components/song/app.tsx', 'components/song/unused.tsx',
      'components/song/dev.tsx', 'components/song/devOnly.tsx',
      'components/ui/Button.tsx', 'domain/song/contract.ts', 'api/song/client.ts',
      'engine/featureOnly.ts', 'engine/indirect.ts', 'engine/contract.ts', 'engine/types.ts',
    ];
    const edges = [
      { from: 'features/play/Page.tsx', to: 'components/song/through.tsx' },
      { from: 'components/song/through.tsx', to: 'components/song/featureOnly.tsx' },
      { from: 'components/song/featureOnly.tsx', to: 'components/song/through.tsx' },
      { from: 'features/play/Page.tsx', to: 'components/song/multi.tsx' },
      { from: 'features/studio/Page.tsx', to: 'components/song/multi.tsx' },
      { from: 'features/play/Page.tsx', to: 'components/song/app.tsx' },
      { from: 'app/App.tsx', to: 'components/song/app.tsx' },
      { from: 'features/play/Page.tsx', to: 'components/song/dev.tsx' },
      { from: 'features/dev/Page.tsx', to: 'components/song/dev.tsx' },
      { from: 'features/dev/Page.tsx', to: 'components/song/devOnly.tsx' },
      { from: 'features/play/Page.tsx', to: 'components/ui/Button.tsx' },
      { from: 'features/play/Page.tsx', to: 'domain/song/contract.ts' },
      { from: 'features/play/Page.tsx', to: 'api/song/client.ts' },
      { from: 'features/play/Page.tsx', to: 'engine/indirect.ts' },
      { from: 'engine/indirect.ts', to: 'engine/featureOnly.ts' },
      { from: 'features/play/Page.tsx', to: 'engine/contract.ts' },
      { from: 'runtime/session.ts', to: 'engine/contract.ts' },
      { from: 'features/play/Page.tsx', to: 'engine/types.ts' },
    ];
    expect(featureOnlyFiles(files, edges, new Set(['engine/featureOnly.ts', 'engine/indirect.ts', 'engine/contract.ts']))).toEqual([
      'components/song/dev.tsx', 'components/song/featureOnly.tsx', 'components/song/through.tsx',
      'engine/featureOnly.ts', 'engine/indirect.ts',
    ]);
  });
});

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
    // R3 domain은 다른 domain 파일만 import한다(패키지도 안 된다)
    ...violations((from, to) => {
      const owner = domainOwner(from);
      if (!owner) return false;
      return owner.feature === null ? !to.startsWith('domain/') : !to.startsWith(`features/${owner.feature}/domain/`) && !to.startsWith('domain/');
    }),
    ...SOURCES.filter((f) => domainOwner(f) !== null).flatMap((f) => packageImportsOf(f).map((pkg) => `${f} -> ${pkg}`)),
    // R4 components/ui는 store·domain·api를 모른다
    ...violations((from, to) => from.startsWith('components/ui/') && /^(store|domain|api|engine|input|audio)\//.test(to)),
    // R5 config는 config 파일만 import한다(값·순수 함수만 두는 층이라 다른 폴더를 모른다)
    ...violations((from, to) => from.startsWith('config/') && !to.startsWith('config/')),
    // R6 runtime은 화면 층(components)을 import하지 않는다(기능·app은 R2가 막는다)
    ...violations((from, to) => from.startsWith('runtime/') && to.startsWith('components/')),
    // R7 core·store·domain은 runtime을 모른다(runtime이 이들 위의 층이다)
    ...violations((from, to) => /^(store|api|domain|input|engine|audio|coach|telemetry)\//.test(from) && to.startsWith('runtime/')),
    // R8 기능은 app을 import하지 않는다(app이 기능을 조립하는 맨 위 층이다)
    ...violations((from, to) => from.startsWith('features/') && to.startsWith('app/')),
  ];
  const unique = [...new Set(found)].sort();

  it('허용 목록 밖의 위반이 없다', () => {
    expect(unique.filter((v) => !ALLOWED.has(v))).toEqual([]);
  });

  it('허용 목록에 이미 풀린 항목이 남아 있지 않다', () => {
    expect([...ALLOWED].filter((v) => !unique.includes(v))).toEqual([]);
  });

  it('한 기능에서만 쓰는 화면 컴포넌트와 코어 구현은 해당 기능 폴더에 둔다', () => {
    expect(featureOnlyFiles(SOURCES, EDGES, VALUE_EXPORTS)).toEqual([]);
  });

  it('옛 폴더(pages·components 바로 아래 파일)가 다시 생기지 않는다', () => {
    expect(ALL.filter((f) => f.startsWith('pages/') || /^components\/[^/]+$/.test(f))).toEqual([]);
  });

  it('공유 domain 바로 아래에는 events만 둔다(나머지는 kit·song·time·play·account·hitFx 하위 폴더)', () => {
    expect(ALL.filter((f) => /^domain\/[^/]+$/.test(f) && !/^domain\/events(\.test)?\.ts$/.test(f))).toEqual([]);
  });

  it('api 바로 아래에는 공통 래퍼(http·error)만 둔다(나머지는 account·kit·song·play 하위 폴더)', () => {
    expect(ALL.filter((f) => /^api\/[^/]+$/.test(f) && !/^api\/(http|error)(\.test)?\.ts$/.test(f))).toEqual([]);
  });
});
