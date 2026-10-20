FROM eclipse-temurin:21-jdk-jammy AS build
WORKDIR /workspace
COPY gradlew settings.gradle build.gradle ./
COPY gradle ./gradle
COPY src ./src
# 테스트는 CI(be-test)가 맡는다. 테스트용 임베디드 PostgreSQL은 root로 실행되는 이 단계에서 뜨지 않는다.
RUN sh ./gradlew --no-daemon bootJar

FROM eclipse-temurin:21-jre-jammy
WORKDIR /app
RUN groupadd --gid 10001 app && useradd --uid 10001 --gid app --no-create-home app
COPY --from=build --chown=app:app /workspace/build/libs/app.jar ./app.jar
ENV SERVER_ADDRESS=0.0.0.0
EXPOSE 8080
USER app
ENTRYPOINT ["java", "-jar", "/app/app.jar"]
