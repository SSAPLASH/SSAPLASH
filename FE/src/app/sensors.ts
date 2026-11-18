// 센서 입력 소스 등록. 새 소스는 input/ 에 파일을 만들고 여기에 register 한 줄을 더하면 끝이다.
// 로직 없음. main.tsx가 bootstrapInput보다 먼저 import 한다.
import { sensorRegistry } from '@/runtime/sensorRegistry';
import { pointerDescriptor } from '@/input/source/PointerStickSource';
import { bleDescriptor } from '@/input/source/BleStickSource';
import { webSocketDescriptor } from '@/input/source/WebSocketStickSource';
import { webSerialDescriptor } from '@/input/source/WebSerialStickSource';

sensorRegistry.register(pointerDescriptor);
sensorRegistry.register(bleDescriptor);
sensorRegistry.register(webSocketDescriptor);
sensorRegistry.register(webSerialDescriptor);
