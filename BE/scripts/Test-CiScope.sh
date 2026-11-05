#!/bin/sh
# 실제 Git diff와 고정 필터가 안전하게 선택되는지 일회용 저장소에서 검사한다.
set -eu
script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
scope_script="$script_dir/CiScope.sh"
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT HUP INT TERM
export GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_GLOBAL=/dev/null
seed="$tmp/seed"
git init -q "$seed"
git -C "$seed" config user.name test
git -C "$seed" config user.email test@example.invalid
for path in \
    BE/src/main/java/com/ssafy/airdrum/preset/Kit.java \
    BE/src/main/java/com/ssafy/airdrum/recording/Recording.java \
    BE/src/main/java/com/ssafy/airdrum/telemetry/Event.java \
    BE/src/main/java/com/ssafy/airdrum/song/Song.java \
    BE/src/main/java/com/ssafy/airdrum/auth/Auth.java \
    BE/src/test/java/com/ssafy/airdrum/preset/KitTest.java \
    Docs/API/examples/play-summary-v1.json BE/README.md FE/example.ts; do
    mkdir -p "$seed/$(dirname "$path")"
    printf 'base\n' > "$seed/$path"
done
git -C "$seed" add .
git -C "$seed" commit -qm base

case_number=0
check() {
    name=$1; expected=$2; change=$3; context=$4
    case_number=$((case_number + 1))
    repo="$tmp/case-$case_number"
    git clone -q --local "$seed" "$repo"
    git -C "$repo" config user.name test
    git -C "$repo" config user.email test@example.invalid
    base=$(git -C "$repo" rev-parse HEAD)
    case "$change" in
        preset) printf 'edit\n' >> "$repo/BE/src/main/java/com/ssafy/airdrum/preset/Kit.java";;
        preset-test) printf 'edit\n' >> "$repo/BE/src/test/java/com/ssafy/airdrum/preset/KitTest.java";;
        recording) printf 'edit\n' >> "$repo/BE/src/main/java/com/ssafy/airdrum/recording/Recording.java";;
        telemetry) printf 'edit\n' >> "$repo/BE/src/main/java/com/ssafy/airdrum/telemetry/Event.java";;
        song) printf 'edit\n' >> "$repo/BE/src/main/java/com/ssafy/airdrum/song/Song.java";;
        multi) printf 'edit\n' >> "$repo/BE/src/main/java/com/ssafy/airdrum/preset/Kit.java"; printf 'edit\n' >> "$repo/BE/src/main/java/com/ssafy/airdrum/recording/Recording.java";;
        docs) printf 'edit\n' >> "$repo/BE/README.md";;
        fe) printf 'edit\n' >> "$repo/FE/example.ts";;
        ai) mkdir -p "$repo/AI"; printf 'edit\n' > "$repo/AI/example.py";;
        fixture) printf 'edit\n' >> "$repo/Docs/API/examples/play-summary-v1.json";;
        auth) printf 'edit\n' >> "$repo/BE/src/main/java/com/ssafy/airdrum/auth/Auth.java";;
        unknown) mkdir -p "$repo/NewPart"; printf 'edit\n' > "$repo/NewPart/file";;
        delete) git -C "$repo" rm -q BE/src/main/java/com/ssafy/airdrum/preset/Kit.java;;
        rename) git -C "$repo" mv BE/src/main/java/com/ssafy/airdrum/preset/Kit.java BE/src/main/java/com/ssafy/airdrum/preset/Renamed.java;;
        spaces) printf 'edit\n' > "$repo/BE/src/main/java/com/ssafy/airdrum/preset/with spaces.java";;
        *) exit 1;;
    esac
    git -C "$repo" add -A
    git -C "$repo" commit -qm change
    head=$(git -C "$repo" rev-parse HEAD)
    source=merge_request_event; target=develop-BE; branch=feature; event=detached; before=$base
    case "$context" in
        mr) ;;
        main-target) target=main;;
        fe-target) target=develop-FE;;
        ai-target) target=develop-AI;;
        develop-source) branch=develop-BE;;
        merged) event=merged_result;;
        push) source=push; branch=develop-BE;;
        main-push) source=push; branch=main;;
        missing-base) base=1111111111111111111111111111111111111111;;
        zero-before) source=push; branch=develop-BE; before=0000000000000000000000000000000000000000;;
        *) exit 1;;
    esac
    actual=$(cd "$repo/BE" && CI_PROJECT_DIR="$repo" CI_PIPELINE_SOURCE="$source" CI_COMMIT_BRANCH="$branch" \
        CI_COMMIT_SHA="$head" CI_COMMIT_BEFORE_SHA="$before" CI_MERGE_REQUEST_DIFF_BASE_SHA="$base" \
        CI_MERGE_REQUEST_TARGET_BRANCH_NAME="$target" CI_MERGE_REQUEST_SOURCE_BRANCH_NAME="$branch" \
        CI_MERGE_REQUEST_EVENT_TYPE="$event" sh "$scope_script" classify)
    [ "$actual" = "$expected" ] || { printf '%s: expected %s, got %s\n' "$name" "$expected" "$actual" >&2; exit 1; }
    printf 'PASS %s: %s\n' "$name" "$actual"
}

