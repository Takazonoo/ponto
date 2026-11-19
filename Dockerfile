FROM maven:3.9-eclipse-temurin-21 AS build
WORKDIR /build
COPY pom.xml .
COPY src/main src/main
RUN mvn --batch-mode --no-transfer-progress -DskipTests package

FROM eclipse-temurin:21-jre
WORKDIR /app
COPY --from=build /build/target/controle-de-gastos-0.1.0.jar /app/ponto.jar
USER 10001
ENV SPRING_PROFILES_ACTIVE=hosted
EXPOSE 8080
ENTRYPOINT ["java", "-XX:MaxRAMPercentage=55", "-jar", "/app/ponto.jar"]
