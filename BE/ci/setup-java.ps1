$ErrorActionPreference = 'Stop'

# Runner의 시스템 Java와 무관하게 검증된 Temurin JDK 21을 작업 캐시에 준비한다.
$jdkCache = Join-Path $env:GRADLE_USER_HOME 'jdks/temurin-21.0.12.1-1'
$jdkHome = Join-Path $jdkCache 'jdk-21.0.12.1+1'
$javaExecutable = Join-Path $jdkHome 'bin/java.exe'

if (-not (Test-Path -LiteralPath $javaExecutable)) {
    New-Item -ItemType Directory -Path $jdkCache -Force | Out-Null
    $archive = Join-Path $jdkCache 'jdk.zip'
    $downloadUrl = 'https://github.com/adoptium/temurin21-binaries/releases/download/jdk-21.0.12.1%2B1/OpenJDK21U-jdk_x64_windows_hotspot_21.0.12.1_1.zip'
    $expectedHash = 'f9d6e191ab098c0d416e7d588a24420a8621cd2f4720dab2459b8b7b2d2d8b4e'

    Invoke-WebRequest -Uri $downloadUrl -OutFile $archive
    if ((Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash -ne $expectedHash) {
        throw 'JDK 배포 파일의 SHA-256 검증에 실패했습니다.'
    }
    Expand-Archive -LiteralPath $archive -DestinationPath $jdkCache -Force
    Remove-Item -LiteralPath $archive
}

if (-not (Test-Path -LiteralPath $javaExecutable)) {
    throw 'JDK 압축 해제 후 java.exe를 찾을 수 없습니다.'
}
$env:JAVA_HOME = $jdkHome
& $javaExecutable -version
if ($LASTEXITCODE -ne 0) {
    throw 'JDK 실행 확인에 실패했습니다.'
}
