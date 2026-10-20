# 실제 V1·V2 SQL 검증용. 실제 서비스 DB·볼륨·네트워크를 사용하지 않는다.
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$beRoot = Split-Path -Parent $PSScriptRoot
$userMigrationFile = Join-Path $beRoot 'src/main/resources/db/migration/V1__create_users_social_accounts.sql'
$migrationFile = Join-Path $beRoot 'src/main/resources/db/migration/V2__create_songs_charts_chart_versions.sql'
$verificationFile = Join-Path $beRoot 'src/test/resources/db/chart-schema-test.sql'
$containerName = 'airdrum-chart94-check-' + [guid]::NewGuid().ToString('N').Substring(0, 12)
$containerCreated = $false

function Invoke-CheckDocker {
    param([string[]] $DockerArguments)
    & docker @DockerArguments
    if ($LASTEXITCODE -ne 0) {
        throw "Docker 검증 명령 실패: $($DockerArguments[0]) (종료 코드 $LASTEXITCODE)"
    }
}

if (-not (Test-Path -LiteralPath $userMigrationFile) -or -not (Test-Path -LiteralPath $migrationFile) -or -not (Test-Path -LiteralPath $verificationFile)) {
    throw '마이그레이션 또는 검증 SQL 파일이 없습니다.'
}
& docker image inspect postgres:16 --format '{{.Id}}' *> $null
if ($LASTEXITCODE -ne 0) {
    throw 'postgres:16 이미지와 실행 중인 Docker 엔진이 필요합니다. docker pull postgres:16 후 재실행하세요.'
}

try {
    # 외부 포트·네트워크·호스트 마운트가 없는 일회용 DB다. 로컬 소켓만 쓰므로 테스트 전용 trust를 사용한다.
    Invoke-CheckDocker -DockerArguments @(
        'run', '--detach', '--rm', '--pull=never', '--network=none',
        '--name', $containerName, '--env', 'POSTGRES_HOST_AUTH_METHOD=trust',
        '--env', 'POSTGRES_DB=chart94', 'postgres:16'
    ) | Out-Null
    $containerCreated = $true

    $ready = $false
    for ($attempt = 0; $attempt -lt 30; $attempt++) {
        & docker exec $containerName pg_isready -U postgres -d chart94 *> $null
        if ($LASTEXITCODE -eq 0) { $ready = $true; break }
        Start-Sleep -Seconds 1
    }
    if (-not $ready) { throw '전용 PostgreSQL이 30초 안에 준비되지 않았습니다.' }

    Invoke-CheckDocker -DockerArguments @('cp', $userMigrationFile, "${containerName}:/tmp/chart94-users.sql")
    Invoke-CheckDocker -DockerArguments @('cp', $migrationFile, "${containerName}:/tmp/chart94-migration.sql")
    Invoke-CheckDocker -DockerArguments @('cp', $verificationFile, "${containerName}:/tmp/chart94-test.sql")
    Invoke-CheckDocker -DockerArguments @(
        'exec', $containerName, 'psql', '-X', '-U', 'postgres', '-d', 'chart94',
        '--set=ON_ERROR_STOP=1', '--single-transaction',
        '--file=/tmp/chart94-users.sql', '--file=/tmp/chart94-migration.sql', '--file=/tmp/chart94-test.sql'
    )
}
finally {
    if ($containerCreated) {
        # 이 실행에서 만든 고유 이름의 컨테이너만 종료한다. --rm으로 전용 볼륨도 함께 정리된다.
        & docker stop --time 5 $containerName | Out-Null
        if ($LASTEXITCODE -ne 0) {
            throw "검증 컨테이너 정리에 실패했습니다: $containerName"
        }
    }
}
