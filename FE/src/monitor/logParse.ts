// LOG 패킷 문자열 파서. 펌웨어가 정한 3가지 형식(BOOT·drop·I2C REC)만 구조화하고 나머지는 텍스트로 둔다.

export type ParsedLog =
  | { kind: 'boot'; version: string; hash: string; raw: string }
  | { kind: 'drop'; reason: 'weak' | 'slow' | 'long' | string; dps: number; raw: string }
  | { kind: 'i2cRec'; count: number; raw: string }
  | { kind: 'text'; raw: string };

const BOOT_RE = /^BOOT\s+(\S+)\s+(\S+)$/;
const DROP_RE = /^drop\s+(\S+)\s+(\S+)$/;
const I2C_RE = /^I2C\s+REC\s+(\S+)$/;
const NUM_RE = /^-?\d+(\.\d+)?$/;

/** `BOOT {ver} {hash}` / `drop {reason} {dps}` / `I2C REC {n}`. 숫자가 틀리거나 형식이 다르면 text */
export function parseLogText(text: string): ParsedLog {
  const raw = text;
  const s = text.trim();
  let m = BOOT_RE.exec(s);
  if (m) return { kind: 'boot', version: m[1], hash: m[2], raw };
  m = DROP_RE.exec(s);
  if (m && NUM_RE.test(m[2])) return { kind: 'drop', reason: m[1], dps: Number(m[2]), raw };
  m = I2C_RE.exec(s);
  if (m && /^\d+$/.test(m[1])) return { kind: 'i2cRec', count: Number(m[1]), raw };
  return { kind: 'text', raw };
}
