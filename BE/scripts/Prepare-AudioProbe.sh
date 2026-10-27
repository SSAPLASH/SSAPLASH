#!/bin/sh
# CI 일반 사용자로 실행한다. 고정 릴리즈와 해제 도구를 SHA-256 검증한다.
set -eu
archive=ffmpeg-n8.1.3-24-g92611900bb-linux64-lgpl-8.1.tar.xz
sha=a816e76a32abd1fb75fdef65e6a9ca2efdfebc0ee55ace1c27367a60d1f8658f
xzjar=xz-1.11.jar
xzsha=0a4077f6aeae2865532a564807af8d30c26acc6f63b7928d93bd7ab1f2190449
cache="$PWD/.cache/audio-ffprobe"
mkdir -p "$cache"
if [ ! -f "$cache/$archive" ] || ! printf '%s  %s\n' "$sha" "$cache/$archive" | sha256sum -c - >/dev/null 2>&1; then
  rm -f "$cache/$archive"
  curl --fail --location --retry 2 "https://github.com/BtbN/FFmpeg-Builds/releases/download/autobuild-2026-10-25-13-00/$archive" -o "$cache/$archive"
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
tar -xf "$tarfile" -C "$cache" --wildcards '*/bin/ffprobe'
rm -f "$tarfile"
trap - EXIT
AUDIO_FFPROBE_PATH="$cache/ffmpeg-n8.1.3-24-g92611900bb-linux64-lgpl-8.1/bin/ffprobe"
export AUDIO_FFPROBE_PATH
"$AUDIO_FFPROBE_PATH" -version >/dev/null
