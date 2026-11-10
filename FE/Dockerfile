# FE 이미지. Vite로 정적 파일을 만들고 비루트 Nginx로 서빙한다.
# 서버 앞단 Nginx(Infra)가 이 컨테이너(web)로 `/` 요청을 넘기고, `/api`는 BE로 보낸다.

# ---- 1단계: 빌드 ----
FROM node:22-alpine AS build

WORKDIR /app

# 의존성만 먼저 설치한다. 소스가 바뀌어도 이 층은 다시 만들어지지 않는다.
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY . .

# 빌드 때 고정되는 환경 변수(FE/.env.example 참고). 값이 있는 것만 .env.production.local에 쓴다.
# 비워 두면 미설정과 같아 기본값(로그인 필수, 제공자 전체, 모니터 페이지 없음)으로 빌드된다.
ARG VITE_KEYBOARD_INPUT=
ARG VITE_LOGIN_PROVIDERS=
ARG VITE_MONITOR=
ARG VITE_RECOMMENDATION_CONSENT_ENABLED=
ARG VITE_COACH_GATE=
ARG VITE_COACH_GATE_MODE=
RUN for v in VITE_KEYBOARD_INPUT VITE_LOGIN_PROVIDERS VITE_MONITOR VITE_RECOMMENDATION_CONSENT_ENABLED VITE_COACH_GATE VITE_COACH_GATE_MODE; do \
      eval "val=\$$v"; \
      if [ -n "$val" ]; then echo "$v=$val" >> .env.production.local; fi; \
    done; \
    npm run build

# ---- 2단계: 서빙 ----
# 비루트(nginx-unprivileged)라 1024 미만 포트를 못 써서 8080에서 듣는다.
FROM nginxinc/nginx-unprivileged:1.27-alpine

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 8080

HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=5 \
    CMD wget -q -O /dev/null http://127.0.0.1:8080/healthz || exit 1
