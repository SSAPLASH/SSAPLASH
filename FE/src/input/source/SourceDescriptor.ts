// 입력 소스 디스크립터 타입. 구현 없음 — 각 소스 파일이 자기 디스크립터를 만들어 export하고,
// 조립 층(app/sensors.ts)이 레지스트리에 등록한다. 화면·bootstrap은 소스 종류 대신 이 타입만 읽는다.
import type { OptionValue, OptionValues, SensorId } from '@/domain/events';
import type { SensorTuning } from '@/domain/kit/calibration/tuning';
import type { InputSource } from './InputSource';

/** 설정 항목 하나의 스키마. 세팅 화면이 이걸 보고 입력 컨트롤을 그린다 */
export interface OptionSpec {
  /** sensorOptions[id][key] */
  key: string;
  label: string;
  /** 'key'는 "키를 누르세요" 캡처 입력 */
  type: 'text' | 'number' | 'key' | 'boolean';
  /** 저장값이 없을 때 쓰는 값 */
  default: OptionValue;
  /** number 타입일 때만 */
  min?: number;
  max?: number;
  step?: number;
  /** 입력 아래 작은 설명 */
  hint?: string;
}

/** 사용자 제스처가 필요한 동작 버튼(예: BLE 페어링) */
export interface ActionSpec {
  label: string;
  /** 클릭 시 실행. 메서드 문법이라 구현부가 구체 소스 클래스를 받아도 된다 */
  run(instance: InputSource): Promise<void>;
  /** 기본 ghost */
  variant?: 'primary' | 'ghost';
}

export interface SourceDescriptor {
  /** 저장·조회 키. 바꾸면 저장된 설정이 끊기므로 안정적으로 둔다 */
  id: SensorId;
  /** 화면 표시 이름 */
  label: string;
  /** 세팅 화면 한 줄 설명 */
  description: string;
  /** 이 브라우저에서 쓸 수 있는지. 아니면 reason을 경고로 보여준다(선택은 막지 않는다) */
  availability(): { ok: boolean; reason?: string };
  /** 인스턴스 생성. 레지스트리가 첫 사용 때 1회만 부르고 보관한다. 인자 없음 — 값은 applyOptions로만 받는다 */
  create(): InputSource;
  /** 세팅 화면이 그릴 설정 항목과 기본값 */
  options?: OptionSpec[];
  /** 설정이 바뀔 때마다 호출. options의 기본값이 이미 병합된 값이 온다 */
  applyOptions?(instance: InputSource, options: OptionValues): void;
  /** 튜닝이 바뀔 때마다 호출(선택). 각도 범위처럼 소스가 직접 쓰는 튜닝 값을 받는다 */
  applyTuning?(instance: InputSource, tuning: SensorTuning): void;
  /** 센서가 점유해 키보드 소스에서 빼야 할 키(KeyboardEvent.code). 없으면 빈 배열 */
  reservedKeys?(options: OptionValues): string[];
  /** 사용자 제스처가 필요한 동작 버튼 */
  actions?: ActionSpec[];
  /** 설정 패널 아래 작은 안내(선택). 설명·조작법처럼 항목으로 표현되지 않는 문구 */
  note?: string;
  /** 자유 연주·캘리브레이션 화면의 한 줄 조작 안내(선택). 연결 상태 대신 보여준다(연결 개념이 없는 소스용) */
  usageGuide?(options: OptionValues): string;
}
