# SSAPLASH 드럼 키트 출처

팀원이 고른 minorr 키트(2026-11-04 전달)다. 하이햇은 페달 상태에 따라 소리가 달라지도록 세 가지 소리를 둔다.

## 파일과 재생 설정

재생 설정은 `kit-config.json`에 있다. 게인·재생 속도는 WAV에 굽지 않았으므로 재생할 때 한 번만 적용한다.

| 패드 | 파일 | 원본 | 게인 |
|---|---|---|---|
| 킥 | `audio/kick.wav` | 팀원 전달 `kick.wav` (2026-11-06, 출처 미확인)를 가공 | 1.6 |
| 스네어 | `audio/snare.wav` | Snare F (Polmuz) | 0.9 |
| 하이햇 닫힌 타격 | `audio/hihat.wav` | HHAT Paiste 302+ 14'' FF | 2.4 |
| 하이햇 열린 타격 | `audio/hihat-open.wav` | HHAT Paiste 302+ 14'' open FF | 1.6 |
| 하이햇 페달 닫기 | `audio/hihat-pedal.wav` | 02a_Hat_OpenClose_Cymbals_&_Snares (Theriavirra) | 1.6 |
| 스몰탐 | `audio/high.wav` | TOM 1 F (Polmuz) | 1.2 |
| 미드탐 | `audio/mid.wav` | TOM 2 FF (Polmuz) | 0.8 |
| 플로어탐 | `audio/floor.wav` | TOM 3 FF (Polmuz) | 1.1 |
| 크래시 | `audio/crash.wav` | CRASH Zildian A Custom 16'' centr FF | 1.2 |
| 라이드 | `audio/ride.wav` | RIDE Zildian K Custom Session F (가공) | 1.2 |

- 하이햇 세 소리는 `kit-config.json`의 `pads.hihat`(닫힌 타격, `HIHAT`)·`pads.hihat_pedal`(페달 닫기, `HIHAT_PEDAL`)·`pads.hihat_open`(열린 타격, 페달 뗀 상태의 `HIHAT`)이다. 전달 원본의 `pads.hihat.variants`(basic·open·pedal)를 앱 스키마에 맞춰 이 세 키로 폈다. 지금 앱은 `hihat`만 읽고, `hihat_open`·`hihat_pedal`은 페달 입력 작업에서 연결한다(그 전까지 하이햇 페달은 `hihat`을 0.7배로 대신 낸다).
- 킥은 2026-11-06에 팀원이 준 `kick.wav`(스테레오, 0.21초, 기음 약 52Hz)를 가공해 쓴다. 원본은 에너지가 100Hz 아래에 몰려 작은 스피커에서 잘 안 들리고, 체감 음량(400ms K-가중)이 크래시보다 약 6dB 작았다. 가공 순서는 다음과 같다.
  1. 150Hz 아래 대역만 떼어 tanh 포화(drive 6)한 뒤 90~400Hz만 남겨 원음에 1.5배로 더한다 — 배음(100~300Hz)이 생겨 웅장하게 들린다.
  2. 3.2kHz +6dB(Q 0.8), 350Hz −2dB(Q 1.2) — 비터 어택은 살리고 탁한 대역은 줄인다.
  3. 소프트 니(0.4) 피크 정리 후 −1dBFS로 정규화, 끝 5ms 페이드.
  - 결과: 게인 1.6. 마스터(0.8)와 엔진 소프트 리미터(−1.9dBFS부터)를 거친 출력이 약 −11.5 LUFS로 크래시(−15.6)보다 약 4dB 크다. 리미터 무릎을 넘는 샘플은 3.1%(첫 타격 피크만), 일그러짐 성분은 원음 대비 −31dB다. 1.7부터는 −27dB 이하로 커지니 올리지 않는다.
  - 원본 sha256: `a7aed9222a4a23183b3c53ec007a47b11061548e9cef731d3f6aaddf428eae2f`
- 라이드는 첫 타격(스틱 소리, 약 10ms)만 뾰족하고 나머지가 작아 게인 5에서도 크래시보다 약 7dB 작았고, 게인만 더 올리면 첫 타격이 깨졌다. 그래서 룩어헤드 리미터(미리 보기 2ms, 릴리즈 60ms, 최대 −12dB)로 첫 타격만 게인 곡선으로 눌러 −1dBFS로 정규화했다. 파형을 깎지 않으므로 일그러짐이 없다. 게인 1.2에서 출력 약 −15.5 LUFS로 크래시(−15.6)와 같다. 원본 sha256: `e070646c1846860d92f2a51f9c815581b38c44c0e44baf6acebdfe98992031ea`
- 킥·라이드를 뺀 minorr WAV 7개는 원본 그대로다. 페달 소리는 팀원이 준 `hihat-chick.wav`(스테레오, 0.46초)를 바이트 그대로 쓴다. 하이햇을 열었다 닫는 소리를 chick 자리에 지정한 것이고, 발로만 닫는 소리를 따로 녹음한 것은 아니다.
- 파일 해시(sha256)는 `kit-config.json`에 있다.
- 전달 원본의 파일명(`snare-polmuz-f.wav`, `tom-*-polmuz.wav`, `hihat-chick.wav`)은 패드 id에 맞춰 바꿨다.

## 출처와 라이선스

**CC BY 소리는 제품 안에 출처를 표기해야 한다.** 스네어·탐 세 개(CC BY 3.0)와 하이햇 페달 닫기(CC BY 4.0)가 여기 해당한다.

- 킥 — **출처·라이선스 미확인** (팀원 전달 2026-11-06). 확인 후 채운다
- 스네어 — minorr, https://freesound.org/people/minorr/sounds/138378/ — **CC BY 3.0**
- 하이햇 닫힌 타격 — minorr, https://freesound.org/people/minorr/sounds/104222/ — CC0 1.0
- 하이햇 열린 타격 — minorr, https://freesound.org/people/minorr/sounds/104225/ — CC0 1.0
- 하이햇 페달 닫기 — Theriavirra, https://freesound.org/people/Theriavirra/sounds/270177/ — **CC BY 4.0**
- 스몰탐 — minorr, https://freesound.org/people/minorr/sounds/138369/ — **CC BY 3.0**
- 미드탐 — minorr, https://freesound.org/people/minorr/sounds/138368/ — **CC BY 3.0**
- 플로어탐 — minorr, https://freesound.org/people/minorr/sounds/138372/ — **CC BY 3.0**
- 크래시 — minorr, https://freesound.org/people/minorr/sounds/104218/ — CC0 1.0
- 라이드 — minorr, https://freesound.org/people/minorr/sounds/104236/ — CC0 1.0

라이선스 원문: CC0 1.0 https://creativecommons.org/publicdomain/zero/1.0/ · CC BY 3.0 https://creativecommons.org/licenses/by/3.0/ · CC BY 4.0 https://creativecommons.org/licenses/by/4.0/
