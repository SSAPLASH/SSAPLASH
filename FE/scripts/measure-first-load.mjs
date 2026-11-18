// 첫 로딩 JS 크기 측정. `npm run build` 뒤에 `npm run measure`로 실행한다.
// dist/index.html의 entry 스크립트와 modulepreload JS를 읽어 파일별·합계 gzip 크기를 출력한다.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const BUDGET_KB = 235;
const distDir = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'dist');
const indexPath = join(distDir, 'index.html');

if (!existsSync(indexPath)) {
  console.error('dist/index.html이 없습니다. 먼저 npm run build 를 실행하세요.');
  process.exit(1);
}

const html = readFileSync(indexPath, 'utf8');
const urls = [];
for (const tag of html.match(/<(script|link)\b[^>]*>/gi) ?? []) {
  const isEntry = /^<script\b/i.test(tag) && /type=["']module["']/i.test(tag);
  const isPreload = /^<link\b/i.test(tag) && /rel=["']modulepreload["']/i.test(tag);
  if (!isEntry && !isPreload) continue;
  const m = tag.match(/(?:src|href)=["']([^"']+)["']/i);
  if (m && !urls.includes(m[1])) urls.push(m[1]);
}

const kb = (bytes) => (bytes / 1000).toFixed(1);
let totalGzip = 0;
for (const url of urls) {
  const file = join(distDir, url.replace(/^\.?\//, ''));
  if (!existsSync(file)) {
    console.error(`파일을 찾을 수 없습니다: ${url}`);
    process.exit(1);
  }
  const raw = readFileSync(file);
  const gz = gzipSync(raw).length;
  totalGzip += gz;
  console.log(`${url.replace(/^\.?\//, '')}  ${kb(raw.length)} kB  ${kb(gz)} kB`);
}

const over = totalGzip / 1000 > BUDGET_KB;
console.log(`first-load JS gzip: ${kb(totalGzip)} kB (budget ${BUDGET_KB} kB) ${over ? 'OVER' : 'OK'}`);
process.exit(over ? 1 : 0);
