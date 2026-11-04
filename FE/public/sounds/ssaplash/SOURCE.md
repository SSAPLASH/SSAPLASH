# SSAPLASH 드럼 키트 출처

팀원이 고른 minorr 키트(2026-11-04 전달)다. 하이햇은 페달 상태에 따라 소리가 달라지도록 세 가지 소리를 둔다.

## 파일과 재생 설정

재생 설정은 `kit-config.json`에 있다. 게인·재생 속도는 WAV에 굽지 않았으므로 재생할 때 한 번만 적용한다.

| 패드 | 파일 | 원본 | 게인 |
|---|---|---|---|
| 킥 | `audio/kick.wav` | Yamaha Custom Birch BASS DRUM 22'' FF | 1.0 |
| 스네어 | `audio/snare.wav` | Snare F (Polmuz) | 1.0 |
| 하이햇 닫힌 타격 | `audio/hihat.wav` | HHAT Paiste 302+ 14'' FF | 1.0 |
| 하이햇 열린 타격 | `audio/hihat-open.wav` | HHAT Paiste 302+ 14'' open FF | 1.0 |
| 하이햇 페달 닫기 | `audio/hihat-pedal.wav` | 02a_Hat_OpenClose_Cymbals_&_Snares (Theriavirra) | 1.0 |
| 하이탐 | `audio/high.wav` | TOM 1 F (Polmuz) | 1.0 |
| 미들탐 | `audio/mid.wav` | TOM 2 FF (Polmuz) | 1.0 |
| 플로어탐 | `audio/floor.wav` | TOM 3 FF (Polmuz) | 1.0 |
| 크래시 | `audio/crash.wav` | CRASH Zildian A Custom 16'' centr FF | 1.0 |
| 라이드 | `audio/ride.wav` | RIDE Zildian K Custom Session F | 1.3 |

- 하이햇 세 소리는 `kit-config.json`의 `pads.hihat`(닫힌 타격, `HIHAT`)·`pads.hihat_pedal`(페달 닫기, `HIHAT_PEDAL`)·`pads.hihat_open`(열린 타격, 페달 뗀 상태의 `HIHAT`)이다. 전달 원본의 `pads.hihat.variants`(basic·open·pedal)를 앱 스키마에 맞춰 이 세 키로 폈다. 지금 앱은 `hihat`만 읽고, `hihat_open`·`hihat_pedal`은 페달 입력 작업에서 연결한다(그 전까지 하이햇 페달은 `hihat`을 0.7배로 대신 낸다).
- minorr WAV 9개는 원본 그대로다. 페달 소리는 팀원이 준 `hihat-chick.wav`(스테레오, 0.46초)를 바이트 그대로 쓴다. 하이햇을 열었다 닫는 소리를 chick 자리에 지정한 것이고, 발로만 닫는 소리를 따로 녹음한 것은 아니다.
- 파일 해시(sha256)는 `kit-config.json`에 있다.
- 전달 원본의 파일명(`snare-polmuz-f.wav`, `tom-*-polmuz.wav`, `hihat-chick.wav`)은 패드 id에 맞춰 바꿨다.

## 출처와 라이선스

**CC BY 소리는 제품 안에 출처를 표기해야 한다.** 스네어·탐 세 개(CC BY 3.0)와 하이햇 페달 닫기(CC BY 4.0)가 여기 해당한다.

- 킥 — minorr, https://freesound.org/people/minorr/sounds/104256/ — CC0 1.0
- 스네어 — minorr, https://freesound.org/people/minorr/sounds/138378/ — **CC BY 3.0**
- 하이햇 닫힌 타격 — minorr, https://freesound.org/people/minorr/sounds/104222/ — CC0 1.0
- 하이햇 열린 타격 — minorr, https://freesound.org/people/minorr/sounds/104225/ — CC0 1.0
- 하이햇 페달 닫기 — Theriavirra, https://freesound.org/people/Theriavirra/sounds/270177/ — **CC BY 4.0**
- 하이탐 — minorr, https://freesound.org/people/minorr/sounds/138369/ — **CC BY 3.0**
- 미들탐 — minorr, https://freesound.org/people/minorr/sounds/138368/ — **CC BY 3.0**
- 플로어탐 — minorr, https://freesound.org/people/minorr/sounds/138372/ — **CC BY 3.0**
- 크래시 — minorr, https://freesound.org/people/minorr/sounds/104218/ — CC0 1.0
- 라이드 — minorr, https://freesound.org/people/minorr/sounds/104236/ — CC0 1.0

라이선스 원문: CC0 1.0 https://creativecommons.org/publicdomain/zero/1.0/ · CC BY 3.0 https://creativecommons.org/licenses/by/3.0/ · CC BY 4.0 https://creativecommons.org/licenses/by/4.0/
