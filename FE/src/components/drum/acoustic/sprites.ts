// 실물 드럼 조각 이미지. 이름은 domain/kit/kitArt의 sprite와 같다. 파일은 FE/scripts/kit-art/build.py가 만든다.
// 같은 이름의 조각이 persp(원근, 큰 킷)·top(위에서 본 그림, 작은 킷) 폴더에 하나씩 있다.
import type { KitView } from '@/domain/kit/drumKit';
import crash from './persp/crash.webp';
import crashTop from './persp/crash-top.webp';
import floorTom from './persp/floor-tom.webp';
import hihatBase from './persp/hihat-base.webp';
import hihatPedal from './persp/hihat-pedal.webp';
import hihatTop from './persp/hihat-top.webp';
import kick from './persp/kick.webp';
import midTom from './persp/mid-tom.webp';
import ride from './persp/ride.webp';
import rideTop from './persp/ride-top.webp';
import smallTom from './persp/small-tom.webp';
import snare from './persp/snare.webp';
import tCrash from './top/crash.webp';
import tCrashTop from './top/crash-top.webp';
import tFloorTom from './top/floor-tom.webp';
import tHihatBase from './top/hihat-base.webp';
import tHihatPedal from './top/hihat-pedal.webp';
import tHihatTop from './top/hihat-top.webp';
import tKick from './top/kick.webp';
import tMidTom from './top/mid-tom.webp';
import tRide from './top/ride.webp';
import tRideTop from './top/ride-top.webp';
import tSmallTom from './top/small-tom.webp';
import tSnare from './top/snare.webp';

const PERSP: Record<string, string> = {
  crash,
  'crash-top': crashTop,
  ride,
  'ride-top': rideTop,
  'small-tom': smallTom,
  'mid-tom': midTom,
  kick,
  'hihat-base': hihatBase,
  'hihat-top': hihatTop,
  snare,
  'floor-tom': floorTom,
  'hihat-pedal': hihatPedal,
};

const TOP: Record<string, string> = {
  crash: tCrash,
  'crash-top': tCrashTop,
  ride: tRide,
  'ride-top': tRideTop,
  'small-tom': tSmallTom,
  'mid-tom': tMidTom,
  kick: tKick,
  'hihat-base': tHihatBase,
  'hihat-top': tHihatTop,
  snare: tSnare,
  'floor-tom': tFloorTom,
  'hihat-pedal': tHihatPedal,
};

/** 조각 이미지 주소. view에 맞는 폴더에서 찾고, 모르는 이름이면 undefined */
export function spriteUrl(name: string, view: KitView = 'persp'): string | undefined {
  return (view === 'top' ? TOP : PERSP)[name];
}

let preloaded = false;

/**
 * 조각 이미지를 미리 받는다(원근·위에서 본 그림 두 벌). 앱 시작 뒤 한가할 때 한 번만 부른다(두 번째부터는 아무 일도 하지 않는다).
 * 이미지가 오기 전에도 킷 크기와 누름 영역은 같아서 치는 동작은 된다.
 */
export function preloadSprites(): void {
  if (preloaded || typeof Image === 'undefined') return;
  preloaded = true;
  for (const url of [...Object.values(PERSP), ...Object.values(TOP)]) {
    const img = new Image();
    img.src = url;
  }
}

/** 테스트용: 미리 받기 기록을 지운다 */
export function resetPreloadForTest(): void {
  preloaded = false;
}
