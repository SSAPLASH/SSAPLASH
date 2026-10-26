// 센서 입력 소스 등록. 새 소스는 input/ 에 파일을 만들고 여기에 register 한 줄을 더하면 끝이다.
// 로직 없음. main.tsx가 bootstrapInput보다 먼저 import 한다.
import { sensorRegistry } from './sensorRegistry';
import { pointerDescriptor } from '@/input/PointerStickSource';
import { bleDescriptor } from '@/input/BleStickSource';
import { webSocketDescriptor } from '@/input/WebSocketStickSource';

sensorRegistry.register(pointerDescriptor);
sensorRegistry.register(bleDescriptor);
sensorRegistry.register(webSocketDescriptor);
