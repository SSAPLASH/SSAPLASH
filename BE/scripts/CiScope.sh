#!/bin/sh
set -eu

# main 통합에서만 전체 검사를 실행한다.
mode=FAST
if { [ "${CI_PIPELINE_SOURCE:-}" = merge_request_event ] && [ "${CI_MERGE_REQUEST_TARGET_BRANCH_NAME:-}" = main ]; } \
    || [ "${CI_COMMIT_BRANCH:-}" = main ]; then
    mode=FULL
fi

case "${1:-}" in
    mode) printf '%s\n' "$mode" ;;
    test)
        printf '검사 범위: %s\n' "$mode"
        if [ "$mode" = FULL ]; then
            exec ./gradlew --no-daemon --build-cache test
        fi
        set -- test
        for test_class in \
            domain.auth.service.token.AccessTokenServiceTest domain.auth.cookie.RefreshTokenCookieTest domain.user.model.SignupConsentVersionsTest \
            global.validation.JsonObjectValidatorTest domain.chart.model.ChartDocumentReaderTest domain.chart.service.worker.WorkerPayloadTest \
            domain.play.service.upload.PlayPayloadTest domain.recording.validation.RecordingPayloadTest domain.telemetry.validation.TelemetryBatchValidatorTest \
            global.media.AudioDurationTest domain.song.service.midi.GmDrumMappingTest domain.chart.model.DifficultyThinnerTest \
            domain.report.service.summary.ReportAggregatorTest; do
            set -- "$@" --tests "com.ssafy.airdrum.$test_class"
        done
        set -- "$@" bootJar
        exec ./gradlew --no-daemon --build-cache "$@" ;;
    *) printf '%s\n' '사용법: CiScope.sh mode|test' >&2; exit 2;;
esac
