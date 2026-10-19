FROM eclipse-temurin:21-jdk-jammy AS build
WORKDIR /workspace
COPY gradlew settings.gradle build.gradle ./
COPY gradle ./gradle
COPY src ./src
RUN sh ./gradlew --no-daemon build

FROM eclipse-temurin:21-jre-jammy
WORKDIR /app
RUN groupadd --gid 10001 app && useradd --uid 10001 --gid app --no-create-home app
COPY --from=build --chown=app:app /workspace/build/libs/app.jar ./app.jar
ENV SERVER_ADDRESS=0.0.0.0
EXPOSE 8080
USER app
ENTRYPOINT ["java", "-jar", "/app/app.jar"]
