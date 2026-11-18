// 키보드 소스·InputManager의 앱 전역 단일 인스턴스. React 재마운트에 영향받지 않게 모듈 스코프에 둔다.
// 인스턴스 생성은 조립 층(app)만 한다. input/ 폴더는 클래스와 규칙만 내보낸다.
// 센서 소스 인스턴스는 여기가 아니라 sensorRegistry가 디스크립터의 create로 지연 생성해 보관한다.
import { InputManager } from '@/input/InputManager';
import { KeyboardPadSource } from '@/input/source/KeyboardPadSource';
import { TouchPadSource } from '@/input/source/TouchPadSource';

export const inputManager = new InputManager();
export const keyboardSource = new KeyboardPadSource();
// 키보드 타격은 연주 중인 화면이 runtime/keyboardDrum으로 켤 때만 받는다. 그 밖에서는 키(Space 스크롤·단축키)를 가로채지 않는다
keyboardSource.setEnabled(false);
/** 화면 터치 소스(MODE-002). 키보드처럼 항상 붙어 있고, 자유 연습의 DrumKit만 strike를 부른다 */
export const touchSource = new TouchPadSource();

/**
 * 키보드(임시 입력) 사용 여부. 빌드 시 VITE_KEYBOARD_INPUT=false면 키 매핑 카드와 키보드 소스 등록을 함께 끈다.
 * 스틱 도착 후 끄는 용도이고, 기본은 켜짐이다.
 */
export const KEYBOARD_INPUT_ENABLED = import.meta.env.VITE_KEYBOARD_INPUT !== 'false';
