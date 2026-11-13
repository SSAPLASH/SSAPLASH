// 입력 소스 레지스트리. 디스크립터 등록·조회와 인스턴스 지연 생성·보관을 맡는다.
// 인스턴스 생성은 조립 층(app)만 한다는 규칙 때문에 input/이 아니라 여기에 둔다.
// 활성화·연결은 하지 않는다(그건 bootstrap).
import type { OptionValues, SensorId } from '@/domain/events';
import type { InputSource } from '@/input/source/InputSource';
import type { SourceDescriptor } from '@/input/source/SourceDescriptor';

/** 레지스트리가 id로 받지 않는 예약어 */
const RESERVED_IDS: readonly string[] = ['none', 'keyboard', 'preview', 'touch'];

export class SensorRegistry {
  private descriptors = new Map<SensorId, SourceDescriptor>();
  private instances = new Map<SensorId, InputSource>();

  /** 같은 id가 이미 있거나 예약어('none'·'keyboard'·'preview'·'touch')면 예외 */
  register(desc: SourceDescriptor): void {
    if (RESERVED_IDS.includes(desc.id)) throw new Error(`예약된 입력 소스 id입니다: ${desc.id}`);
    if (this.descriptors.has(desc.id)) throw new Error(`이미 등록된 입력 소스 id입니다: ${desc.id}`);
    this.descriptors.set(desc.id, desc);
  }

  get(id: SensorId): SourceDescriptor | undefined {
    return this.descriptors.get(id);
  }

  /** 등록 순서. 세팅 화면 목록 순서가 된다 */
  list(): SourceDescriptor[] {
    return [...this.descriptors.values()];
  }

  /** 'none'(센서 없음)은 항상 true */
  isKnown(id: SensorId): boolean {
    return id === 'none' || this.descriptors.has(id);
  }

  /** 첫 호출에 create()로 만들고 이후 캐시를 돌려준다. 등록되지 않은 id면 예외 */
  instance(id: SensorId): InputSource {
    const cached = this.instances.get(id);
    if (cached) return cached;
    const desc = this.descriptors.get(id);
    if (!desc) throw new Error(`등록되지 않은 입력 소스입니다: ${id}`);
    const created = desc.create();
    this.instances.set(id, created);
    return created;
  }
}

export const sensorRegistry = new SensorRegistry();

/** 저장된 설정값에 디스크립터의 기본값을 채운다. 스키마에 없는 키는 그대로 둔다 */
export function resolveOptions(desc: SourceDescriptor, stored: OptionValues | undefined): OptionValues {
  const out: OptionValues = {};
  for (const spec of desc.options ?? []) out[spec.key] = spec.default;
  return { ...out, ...stored };
}
