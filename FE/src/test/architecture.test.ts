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
