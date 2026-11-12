# 실물 드럼 그림 만들기

실물 드럼 스킨의 그림을 원본 이미지 한 장에서 잘라 내는 개발용 도구다. 앱이 실행 중에 부르지 않는다. **원본 그림이 바뀌었을 때만** 한 번 돌리고, 나온 파일을 커밋한다.

## 무엇이 나오나

| 나오는 것 | 자리 | 쓰는 곳 |
| --- | --- | --- |
| 조각 이미지(WebP) 10장 | `FE/src/components/drum/acoustic/persp/` | 화면이 패드마다 한 장씩 불러 쓴다 |
| 패드별 자리 표 | `FE/src/domain/kit/kitArt.ts` | 헤드 중심·반지름, 링·라벨 자리, 고정 배치 자리 |
| 확인용 그림 | `FE/scripts/kit-art/out/persp-check.jpg` | 조각을 제자리에 다시 놓고 헤드 타원을 그린 것. 눈으로 본다 |

`kitArt.ts`는 이 도구가 쓰는 파일이다. 손으로 고치지 않는다.

## 돌리는 법

1. 원본을 `FE/scripts/kit-art/source/persp.png`에 둔다. 용량이 커서 저장소에는 올리지 않는다(`.gitignore`).
2. `pip install pillow numpy scipy`
3. `python FE/scripts/kit-art/build.py`
4. `out/persp-check.jpg`에서 빨간 타원이 헤드에 맞는지 본다.
5. `FE`에서 `npm test`를 돌린다(`src/domain/kit/kitArt.test.ts`가 구성과 자리를 검사한다).

## 원본이 지켜야 할 것

- 배경은 한 가지 색이다. 도구가 가장자리 색을 배경으로 보고 뺀다.
- 드럼끼리 겹치지 않는다. 이어진 덩어리 하나를 조각 하나로 자른다.
- 하이햇은 스탠드·윗판·페달이 한 덩어리여도 된다. `regions.json`에 윗판 타원과 페달 다각형을 적어 나눈다.

## `regions.json`

| 항목 | 뜻 |
| --- | --- |
| `source` | 원본 파일 |
| `scale` | 조각 이미지를 저장할 때 줄이는 배율 |
| `content` | 킷 상자로 삼을 원본 범위(왼쪽, 위, 오른쪽, 아래). 폭이 킷 단위 760이 된다 |
| `closeDy` | 하이햇이 닫힐 때 윗판이 내려가는 거리(원본 픽셀) |
| `pieces[].seed` | 그 조각 위의 한 점. 이 점이 든 덩어리가 조각이 된다 |
| `pieces[].head` | 헤드 찾는 법. `gold` 심벌 원판, `white` 드럼 헤드, `hoop` 킥 앞면의 금색 테, 또는 타원 값(중심 x·y, 반지름 가로·세로) |
| `pieces[].partOf` | 다른 조각의 덩어리 안에서 `ellipse`·`rect`·`polygon`으로 떼어 내는 조각 |
| `pieces[].minus` | 떼어 낸 조각을 뺄 대상 |

조각은 배열 순서대로 그린다(뒤 → 앞).
