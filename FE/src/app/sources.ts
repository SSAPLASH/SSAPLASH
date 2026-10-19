// 입력 소스·InputManager의 앱 전역 단일 인스턴스. React 재마운트에 영향받지 않게 모듈 스코프에 둔다.
// 인스턴스 생성은 조립 층(app)만 한다. input/ 폴더는 클래스와 규칙만 내보낸다.
import { InputManager } from '@/input/InputManager';
import { KeyboardPadSource } from '@/input/KeyboardPadSource';
import { PointerStickSource } from '@/input/PointerStickSource';
import { BleStickSource } from '@/input/BleStickSource';
import { WebSocketStickSource } from '@/input/WebSocketStickSource';
import { useSettings } from '@/store/settingsStore';

export const inputManager = new InputManager();
export const keyboardSource = new KeyboardPadSource();
export const pointerSource = new PointerStickSource();
export const bleSource = new BleStickSource();
export const wsSource = new WebSocketStickSource(useSettings.getState().wsUrl);

/** Web Bluetooth 지원 여부. 화면은 input/ 클래스를 직접 보지 않고 여기서 묻는다 */
export const isBleSupported = (): boolean => BleStickSource.isSupported();
