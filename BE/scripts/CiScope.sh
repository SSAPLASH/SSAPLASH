#!/bin/sh
# 변경을 확실히 분류할 수 없으면 모든 검사를 실행한다.
set -eu

scope_file=.ci-scope

read_scope() {
    scope=$(cat "$scope_file" 2>/dev/null) || scope=FULL
    case "$scope" in
        FULL|FAST|NONE) ;;
        *) scope=FULL ;;
    esac
    printf '%s\n' "$scope"
}

classify() {
    scope=FULL
    source=${CI_PIPELINE_SOURCE:-}
    commit=${CI_COMMIT_SHA:-}
    base=
    if [ "$source" = merge_request_event ]; then
        case "${CI_MERGE_REQUEST_TARGET_BRANCH_NAME:-}" in
            develop-BE|develop-FE|develop-AI|develop-EMB) ;;
            *) printf '%s\n' FULL; return;;
        esac
        [ "${CI_MERGE_REQUEST_SOURCE_BRANCH_NAME:-}" != develop-BE ] || { printf '%s\n' FULL; return; }
        [ "${CI_MERGE_REQUEST_EVENT_TYPE:-}" = detached ] || { printf '%s\n' FULL; return; }
        base=${CI_MERGE_REQUEST_DIFF_BASE_SHA:-}
    elif [ "$source" = push ] && [ "${CI_COMMIT_BRANCH:-}" = develop-BE ]; then
        base=${CI_COMMIT_BEFORE_SHA:-}
    else
        printf '%s\n' FULL; return
    fi
    case "$base:$commit" in *[!0-9a-f:]*|:*|*:|*0000000000000000000000000000000000000000*) printf '%s\n' FULL; return;; esac
    [ "${#base}" -eq 40 ] && [ "${#commit}" -eq 40 ] || { printf '%s\n' FULL; return; }
    command -v git >/dev/null 2>&1 || { printf '%s\n' FULL; return; }
    root=${CI_PROJECT_DIR:-$(pwd)}
    g() { git -c "safe.directory=$root" "$@"; }
    [ "$(g rev-parse HEAD 2>/dev/null || :)" = "$commit" ] || { printf '%s\n' FULL; return; }
    g cat-file -e "$base^{commit}" 2>/dev/null && g cat-file -e "$commit^{commit}" 2>/dev/null \
        && g merge-base --is-ancestor "$base" "$commit" 2>/dev/null || { printf '%s\n' FULL; return; }
    diff_file=$(mktemp)
    trap 'rm -f "$diff_file"' EXIT HUP INT TERM
    g diff --name-status -z --find-renames "$base" "$commit" -- > "$diff_file" 2>/dev/null \
        || { rm -f "$diff_file"; trap - EXIT HUP INT TERM; printf '%s\n' FULL; return; }
    scope=NONE
    seen=0
    # BusyBox ash와 bash 모두 NUL 구분자를 지원한다. 경로를 코드로 실행하지 않는다.
    while IFS= read -r -d '' status && IFS= read -r -d '' path; do
        seen=1
        case "$status" in A|M) ;; *) scope=FULL; break;; esac
        case "$path" in
            README.md|BE/README.md|Docs/Convention/*.md|FE/*|AI/*|EMB/*) ;;
            BE/src/main/java/com/ssafy/airdrum/preset/*|BE/src/test/java/com/ssafy/airdrum/preset/*|BE/src/main/java/com/ssafy/airdrum/recording/*|BE/src/test/java/com/ssafy/airdrum/recording/*|BE/src/main/java/com/ssafy/airdrum/telemetry/*|BE/src/test/java/com/ssafy/airdrum/telemetry/*|BE/src/main/java/com/ssafy/airdrum/play/*|BE/src/test/java/com/ssafy/airdrum/play/*|BE/src/main/java/com/ssafy/airdrum/report/*|BE/src/test/java/com/ssafy/airdrum/report/*|BE/src/main/java/com/ssafy/airdrum/sheet/*|BE/src/test/java/com/ssafy/airdrum/sheet/*|BE/src/main/java/com/ssafy/airdrum/song/*|BE/src/test/java/com/ssafy/airdrum/song/*|BE/src/main/java/com/ssafy/airdrum/chart/*|BE/src/test/java/com/ssafy/airdrum/chart/*) scope=FAST;;
            *) scope=FULL; break;;
        esac
    done < "$diff_file"
    rm -f "$diff_file"
    trap - EXIT HUP INT TERM
    [ "$seen" = 1 ] || scope=FULL
    printf '%s\n' "$scope"
}

case "${1:-}" in
    classify) classify ;;
    mode) read_scope ;;
    describe)
        scope=$(read_scope)
        printf '검사 범위: %s\n' "$scope"
        ;;
    midi|timescale)
        scope=$(read_scope)
        case "$scope" in
            FULL) exit 0;; FAST|NONE) exit 1;;
        esac ;;
    test|benchmark)
        operation=$1
        if [ "$operation" = test ]; then
            scope=$(read_scope)
            sh scripts/CiScope.sh describe
            case "$scope" in
                NONE) printf '%s\n' '문서만 변경되어 BE 검사를 생략합니다.'; exit 0;;
                FULL) exec ./gradlew --no-daemon --build-cache test;;
                FAST) ;;
            esac
            set -- test
        else
            set -- clean test
        fi
        for test_class in \
            auth.AccessTokenServiceTest auth.RefreshTokenCookieTest user.SignupConsentVersionsTest \
            common.validation.JsonObjectValidatorTest chart.ChartDocumentReaderTest chart.worker.WorkerPayloadTest \
            play.PlayPayloadTest recording.RecordingPayloadTest telemetry.TelemetryBatchValidatorTest \
            song.audio.AudioDurationTest song.midi.GmDrumMappingTest song.midi.DifficultyThinnerTest \
            report.ReportAggregatorTest; do
            set -- "$@" --tests "com.ssafy.airdrum.$test_class"
        done
        if [ "$operation" = benchmark ]; then
            set -- "$@" bootJar
            exec ./gradlew --no-daemon --no-build-cache "$@"
        fi
        exec ./gradlew --no-daemon --build-cache "$@" ;;
    *) printf '%s\n' '사용법: CiScope.sh classify|mode|describe|midi|timescale|test|benchmark' >&2; exit 2;;
esac
