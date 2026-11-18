# S15P31A307

SSAFY 15기 2학기 자율 프로젝트 - **자율**

---

## 저장소 구조

```
S15P31A307/
├─ AI/       
├─ BE/       API 서버 
├─ EMB/      임베디드 
├─ FE/       웹 클라이언트 
├─ Infra/    배포 구성 
└─ Docs/
   └─ README.md       상세 문서 안내 (GitLab Wiki)
```

각 파트의 셋업과 실행 방법은 해당 폴더의 README를 참조한다.

| 파트 | 스택 | 문서 |
| --- | --- | --- |
| AI & Data | Python 3.11 · PyTorch · FastAPI · BS-RoFormer · STRUM · Ollama(gemma3:12b) · MLflow | [AI/README.md](./AI/README.md) |
| Backend | Java 21 · Spring Boot 4.1.1 · Gradle | [BE/README.md](./BE/README.md) |
| Embedded | Arduino(C/C++) · Adafruit Feather nRF52840 Sense · Seeed XIAO nRF52840 · BLE | [EMB/README.md](./EMB/README.md) |
| Frontend | React 19 · TypeScript · Vite · Zustand · TanStack Query · ONNX Runtime Web | [FE/README.md](./FE/README.md) |
| Infra | AWS EC2 · Docker Compose · Nginx · PostgreSQL(TimescaleDB) · Redis · SeaweedFS · GitLab CI/CD · Prometheus · Grafana · Loki | [Infra/README.md](./Infra/README.md) |

---

## 개발 규칙

브랜치 전략, 커밋 메시지 형식, MR·코드리뷰 규칙은 [Git 컨벤션 Wiki](https://lab.ssafy.com/s15-final/S15P31A307/-/wikis/3-%EA%B7%9C%EC%B9%99/3-1-Git-%EC%BB%A8%EB%B2%A4%EC%85%98)를 따른다.

```
브랜치   feat/{Epic prefix}-{작업 내용}   예) feat/AUTH-login-api
커밋     [{JIRA 키}] {type}: {subject}   예) [S15P31A307-3] docs: 기획 문서 추가
```

- `main`, `develop-*`은 직접 커밋 금지 — MR을 통해서만 반영한다
- MR은 리뷰어 1인 이상의 승인을 받아야 병합한다

---

## 기획 문서

상세 기획·요구사항은 [GitLab Wiki](https://lab.ssafy.com/s15-final/S15P31A307/-/wikis/home)에서 관리한다. 저장소에는 [문서 안내](./Docs/README.md)와 기획 근거 재현 도구(`tools/planning-references/`)만 둔다.

