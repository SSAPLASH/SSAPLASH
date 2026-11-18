// 서버가 게시한 모델 목록(/models/manifest.json)을 읽고, 받은 파일을 sha256·크기로 검증한다(설계 3.4, 4.3).
// 매니페스트 형식은 Infra/mlflow/publish_model.py가 정한다. 모르는 필드는 무시하고, 형식이 틀린 항목은 버린다.
// 검증은 손상·섞임을 거르는 것이고 서명이 아니다(Infra/SECURITY.md 21절).

export const MODELS_BASE = '/models';
export const MANIFEST_URL = `${MODELS_BASE}/manifest.json`;

export interface ManifestFile {
  path: string;
  sha256: string;
  size: number;
}

export interface ManifestVersion {
  version: string;
  files: ManifestFile[];
}

export interface ManifestModel {
  name: string;
  /** 지금 쓸 버전. 롤백하면 바뀐다 */
  current: string | null;
  versions: ManifestVersion[];
}

export interface Manifest {
  models: ManifestModel[];
}

/** 모델 하나의 지금 버전과 파일 목록 */
export interface CurrentModel {
  name: string;
  version: string;
  files: ManifestFile[];
}

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

// 게시 도구와 같은 규칙. 경로로 쓰이므로 허용한 문자만 받는다
const NAME_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const VERSION_RE = /^[0-9]{1,9}$/;
const SHA256_RE = /^[0-9a-f]{64}$/;
/** 파일 경로: 슬래시로 나뉜 조각마다 점으로 시작하지 않는 영문·숫자·점·하이픈·밑줄 */
const PATH_RE = /^(?:[A-Za-z0-9_-][A-Za-z0-9._-]*\/)*[A-Za-z0-9_-][A-Za-z0-9._-]*$/;

const isObject = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);

function parseFile(x: unknown): ManifestFile | null {
  if (!isObject(x)) return null;
  const { path, sha256, size } = x;
  if (typeof path !== 'string' || !PATH_RE.test(path) || path.includes('..')) return null;
  if (typeof sha256 !== 'string' || !SHA256_RE.test(sha256)) return null;
  if (typeof size !== 'number' || !Number.isInteger(size) || size < 0) return null;
  return { path, sha256, size };
}

function parseVersion(x: unknown): ManifestVersion | null {
  if (!isObject(x) || typeof x.version !== 'string' || !VERSION_RE.test(x.version) || !Array.isArray(x.files)) return null;
  const files = x.files.map(parseFile);
  // 파일 하나라도 형식이 틀리면 그 버전을 쓰지 않는다(일부만 받은 모델로 동작하지 않게)
  if (files.some((f) => f === null)) return null;
  return { version: x.version, files: files as ManifestFile[] };
}

function parseModel(x: unknown): ManifestModel | null {
  if (!isObject(x) || typeof x.name !== 'string' || !NAME_RE.test(x.name) || !Array.isArray(x.versions)) return null;
  const current = typeof x.current === 'string' && VERSION_RE.test(x.current) ? x.current : null;
  const versions = x.versions.map(parseVersion).filter((v): v is ManifestVersion => v !== null);
  return { name: x.name, current, versions };
}

/** 형식이 틀리면 null. 모델 항목 중 틀린 것은 버리고 나머지를 쓴다 */
export function parseManifest(x: unknown): Manifest | null {
  if (!isObject(x) || !Array.isArray(x.models)) return null;
  return { models: x.models.map(parseModel).filter((m): m is ManifestModel => m !== null) };
}

/** 이름의 모델이 지금 가리키는 버전. 없거나 current가 게시된 버전이 아니면 null */
export function currentModel(manifest: Manifest, name: string): CurrentModel | null {
  const model = manifest.models.find((m) => m.name === name);
  if (!model || model.current === null) return null;
  const version = model.versions.find((v) => v.version === model.current);
  return version ? { name, version: version.version, files: version.files } : null;
}

export function fileUrl(model: CurrentModel, path: string): string {
  return `${MODELS_BASE}/${model.name}/${model.version}/${path}`;
}

/** 매니페스트를 받는다. 캐시하지 않는다(롤백이 다음 연주부터 반영되게). 실패하면 null */
export async function fetchManifest(fetchFn: FetchLike): Promise<Manifest | null> {
  try {
    const res = await fetchFn(MANIFEST_URL, { cache: 'no-store' });
    if (!res.ok) return null;
    return parseManifest(await res.json());
  } catch {
    return null;
  }
}

function hex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
}

export async function sha256Hex(data: ArrayBuffer): Promise<string> {
  return hex(await crypto.subtle.digest('SHA-256', data));
}

/**
 * 모델 파일 하나를 받아 매니페스트의 크기·sha256과 맞는지 본다. 목록에 없는 파일이거나, 받지 못했거나, 다르면 null.
 * 버전 폴더의 파일은 바뀌지 않아서 브라우저 캐시를 그대로 쓴다.
 */
export async function fetchVerified(fetchFn: FetchLike, model: CurrentModel, path: string): Promise<ArrayBuffer | null> {
  const file = model.files.find((f) => f.path === path);
  if (!file) return null;
  try {
    const res = await fetchFn(fileUrl(model, path));
    if (!res.ok) return null;
    const data = await res.arrayBuffer();
    if (data.byteLength !== file.size) return null;
    return (await sha256Hex(data)) === file.sha256 ? data : null;
  } catch {
    return null;
  }
}

/** 검증한 파일을 JSON으로 읽는다. 검증이나 해석에 실패하면 null */
export async function fetchVerifiedJson(fetchFn: FetchLike, model: CurrentModel, path: string): Promise<unknown> {
  const data = await fetchVerified(fetchFn, model, path);
  if (!data) return null;
  try {
    return JSON.parse(new TextDecoder().decode(data));
  } catch {
    return null;
  }
}
