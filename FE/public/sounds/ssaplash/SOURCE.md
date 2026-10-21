# SSAPLASH 드럼 키트 전달용

압축을 풀고 listen.html을 Chrome 또는 Edge에서 열어 ‘소리 켜기’를 누르세요.
HTML 안에 선택한 8개 소리가 모두 포함돼 있어 인터넷 연결 없이 연주할 수 있습니다.
별도 프로그램 설치는 필요 없습니다. 브라우저 설정에 따라 첫 로딩은 잠시 걸릴 수 있습니다.

## 이번 설정

- 킥: 강한 킥
- 스네어: 강한 중앙 타격, 재생 음량 1.2배
- 하이햇: 페달 닫기, 재생 음량 0.8배
- 하이탐: 14인치 중앙, +6 반음
- 미들탐: 15인치 강하게, +3 반음
- 플로어탐: 18인치 강하게, -3.5 반음
- 크래시: Virtuosity 룸 마이크
- 라이드: 22인치 벨
- 전체 음량: 사진과 같은 21%. 사용자가 전체 음량을 조절할 수 있습니다.

이전 미리보기와 저장 공간을 분리하여 처음 열면 위 설정으로 시작합니다.
이 파일에서 바꾼 값은 같은 브라우저에서 저장될 수 있습니다.

## 프론트 연결

오디오 파일은 audio/에, 재생 설정은 kit-config.json에 있습니다.
WAV는 미리보기의 원본 샘플과 동일합니다. 위 음량과 음높이는 WAV에 굽지 않았습니다.
파일만 재생하면 현재 선택한 튜닝과 다르므로 반드시 설정을 함께 적용하세요.

1. audio 폴더와 설정 파일을 프론트 정적 파일 경로에 복사합니다.
2. 시작 시 파일을 fetch하고 AudioContext.decodeAudioData로 미리 읽어 둡니다.
3. 타격마다 새 AudioBufferSourceNode를 만들고 해당 버퍼를 연결합니다.
4. source.playbackRate.value = pad.playbackRate 를 적용합니다.
5. 악기별 GainNode에 pad.gain을 적용하고 전체 음량 GainNode를 거쳐 출력합니다.
6. 전체 음량 초기값은 0.21입니다. 탐 높낮이/악기 음량을 중복 적용하지 마세요.

동일 패드 연타나 여러 패드 동시 타격에는 각각 별도의 소스를 사용합니다.
센서 이벤트와 실제 앱 연결, 저장소 업로드/배포는 이 전달 파일에 포함되지 않습니다.

## 출처

크래시는 Versilian Studios의 Virtuosity Drums, 나머지는 Karoryfer의 Big Rusty Drums입니다.
원본 배포에 동봉된 CC0 라이선스를 licenses/에 함께 제공합니다.
각 샘플 경로와 파일 해시는 kit-config.json에 기록했습니다.

- https://shop.karoryfer.com/pages/free-big-rusty-drums
- https://github.com/sfzinstruments/karoryfer.big-rusty-drums
- https://versilian-studios.com/virtuosity-drums/
- https://github.com/sfzinstruments/virtuosity_drums
