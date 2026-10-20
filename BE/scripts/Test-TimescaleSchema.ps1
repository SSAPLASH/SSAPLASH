# 기존 서비스·볼륨에 접속하지 않고 일회용 TimescaleDB에서 실제 Flyway를 검증한다.
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$beRoot = Split-Path -Parent $PSScriptRoot
$composePath = Join-Path (Split-Path -Parent $beRoot) 'Infra/docker-compose.yml'
# 배포 이미지와 테스트 이미지의 버전이 어긋나지 않게 같은 선언을 사용한다.
$imageMatch = [regex]::Match([IO.File]::ReadAllText($composePath), '(?m)^\s+image:\s+(timescale/timescaledb:[^\s]+)\s*$')
if (-not $imageMatch.Success) { throw 'Infra Compose에서 TimescaleDB 이미지 선언을 찾지 못했습니다.' }
$image = $imageMatch.Groups[1].Value
$containerName = 'airdrum-timescale97-' + [guid]::NewGuid().ToString('N').Substring(0, 12)
$testPassword = [guid]::NewGuid().ToString('N')
$previousUrl = $env:TIMESCALE_TEST_URL
$previousPassword = $env:TIMESCALE_TEST_PASSWORD
$previousPgPassword = $env:POSTGRES_PASSWORD
$created = $false

function Invoke-DockerCheck {
    param([string[]] $Arguments)
    & docker @Arguments
    if ($LASTEXITCODE -ne 0) { throw "Docker $($Arguments[0]) 실패: 종료 코드 $LASTEXITCODE" }
}

function Invoke-DockerAllowFailure {
    param(
        [string[]] $Arguments,
        [switch] $Quiet
    )
    $previousErrorActionPreference = $ErrorActionPreference
    try {
        # PS5는 native command의 예상된 stderr도 Stop으로 올릴 수 있어 검사·재시도 구간에서만 완화한다.
        $ErrorActionPreference = 'Continue'
        if ($Quiet) {
            & docker @Arguments *> $null
        }
        else {
            & docker @Arguments | Out-Host
        }
        return $LASTEXITCODE
    }
    finally {
        $ErrorActionPreference = $previousErrorActionPreference
    }
}

try {
    Invoke-DockerCheck -Arguments @('info', '--format', '{{.ServerVersion}}') | Out-Null
    # 고정 버전이 있으면 재사용한다. 최초 pull의 일시적인 CDN EOF만 제한적으로 재시도한다.
    $imageInspectExitCode = Invoke-DockerAllowFailure -Arguments @('image', 'inspect', $image) -Quiet
    if ($imageInspectExitCode -ne 0) {
        $pulled = $false
        for ($pullAttempt = 1; $pullAttempt -le 3; $pullAttempt++) {
            $pullExitCode = Invoke-DockerAllowFailure -Arguments @('pull', $image)
            if ($pullExitCode -eq 0) { $pulled = $true; break }
            if ($pullAttempt -lt 3) { Start-Sleep -Seconds (2 * $pullAttempt) }
        }
        if (-not $pulled) { throw "TimescaleDB 이미지 다운로드가 3회 실패했습니다: $image" }
    }
    $env:POSTGRES_PASSWORD = $testPassword
    # 임시 데이터는 메모리에만 보관한다. 호스트의 기존 볼륨·DB 포트를 재사용하지 않는다.
    Invoke-DockerCheck -Arguments @(
        'run', '--detach', '--rm', '--name', $containerName,
        '--memory=1g', '--publish', '127.0.0.1::5432',
        '--mount', 'type=tmpfs,destination=/var/lib/postgresql/data',
        '--env', 'POSTGRES_PASSWORD', '--env', 'POSTGRES_DB=timescale_test',
        $image, 'postgres', '-c', 'shared_preload_libraries=timescaledb'
    ) | Out-Null
    $created = $true
    $ready = $false
    for ($attempt = 0; $attempt -lt 45; $attempt++) {
        # initdb 중 임시 소켓 서버가 아닌 실제 TCP 서버의 준비를 확인한다.
        $readyExitCode = Invoke-DockerAllowFailure -Arguments @('exec', $containerName, 'pg_isready', '-h', '127.0.0.1', '-U', 'postgres', '-d', 'timescale_test') -Quiet
        if ($readyExitCode -eq 0) { $ready = $true; break }
        Start-Sleep -Seconds 1
    }
    if (-not $ready) { throw 'TimescaleDB가 45초 안에 준비되지 않았습니다.' }
    $binding = Invoke-DockerCheck -Arguments @('port', $containerName, '5432/tcp')
    if ($binding -notmatch '^127\.0\.0\.1:(\d+)$') { throw '전용 DB의 루프백 포트를 확인하지 못했습니다.' }
    $env:TIMESCALE_TEST_URL = "jdbc:postgresql://127.0.0.1:$($Matches[1])/timescale_test"
    $env:TIMESCALE_TEST_PASSWORD = $testPassword
    Push-Location $beRoot
    try {
        & .\gradlew.bat --no-daemon timescaleTest
        if ($LASTEXITCODE -ne 0) { throw "TimescaleDB 검증 실패: 종료 코드 $LASTEXITCODE" }
    }
    finally { Pop-Location }
}
finally {
    $env:TIMESCALE_TEST_URL = $previousUrl
    $env:TIMESCALE_TEST_PASSWORD = $previousPassword
    $env:POSTGRES_PASSWORD = $previousPgPassword
    if ($created) {
        # 이 실행에서 만든 컨테이너만 종료한다. tmpfs 데이터는 함께 사라진다.
        Invoke-DockerCheck -Arguments @('stop', '--time', '5', $containerName) | Out-Null
    }
}
