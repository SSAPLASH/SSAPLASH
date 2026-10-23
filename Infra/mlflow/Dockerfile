# MLflow 서버 이미지. 공식 이미지를 레지스트리에서 받지 못할 수 있고 버전 고정이 중요해서 직접 만든다.
FROM python:3.12-slim

# 버전을 고정한다. GPU 서버의 MLflow 버전과 호환성은 Infra/mlflow/README.md의 이동 절차에서 확인한다.
RUN pip install --no-cache-dir mlflow==3.17.2 psycopg2-binary==2.9.13 boto3==1.43.118

# S3 호환 스토리지(SeaweedFS)는 경로 방식으로 접속해야 한다.
# 가상 호스트 방식이면 버킷 이름이 호스트 이름이 되어 접속하지 못한다.
RUN mkdir -p /root/.aws && printf '[default]\ns3 =\n    addressing_style = path\n' > /root/.aws/config

# 모델 게시 도구. 서버 안에서 docker compose exec로 실행한다.
COPY publish_model.py /usr/local/bin/publish-model
RUN chmod +x /usr/local/bin/publish-model && mkdir -p /models

EXPOSE 5000
