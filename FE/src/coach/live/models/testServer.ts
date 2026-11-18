// 시험용 가짜 모델 서버. 게시 도구가 만드는 것과 같은 매니페스트를 만들고 fetch를 흉내 낸다.
import { MANIFEST_URL, sha256Hex, type FetchLike } from './manifest';

export interface FakeFile {
  path: string;
  body: string;
  /** 매니페스트에 적을 sha256을 일부러 틀리게 한다 */
  badHash?: boolean;
}

export interface FakeVersion {
  version: string;
  files: FakeFile[];
}

export interface FakeModel {
  name: string;
  current: string | null;
  versions: FakeVersion[];
}

export class FakeModelServer {
  models: FakeModel[] = [];
  requests: string[] = [];
  /** true면 매니페스트 요청이 실패한다 */
  down = false;

  async manifest(): Promise<unknown> {
    const enc = new TextEncoder();
    return {
      updated: null,
      models: await Promise.all(
        this.models.map(async (m) => ({
          name: m.name,
          current: m.current,
          versions: await Promise.all(
            m.versions.map(async (v) => ({
              version: v.version,
              files: await Promise.all(
                v.files.map(async (f) => {
                  const bytes = enc.encode(f.body);
                  const sha = await sha256Hex(bytes.buffer as ArrayBuffer);
                  return { path: f.path, sha256: f.badHash ? sha.replace(/^./, sha[0] === '0' ? '1' : '0') : sha, size: bytes.byteLength };
                }),
              ),
            })),
          ),
        })),
      ),
    };
  }

  fetch: FetchLike = async (url) => {
    this.requests.push(url);
    if (url === MANIFEST_URL) {
      if (this.down) return new Response('down', { status: 503 });
      return new Response(JSON.stringify(await this.manifest()), { status: 200 });
    }
    for (const m of this.models) {
      for (const v of m.versions) {
        for (const f of v.files) {
          if (url === `/models/${m.name}/${v.version}/${f.path}`) return new Response(f.body, { status: 200 });
        }
      }
    }
    return new Response('not found', { status: 404 });
  };
}
