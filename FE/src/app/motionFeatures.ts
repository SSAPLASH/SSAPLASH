// LazyMotion이 지연 로드하는 기능 묶음. MotionProvider에서만 동적 import한다(정적 import 금지 — 메인 청크에 합쳐진다).
// domMax: 레이아웃 애니메이션(layout/layoutId)·드래그까지 포함한다.
import { domMax } from 'motion/react';

export default domMax;
