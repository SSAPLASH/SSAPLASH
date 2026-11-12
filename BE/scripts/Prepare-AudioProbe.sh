#!/bin/sh
# CI 일반 사용자로 실행한다. 고정 릴리즈와 해제 도구를 SHA-256 검증한다.
# 고정 빌드는 FFmpeg-Builds 자동 빌드다. 저장소가 오래된 자동 빌드를 지우므로(약 2주) 다운로드가 404면 같은 8.1 계열 최신 빌드로 이 파일의 이름·주소·SHA-256을 함께 바꾼다.
set -eu
archive=ffmpeg-n8.1.3-35-gf1acb0a266-linux64-lgpl-8.1.tar.xz
sha=c3a14ffda2150d82361a9acee85acf19080bceab1c2321cc16cf9aeb5783ab6a
xzjar=xz-1.11.jar
xzsha=0a4077f6aeae2865532a564807af8d30c26acc6f63b7928d93bd7ab1f2190449
cache="$PWD/.cache/audio-ffprobe"
mkdir -p "$cache"
if [ ! -f "$cache/$archive" ] || ! printf '%s  %s\n' "$sha" "$cache/$archive" | sha256sum -c - >/dev/null 2>&1; then
  rm -f "$cache/$archive"
  curl --fail --location --retry 2 "https://github.com/FFmpeg-Builds/FFmpeg-Builds/releases/download/autobuild-2026-11-11-12-39/$archive" -o "$cache/$archive"
fi
printf '%s  %s\n' "$sha" "$cache/$archive" | sha256sum -c -
if [ ! -f "$cache/$xzjar" ] || ! printf '%s  %s\n' "$xzsha" "$cache/$xzjar" | sha256sum -c - >/dev/null 2>&1; then
  rm -f "$cache/$xzjar"
  curl --fail --location --retry 2 "https://repo.maven.apache.org/maven2/org/tukaani/xz/1.11/$xzjar" -o "$cache/$xzjar"
fi
printf '%s  %s\n' "$xzsha" "$cache/$xzjar" | sha256sum -c -
tarfile="$cache/audio-probe.tar"
trap 'rm -f "$tarfile"' EXIT
java --class-path "$cache/$xzjar" ./scripts/ExtractAudioProbe.java "$cache/$archive" "$tarfile"
if [ "${PREPARE_AUDIO_FFMPEG:-false}" = true ]; then
  tar -xf "$tarfile" -C "$cache" --wildcards '*/bin/ffprobe' '*/bin/ffmpeg'
  AUDIO_FFMPEG_PATH="$cache/ffmpeg-n8.1.3-35-gf1acb0a266-linux64-lgpl-8.1/bin/ffmpeg"
  export AUDIO_FFMPEG_PATH
else
  tar -xf "$tarfile" -C "$cache" --wildcards '*/bin/ffprobe'
fi
rm -f "$tarfile"
trap - EXIT
AUDIO_FFPROBE_PATH="$cache/ffmpeg-n8.1.3-35-gf1acb0a266-linux64-lgpl-8.1/bin/ffprobe"
export AUDIO_FFPROBE_PATH
"$AUDIO_FFPROBE_PATH" -version >/dev/null