check preset SELECT:1001000011 preset mr
check preset-test SELECT:1001000011 preset-test mr
check recording SELECT:0101000011 recording mr
check telemetry SELECT:0010000011 telemetry mr
check song SELECT:0101111111 song mr
check multi SELECT:1101000011 multi mr
check spaces SELECT:1001000011 spaces mr
check docs NONE docs mr
check fe NONE fe mr
check fe-target NONE fe fe-target
check ai-target NONE ai ai-target
check fe-main FULL fe main-target
check fixture FULL fixture mr
check auth FULL auth mr
check unknown FULL unknown mr
check deleted FULL delete mr
check renamed FULL rename mr
check unavailable-base FULL preset missing-base
check main-target FULL preset main-target
check develop-source FULL preset develop-source
check merged-result FULL preset merged
check develop-push SELECT:1001000011 preset push
check first-push FULL preset zero-before
check main-push FULL preset main-push

mkdir -p "$tmp/runner/scripts"
cp "$scope_script" "$tmp/runner/scripts/CiScope.sh"
cat > "$tmp/runner/gradlew" <<'EOF'
#!/bin/sh
printf '%s\n' "$@" > "$CI_CAPTURE"
EOF
chmod +x "$tmp/runner/gradlew"
cd "$tmp/runner"
export CI_CAPTURE="$tmp/args"
printf '%s\n' 'SELECT:1001000011' > .ci-scope
sh scripts/CiScope.sh test >/dev/null
grep -Fxq 'com.ssafy.airdrum.preset.*' "$CI_CAPTURE"
grep -Fxq 'com.ssafy.airdrum.play.*' "$CI_CAPTURE"
grep -Fxq 'com.ssafy.airdrum.withdrawal.*' "$CI_CAPTURE"
! grep -Fxq 'com.ssafy.airdrum.song.*' "$CI_CAPTURE"
! sh scripts/CiScope.sh midi
! sh scripts/CiScope.sh timescale
printf '%s\n' 'SELECT:0101111111' > .ci-scope
sh scripts/CiScope.sh midi
! sh scripts/CiScope.sh timescale
printf '%s\n' 'SELECT:0010000011' > .ci-scope
sh scripts/CiScope.sh timescale
printf '%s\n' 'invalid' > .ci-scope
[ "$(sh scripts/CiScope.sh mode)" = FULL ]
sh scripts/CiScope.sh midi
sh scripts/CiScope.sh timescale
sh scripts/CiScope.sh test >/dev/null
grep -Fxq test "$CI_CAPTURE"
! grep -Fxq -- --tests "$CI_CAPTURE"
printf '%s\n' FULL > .ci-scope
sh scripts/CiScope.sh midi
sh scripts/CiScope.sh timescale
sh scripts/CiScope.sh test >/dev/null
grep -Fxq test "$CI_CAPTURE"
! grep -Fxq -- --tests "$CI_CAPTURE"
rm .ci-scope
[ "$(sh scripts/CiScope.sh mode)" = FULL ]
printf '%s\n' NONE > .ci-scope
rm "$CI_CAPTURE"
sh scripts/CiScope.sh test >/dev/null
[ ! -e "$CI_CAPTURE" ]
printf '%s\n' 'PASS 실행 필터·전문 검사·누락/오류 보수 처리'
