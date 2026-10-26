/*
 * app_imu_test.c - BNO055 동작 확인 및 실측 (S15P31A307-114)
 *
 * main.c에서
 *   USER CODE 2      : app_imu_test_init();
 *   USER CODE 3 루프 : app_imu_test_loop();
 *
 * TEST_MODE
 *   TEST_RATE  : AMG 모드에서 연속 읽기 속도 측정 (원인 분석용 실험)
 *   TEST_MIXED : 실전 구조 검증 - 고정 주기로 자이로 읽기 + N번에 한 번 가속도·지자기,
 *                부팅 시 자이로 바이어스 보정
 *   TEST_FUSION: NDOF 모드에서 오일러 각도와 캘리브레이션 상태, 오프셋 출력
 *   TEST_CAPTURE: 타격 검출 튜닝용 스윙 녹화 (S15P31A307-116)
 *                4ms 주기 자이로 + 저속 가속도를 CSV로 출력. 시리얼 속도를 CAP_BAUD로 올린다
 *                파란 버튼(B1)을 누를 때마다 구간 번호(seg)가 1씩 올라간다
 *   TEST_HIT    : 타격 검출 + 패드 판정 실시간 확인 (S15P31A307-116, -117). 4ms 주기 자이로 → hit_detect,
 *                느릴 때만 가속도를 읽어 pose(스틱 방향) 보정, 타격 순간 방향으로 pad 판정.
 *                파란 버튼(B1) = 정면 보정(방위각 0) + 패드 캘리브레이션 시작.
 *                스틱을 정면으로 들고 누른 뒤, 안내대로 패드마다 CAL_HITS번씩 친다
 *                타격마다 PA8 토글(지연 측정용) + LED + 한 줄 출력. 921600 (115200이면 출력 중 샘플이 빠져 방위각이 밀림)
 *
 * TEST_RATE 실험 스위치
 *   USE_FAST_CONFIG : 1 = 자이로 523Hz/가속도 1kHz BW, 0 = BNO055 기본 대역폭
 *   READ_GYRO_ONLY  : 1 = 자이로 6바이트만, 0 = 가속도+지자기+자이로 18바이트
 *   I2C_TEST_SPEED  : 0 = CubeMX 설정 유지, 100000 등 = 그 속도로 재초기화
 *   READ_GAP_US     : 읽기 사이 쉬는 시간. 0이면 연속 읽기 (값이 멈출 수 있음)
 *
 * 실측 요약 (2026-10-20, NUCLEO-F103RB 72MHz, I2C 400kHz)
 *   18B 연속   : 4.6~5.7ms/회, 켤 때마다 값이 멈추는 경우 있음
 *   18B + 갭   : 5.8ms/회, 정상
 *   기본 대역폭: 3.65ms/회 (18B)
 *   자이로 6B  : 2.7ms/회, 약 370Hz
 *   100kHz     : 18B 4.6ms/회로 400kHz와 같음 -> 병목은 버스가 아니라 BNO055 내부
 */
#include "app_imu_test.h"
#include "main.h"
#include "bno055.h"
#include "dwt_timer.h"
#include "hit_detect.h"
#include "pose.h"
#include "pad.h"
#include <stdio.h>
#include <string.h>

#define TEST_RATE    1
#define TEST_MIXED   2
#define TEST_FUSION  3
#define TEST_CAPTURE 4
#define TEST_HIT     5
#define TEST_MODE    TEST_HIT

/* TEST_RATE 스위치 (기본값 = 현재 베스트) */
#define USE_FAST_CONFIG   1
#define READ_GYRO_ONLY    1
#define I2C_TEST_SPEED    0
#define READ_GAP_US       1300

/* TEST_MIXED 설정 */
#define MIX_PERIOD_US     4000  /* 자이로 읽기 주기 (4ms = 250Hz, 5000 = 200Hz) */
#define MIX_SLOW_DIV      10    /* N칸마다 가속도·지자기 */
#define MIX_SPLIT         1     /* 1 = 가속도(0번 칸)와 지자기(N/2번 칸)를 나눠 읽기
                                   0 = 0번 칸에서 12바이트 한 번에 */
#define BIAS_SAMPLES      250   /* 바이어스 측정 샘플 수 (약 1초) */
#define BIAS_STILL_SD_LSB 128   /* 축별 표준편차가 이보다 크면 움직인 것 (128 LSB = 8dps)
                                   실측: 책상 위 정지 상태 sd 3.3~4.7dps (523Hz BW) */

/* TEST_CAPTURE 설정 */
#define CAP_PERIOD_US     4000    /* 자이로 샘플 주기 (4ms = 250Hz) */
#define CAP_ACC_DIV       5       /* N칸마다 가속도 (5 = 50Hz, 25 = 10Hz). 0이면 가속도 안 읽음 */
#define CAP_BAUD          921600  /* 녹화 중 시리얼 속도. 안 되면 460800 */

/* TEST_HIT 설정 */
#define HIT_PERIOD_US     4000    /* 자이로 샘플 주기 */
#define HIT_AXIS          0       /* 스윙 축: 0=x 1=y 2=z (2026-10-21 부착 기준 x) */
#define HIT_SIGN          (-1)    /* 아래로 칠 때 축 값이 -면 -1 */
#define HIT_ACC_DIV       5       /* N칸마다 가속도 (자세 보정용). 스윙 중(각속도 큼)에는 건너뜀 */
#define HIT_ACC_MAX_DPS   200     /* 각속도가 이보다 크면 가속도를 읽지 않음 → 타격 직전 간격 일정 */
#define HIT_TIP_AXIS      {0.0f, 0.0f, 1.0f}   /* 스틱 끝 방향 = 센서 +z (2026-10-22 녹화로 확인) */
#define HIT_MARGIN_AMBIG  10      /* margin(도)이 이보다 작으면 판정 애매 표시 '?' (프로토콜 flags 비트 4) */
#define CAL_HITS          2       /* 캘리브레이션 때 패드당 타격 수 (FE PLAY-004와 같은 2타) */
/* 캘리브레이션 순서: HIHAT → SMALL_TOM → SNARE → FLOOR_TOM (패드 번호는 pad.h, 프로토콜 v0.7) */
static const uint8_t cal_order[] = { 1, 3, 2, 5 };
#define CAL_PADS          (sizeof cal_order / sizeof cal_order[0])

#define ERR_RECOVER_COUNT 3     /* 연속 에러가 이만큼 나면 버스 복구 */

extern I2C_HandleTypeDef hi2c1;

static bno055_t imu;
static int ready = 0;
#if TEST_MODE == TEST_HIT
static hit_detector_t hitd;
static pose_t pose;
static pad_table_t pads;
static volatile uint32_t yaw_reset_req = 0;

/* 파란 버튼 B1 = 정면 보정 요청. 계산은 루프에서 (인터럽트에서 float 연산 안 함) */
void HAL_GPIO_EXTI_Callback(uint16_t pin)
{
    static uint32_t last = 0;
    if (pin != B1_Pin) return;
    uint32_t now = HAL_GetTick();
    if (now - last < 300) return;
    last = now;
    yaw_reset_req++;
}
#endif

/* ------------------------------------------------------------------ */
/* I2C 버스 복구
 * STM32F1 I2C는 통신 중 접촉 불량 등으로 한 번 꼬이면 BUSY에 걸려
 * 다시 초기화하기 전까지 계속 실패한다. 또 STM32만 리셋되면 BNO055가
 * 읽기 도중 상태로 SDA를 잡고 있을 수 있다. SCL을 최대 9번 직접 토글해
 * 풀어주고 STOP을 만든 뒤 재초기화한다. */

#define I2C_SCL_PIN  GPIO_PIN_8
#define I2C_SDA_PIN  GPIO_PIN_9
#define I2C_PORT     GPIOB

static void delay_us(uint32_t us)
{
    uint32_t t0 = dwt_now();
    while (dwt_elapsed_us(t0) < us) { }
}

static void i2c1_bus_recover(void)
{
    GPIO_InitTypeDef g = {0};

    HAL_I2C_DeInit(&hi2c1);

    __HAL_RCC_GPIOB_CLK_ENABLE();
    HAL_GPIO_WritePin(I2C_PORT, I2C_SCL_PIN | I2C_SDA_PIN, GPIO_PIN_SET);
    g.Pin   = I2C_SCL_PIN | I2C_SDA_PIN;
    g.Mode  = GPIO_MODE_OUTPUT_OD;
    g.Pull  = GPIO_NOPULL;
    g.Speed = GPIO_SPEED_FREQ_HIGH;
    HAL_GPIO_Init(I2C_PORT, &g);
    delay_us(10);

    for (int i = 0; i < 9; i++) {
        if (HAL_GPIO_ReadPin(I2C_PORT, I2C_SDA_PIN) == GPIO_PIN_SET) break;
        HAL_GPIO_WritePin(I2C_PORT, I2C_SCL_PIN, GPIO_PIN_RESET); delay_us(5);
        HAL_GPIO_WritePin(I2C_PORT, I2C_SCL_PIN, GPIO_PIN_SET);   delay_us(5);
    }

    /* STOP: SCL HIGH 상태에서 SDA LOW -> HIGH */
    HAL_GPIO_WritePin(I2C_PORT, I2C_SDA_PIN, GPIO_PIN_RESET); delay_us(5);
    HAL_GPIO_WritePin(I2C_PORT, I2C_SCL_PIN, GPIO_PIN_SET);   delay_us(5);
    HAL_GPIO_WritePin(I2C_PORT, I2C_SDA_PIN, GPIO_PIN_SET);   delay_us(5);

    HAL_GPIO_DeInit(I2C_PORT, I2C_SCL_PIN | I2C_SDA_PIN);

    __HAL_RCC_I2C1_CLK_ENABLE();
    hi2c1.Instance->CR1 |= I2C_CR1_SWRST;
    hi2c1.Instance->CR1 &= ~I2C_CR1_SWRST;
    HAL_I2C_Init(&hi2c1);
}

/* 연속 에러 시 복구. 호출 쪽에서 매 읽기 결과를 넘긴다 */
static uint32_t n_recover = 0;
static void track_error(HAL_StatusTypeDef st)
{
    static uint32_t streak = 0;
    if (st == HAL_OK) { streak = 0; return; }
    if (++streak >= ERR_RECOVER_COUNT) {
        i2c1_bus_recover();
        n_recover++;
        streak = 0;
    }
}

/* ------------------------------------------------------------------ */
#if TEST_MODE == TEST_MIXED || TEST_MODE == TEST_HIT

static bno055_vec3_t gyro_bias;

/* 정수 제곱근 (표준편차 출력용) */
static uint32_t isqrt(uint64_t v)
{
    uint64_t r = 0, bit = (uint64_t)1 << 62;
    while (bit > v) bit >>= 2;
    while (bit) {
        if (v >= r + bit) { v -= r + bit; r = (r >> 1) + bit; }
        else r >>= 1;
        bit >>= 2;
    }
    return (uint32_t)r;
}

/* 가만히 있는 동안 자이로 평균 = 바이어스.
 * 움직임 판단은 (최대-최소) 대신 표준편차로 한다. 최대-최소는 튀는 샘플
 * 하나에도 크게 흔들려서, 가만히 있어도 실패하기 쉽다. 최대 3번 재시도 */
static int measure_gyro_bias(void)
{
    for (int attempt = 1; attempt <= 3; attempt++) {
        int64_t sum[3] = {0}, sq[3] = {0};
        int16_t mn[3] = {32767, 32767, 32767}, mx[3] = {-32768, -32768, -32768};
        int n = 0;

        printf("[BIAS] keep the board still on the desk... (try %d)\r\n", attempt);
        HAL_Delay(500);

        while (n < BIAS_SAMPLES) {
            bno055_vec3_t g;
            HAL_StatusTypeDef st = bno055_read_gyro(&imu, &g);
            track_error(st);
            if (st == HAL_OK) {
                int16_t v[3] = { g.x, g.y, g.z };
                for (int k = 0; k < 3; k++) {
                    sum[k] += v[k];
                    sq[k]  += (int32_t)v[k] * v[k];
                    if (v[k] < mn[k]) mn[k] = v[k];
                    if (v[k] > mx[k]) mx[k] = v[k];
                }
                n++;
            }
            delay_us(1300);
        }

        uint32_t sd[3];
        int moved = 0;
        for (int k = 0; k < 3; k++) {
            int64_t mean = sum[k] / n;
            int64_t var  = sq[k] / n - mean * mean;
            sd[k] = isqrt(var > 0 ? (uint64_t)var : 0);
            if (sd[k] > BIAS_STILL_SD_LSB) moved = 1;
        }

        /* 1 dps = 16 LSB -> 0.1dps = LSB*10/16 */
        printf("[BIAS] sd x=%lu y=%lu z=%lu  range x=%d y=%d z=%d [0.1dps]\r\n",
               sd[0] * 10 / 16, sd[1] * 10 / 16, sd[2] * 10 / 16,
               (mx[0] - mn[0]) * 10 / 16, (mx[1] - mn[1]) * 10 / 16, (mx[2] - mn[2]) * 10 / 16);

        if (!moved) {
            gyro_bias.x = (int16_t)(sum[0] / n);
            gyro_bias.y = (int16_t)(sum[1] / n);
            gyro_bias.z = (int16_t)(sum[2] / n);
            printf("[BIAS] OK  x=%d y=%d z=%d [0.1dps]\r\n",
                   gyro_bias.x * 10 / 16, gyro_bias.y * 10 / 16, gyro_bias.z * 10 / 16);
            return 1;
        }
        printf("[BIAS] moved, retry\r\n");
    }
    printf("[BIAS] FAIL - using zero bias\r\n");
    memset(&gyro_bias, 0, sizeof gyro_bias);
    return 0;
}

#endif

/* ------------------------------------------------------------------ */
#if TEST_MODE == TEST_CAPTURE || TEST_MODE == TEST_HIT

extern UART_HandleTypeDef huart2;

static void capture_set_baud(void)
{
    HAL_Delay(5);                       /* 이전 출력이 다 나가도록 */
    HAL_UART_DeInit(&huart2);
    huart2.Init.BaudRate = CAP_BAUD;
    HAL_UART_Init(&huart2);
}
#endif

#if TEST_MODE == TEST_CAPTURE

static volatile uint32_t seg_req = 0;   /* 버튼 누른 횟수 (인터럽트에서 증가) */

static void capture_header(HAL_StatusTypeDef cfg)
{
    printf("# capture: gyro every %lu us, acc every %d slots, baud %lu, fast config %s\r\n",
           (uint32_t)CAP_PERIOD_US, CAP_ACC_DIV, (uint32_t)CAP_BAUD, cfg == HAL_OK ? "OK" : "FAIL");
    printf("# units: gyro 16 LSB = 1 dps, acc 100 LSB = 1 m/s2 (raw, no bias). press B1 = next seg\r\n");
    printf("t_us,seg,gx,gy,gz,ax,ay,az\r\n");
}

/* 파란 버튼 B1 (PC13 EXTI). 300ms 안의 반복 입력은 무시 */
void HAL_GPIO_EXTI_Callback(uint16_t pin)
{
    static uint32_t last = 0;
    if (pin != B1_Pin) return;
    uint32_t now = HAL_GetTick();
    if (now - last < 300) return;
    last = now;
    seg_req++;
}

#endif

/* ------------------------------------------------------------------ */

void app_imu_test_init(void)
{
    dwt_init();
#if TEST_MODE == TEST_CAPTURE || TEST_MODE == TEST_HIT
    capture_set_baud();     /* 여기부터 CAP_BAUD(921600). 이전에 찍힌 "boot"는 깨져 보일 수 있다
                               TEST_HIT도 115200이면 타격 한 줄 출력에 약 7ms가 걸려 샘플이 빠지고,
                               빠진 구간의 회전이 자세 적분에서 사라져 방위각이 밀린다 (2026-10-22 확인) */
#endif
    i2c1_bus_recover();

#if I2C_TEST_SPEED
    HAL_I2C_DeInit(&hi2c1);
    hi2c1.Init.ClockSpeed = I2C_TEST_SPEED;
    HAL_I2C_Init(&hi2c1);
    printf("[IMU] I2C speed %lu Hz\r\n", (uint32_t)I2C_TEST_SPEED);
#endif

    HAL_StatusTypeDef st = bno055_init(&imu, &hi2c1, BNO055_ADDR_DEFAULT);
    if (st != HAL_OK) {
        printf("[IMU] init FAIL (%d) - check wiring, addr 0x28, power\r\n", st);
        return;
    }
    printf("[IMU] init OK\r\n");

#if TEST_MODE == TEST_RATE
  #if USE_FAST_CONFIG
    st = bno055_config_fast(&imu);
    printf("[IMU] fast config %s (acc 1kHz BW, gyro 523Hz BW)\r\n", st == HAL_OK ? "OK" : "FAIL");
  #else
    printf("[IMU] default bandwidth\r\n");
  #endif
    bno055_set_mode(&imu, BNO055_MODE_AMG);
    printf("[IMU] mode AMG, read %s, gap %lu us\r\n",
           READ_GYRO_ONLY ? "gyro 6B" : "amg 18B", (uint32_t)READ_GAP_US);
    printf("reads/s, new/s, read_avg_us, read_max_us, gx gy gz [0.1dps], err, rec\r\n");

#elif TEST_MODE == TEST_MIXED
    st = bno055_config_fast(&imu);
    printf("[IMU] fast config %s\r\n", st == HAL_OK ? "OK" : "FAIL");
    bno055_set_mode(&imu, BNO055_MODE_AMG);
    printf("[IMU] MIXED: gyro every %lu us, acc/mag every %d slots, %s\r\n",
           (uint32_t)MIX_PERIOD_US, MIX_SLOW_DIV,
           MIX_SPLIT ? "split (acc slot 0, mag slot N/2)" : "acc+mag 12B together");
    measure_gyro_bias();
    printf("slots/s, intv_min/avg/max_us, busy_avg/max_us, late_max_us, drop, err, rec | "
           "g[0.1dps] a[0.1m/s2] m[uT]\r\n");

#elif TEST_MODE == TEST_CAPTURE
    st = bno055_config_fast(&imu);
    bno055_set_mode(&imu, BNO055_MODE_AMG);
    capture_header(st);

#elif TEST_MODE == TEST_HIT
    st = bno055_config_fast(&imu);
    bno055_set_mode(&imu, BNO055_MODE_AMG);
    printf("[IMU] fast config %s\r\n", st == HAL_OK ? "OK" : "FAIL");
    if (!measure_gyro_bias()) {
        /* 책상에 두지 못했으면 116 실측값 사용 (-0.35, -0.40, +0.09 dps) */
        gyro_bias.x = -6; gyro_bias.y = -6; gyro_bias.z = 1;
        printf("[BIAS] using default\r\n");
    }
    {
        static const float tip[3] = HIT_TIP_AXIS;
        bno055_vec3_t a;
        pose_init(&pose, tip);
        if (bno055_read_acc(&imu, &a) == HAL_OK) {
            float am[3] = { a.x / 100.0f, a.y / 100.0f, a.z / 100.0f };
            pose_start(&pose, am);
        }
        pad_table_default(&pads);
        printf("[POSE] tip +z. hold the stick to the front and press B1 to zero the azimuth\r\n");
    }
    {
        hit_params_t hp;
        hit_default_params(&hp);
        hit_init(&hitd, &hp);
        printf("[HIT] start %d dps, brake %u%%, minPeak %d dps, minDecel %u.%u dps/ms\r\n",
               hp.swing_start_dps, hp.brake_pct, hp.min_peak_dps,
               hp.min_decel_x10 / 10, hp.min_decel_x10 % 10);
    }
    printf("#n t_hit_ms pad        el  az  mg peak vel | busy_us | rej w/s/l   (? = margin < %d deg)\r\n", HIT_MARGIN_AMBIG);

#else
    bno055_set_mode(&imu, BNO055_MODE_NDOF);
    printf("[IMU] mode NDOF\r\n");
    printf("heading roll pitch [0.1deg] | calib sys gyr acc mag\r\n");
#endif
    ready = 1;
}

/* ------------------------------------------------------------------ */
#if TEST_MODE == TEST_RATE

void app_imu_test_loop(void)
{
    static uint32_t win_start = 0;
    static uint32_t n_reads = 0, n_new = 0, n_err = 0;
    static uint32_t rd_sum = 0, rd_max = 0;
    static bno055_vec3_t pa, pg;
    bno055_vec3_t a = {0}, g;

    if (!ready) return;
    if (win_start == 0) win_start = dwt_now();

#if READ_GAP_US
    delay_us(READ_GAP_US);
#endif

    uint32_t t0 = dwt_now();
#if READ_GYRO_ONLY
    HAL_StatusTypeDef st = bno055_read_gyro(&imu, &g);
#else
    HAL_StatusTypeDef st = bno055_read_amg(&imu, &a, NULL, &g);
#endif
    uint32_t dt = dwt_elapsed_us(t0);
    track_error(st);

    if (st != HAL_OK) {
        n_err++;
    } else {
        n_reads++;
        rd_sum += dt;
        if (dt > rd_max) rd_max = dt;
        if (memcmp(&a, &pa, sizeof a) || memcmp(&g, &pg, sizeof g)) n_new++;
        pa = a; pg = g;
    }

    if (dwt_elapsed_us(win_start) >= 1000000U) {
        uint32_t avg = n_reads ? rd_sum / n_reads : 0;
        printf("%lu, %lu, %lu, %lu, %d %d %d, err=%lu, rec=%lu\r\n",
               n_reads, n_new, avg, rd_max,
               pg.x * 10 / 16, pg.y * 10 / 16, pg.z * 10 / 16, n_err, n_recover);
        n_reads = n_new = n_err = rd_sum = rd_max = 0;
        win_start = dwt_now();
    }
}

/* ------------------------------------------------------------------ */
#elif TEST_MODE == TEST_MIXED

/* 고정 주기 스케줄링
 * - next 시각까지 기다렸다가 자이로를 읽는다 (MIX_SLOW_DIV번째 칸엔 가속도·지자기 추가)
 * - intv : 실제로 읽기를 시작한 간격. 4000us에 가까울수록 좋음
 * - busy : 한 칸에서 읽기에 쓴 시간. 4000us를 넘으면 다음 칸을 침범
 * - late : 예정 시각보다 늦게 시작한 정도
 * - drop : 한 주기 이상 밀려서 칸을 건너뛴 횟수
 * 1초마다 출력(약 10ms 소요)한 직후 칸은 통계에서 뺀다 */
void app_imu_test_loop(void)
{
    static uint32_t next = 0, prev_t0 = 0, slot = 0, win_start = 0;
    static uint32_t n_slot = 0, n_err = 0, n_drop = 0;
    static uint32_t intv_min = 0xFFFFFFFF, intv_max = 0, intv_sum = 0, n_intv = 0;
    static uint32_t busy_sum = 0, busy_max = 0, late_max = 0;
    static bno055_vec3_t g = {0}, a = {0}, m = {0};

    const uint32_t period_cyc = MIX_PERIOD_US * (SystemCoreClock / 1000000U);

    if (!ready) return;
    if (next == 0) { next = dwt_now() + period_cyc; win_start = dwt_now(); }

    /* 다음 칸까지 대기 (랩어라운드 안전 비교) */
    while ((int32_t)(dwt_now() - next) < 0) { }

    uint32_t t0 = dwt_now();
    uint32_t late = (uint32_t)(t0 - next) / (SystemCoreClock / 1000000U);
    if (late > late_max) late_max = late;

    if (prev_t0) {
        uint32_t intv = (uint32_t)(t0 - prev_t0) / (SystemCoreClock / 1000000U);
        if (intv < intv_min) intv_min = intv;
        if (intv > intv_max) intv_max = intv;
        intv_sum += intv; n_intv++;
    }
    prev_t0 = t0;

    /* 읽기 */
    bno055_vec3_t graw;
    HAL_StatusTypeDef st = bno055_read_gyro(&imu, &graw);
    track_error(st);
    if (st == HAL_OK) {
        g.x = graw.x - gyro_bias.x;
        g.y = graw.y - gyro_bias.y;
        g.z = graw.z - gyro_bias.z;
    } else {
        n_err++;
    }

#if MIX_SPLIT
    if (slot % MIX_SLOW_DIV == 0) {
        st = bno055_read_acc(&imu, &a);
        track_error(st);
        if (st != HAL_OK) n_err++;
    } else if (slot % MIX_SLOW_DIV == MIX_SLOW_DIV / 2) {
        st = bno055_read_mag(&imu, &m);
        track_error(st);
        if (st != HAL_OK) n_err++;
    }
#else
    if (slot % MIX_SLOW_DIV == 0) {
        st = bno055_read_acc_mag(&imu, &a, &m);
        track_error(st);
        if (st != HAL_OK) n_err++;
    }
#endif
    slot++;
    n_slot++;

    uint32_t busy = dwt_elapsed_us(t0);
    busy_sum += busy;
    if (busy > busy_max) busy_max = busy;

    /* 다음 칸 예약.
     * 조금 늦은 건 늦은 대로 바로 시작하고(late에 기록),
     * 한 주기 이상 밀린 경우에만 칸을 건너뛴다(drop) */
    next += period_cyc;
    while ((int32_t)(dwt_now() - next) >= (int32_t)period_cyc) {
        next += period_cyc;
        n_drop++;
    }

    /* 1초마다 출력 */
    if (dwt_elapsed_us(win_start) >= 1000000U) {
        printf("%lu, %lu/%lu/%lu, %lu/%lu, %lu, drop=%lu, err=%lu, rec=%lu | "
               "g %d %d %d  a %d %d %d  m %d %d %d\r\n",
               n_slot,
               intv_min, n_intv ? intv_sum / n_intv : 0, intv_max,
               n_slot ? busy_sum / n_slot : 0, busy_max,
               late_max, n_drop, n_err, n_recover,
               g.x * 10 / 16, g.y * 10 / 16, g.z * 10 / 16,
               a.x / 10, a.y / 10, a.z / 10,      /* 1 m/s2 = 100 LSB -> 0.1 m/s2 */
               m.x / 16, m.y / 16, m.z / 16);     /* 1 uT = 16 LSB */

        n_slot = n_err = n_drop = 0;
        intv_min = 0xFFFFFFFF; intv_max = intv_sum = n_intv = 0;
        busy_sum = busy_max = late_max = 0;

        /* 출력에 쓴 시간은 통계에서 제외하고 스케줄 재시작 */
        prev_t0 = 0;
        next = dwt_now() + period_cyc;
        win_start = dwt_now();
    }
}

/* ------------------------------------------------------------------ */
#elif TEST_MODE == TEST_CAPTURE

/* 4ms마다 한 줄. 가속도 칸이 아니면 ax,ay,az는 빈칸
 * t_us는 녹화 시작부터 경과 µs (DWT 59초 랩어라운드를 누적으로 피함)
 * 한 주기 이상 밀리면 "# drop n", 읽기 실패는 "# err" 주석 줄 */
void app_imu_test_loop(void)
{
    static uint32_t next = 0, prev = 0, slot = 0, seg = 0;
    static uint64_t cyc_total = 0;
    const uint32_t cyc_per_us = SystemCoreClock / 1000000U;
    const uint32_t period_cyc = CAP_PERIOD_US * cyc_per_us;
    char line[72];

    if (!ready) return;
    if (next == 0) { next = dwt_now() + period_cyc; prev = dwt_now(); }

    while ((int32_t)(dwt_now() - next) < 0) { }

    uint32_t t0 = dwt_now();
    cyc_total += (uint32_t)(t0 - prev);
    prev = t0;
    uint32_t t_us = (uint32_t)(cyc_total / cyc_per_us);

    /* 버튼으로 구간 변경 */
    if (seg != seg_req) {
        seg = seg_req;
        HAL_GPIO_WritePin(LD2_GPIO_Port, LD2_Pin, (seg & 1) ? GPIO_PIN_SET : GPIO_PIN_RESET);
        int n = snprintf(line, sizeof line, "# seg %lu\r\n", seg);
        HAL_UART_Transmit(&huart2, (uint8_t *)line, (uint16_t)n, 10);
    }

    bno055_vec3_t g, a;
    HAL_StatusTypeDef st = bno055_read_gyro(&imu, &g);
    track_error(st);

    int with_acc = 0;
#if CAP_ACC_DIV
    if (st == HAL_OK && slot % CAP_ACC_DIV == 0) {
        HAL_StatusTypeDef sa = bno055_read_acc(&imu, &a);
        track_error(sa);
        with_acc = (sa == HAL_OK);
    }
#endif
    slot++;

    int n;
    if (st != HAL_OK) {
        n = snprintf(line, sizeof line, "# err %d rec %lu\r\n", st, n_recover);
    } else if (with_acc) {
        n = snprintf(line, sizeof line, "%lu,%lu,%d,%d,%d,%d,%d,%d\r\n",
                     t_us, seg, g.x, g.y, g.z, a.x, a.y, a.z);
    } else {
        n = snprintf(line, sizeof line, "%lu,%lu,%d,%d,%d,,,\r\n", t_us, seg, g.x, g.y, g.z);
    }
    HAL_UART_Transmit(&huart2, (uint8_t *)line, (uint16_t)n, 10);

    /* 다음 칸. 한 주기 이상 밀린 경우에만 건너뛰고 기록 */
    next += period_cyc;
    uint32_t drop = 0;
    while ((int32_t)(dwt_now() - next) >= (int32_t)period_cyc) { next += period_cyc; drop++; }
    if (drop) {
        n = snprintf(line, sizeof line, "# drop %lu\r\n", drop);
        HAL_UART_Transmit(&huart2, (uint8_t *)line, (uint16_t)n, 10);
    }
}

/* ------------------------------------------------------------------ */
#elif TEST_MODE == TEST_HIT

/* 4ms마다 자이로를 읽어 검출기와 자세 추정에 넣는다.
 * 가속도는 HIT_ACC_DIV칸마다, 각속도가 작을 때(스틱이 느릴 때)만 읽어 자세 기울기를 보정한다.
 * 스윙 중에는 원심력 때문에 가속도가 어차피 쓸모없고, 안 읽어야 타격 직전 샘플 간격이 일정하다.
 * 타격이면 PA8 토글 + LED 토글 + 한 줄 출력 (출력은 약 5ms 걸려 다음 칸이 조금 밀릴 수 있음) */
void app_imu_test_loop(void)
{
    static uint32_t next = 0, prev = 0, slot = 0, yaw_done = 0, busy_max = 0;
    static uint32_t t_prev_us = 0;
    static int moving_prev = 0;
    static int cal_step = -1;                 /* -1 = 캘리브레이션 안 함 */
    static int cal_count = 0;
    static pad_acc_t cal_acc;
    static pad_table_t cal_table;
    static uint64_t cyc_total = 0;
    const uint32_t cyc_per_us = SystemCoreClock / 1000000U;
    const uint32_t period_cyc = HIT_PERIOD_US * cyc_per_us;

    if (!ready) return;
    if (next == 0) { next = dwt_now() + period_cyc; prev = dwt_now(); }

    while ((int32_t)(dwt_now() - next) < 0) { }

    uint32_t t0 = dwt_now();
    cyc_total += (uint32_t)(t0 - prev);
    prev = t0;
    uint32_t t_us = (uint32_t)(cyc_total / cyc_per_us);

    bno055_vec3_t g;
    int printed = 0;
    HAL_StatusTypeDef st = bno055_read_gyro(&imu, &g);
    track_error(st);
    if (st == HAL_OK) {
        int16_t raw[3] = { (int16_t)(g.x - gyro_bias.x), (int16_t)(g.y - gyro_bias.y), (int16_t)(g.z - gyro_bias.z) };
        float gd[3] = { raw[0] / 16.0f, raw[1] / 16.0f, raw[2] / 16.0f };

        /* 느릴 때만 가속도 (직전 칸의 각속도로 판단) */
        float am[3], *ap = NULL;
        if (slot % HIT_ACC_DIV == 0 && !moving_prev) {
            bno055_vec3_t a;
            HAL_StatusTypeDef sa = bno055_read_acc(&imu, &a);
            track_error(sa);
            if (sa == HAL_OK) { am[0] = a.x / 100.0f; am[1] = a.y / 100.0f; am[2] = a.z / 100.0f; ap = am; }
        }
        moving_prev = (gd[0] * gd[0] + gd[1] * gd[1] + gd[2] * gd[2]) > (float)HIT_ACC_MAX_DPS * HIT_ACC_MAX_DPS;

        if (t_prev_us) pose_update(&pose, gd, ap, (t_us - t_prev_us) / 1e6f);
        t_prev_us = t_us;

        if (yaw_done != yaw_reset_req) {
            yaw_done = yaw_reset_req;
            pose_reset_yaw(&pose);
            float el, az; pose_angles(&pose, &el, &az);
            printf("[POSE] front set (elev %d)\r\n", (int)el);
            cal_step = 0; cal_count = 0;
            pad_acc_reset(&cal_acc);
            pad_table_clear(&cal_table);
            printf("[CAL] hit %s x%d\r\n", pad_name(cal_order[0]), CAL_HITS);
            printed = 1;
        }

        int32_t down = HIT_SIGN * (int32_t)raw[HIT_AXIS];
        hit_event_t ev;
        if (hit_update(&hitd, t_us, down, &ev)) {
            HAL_GPIO_TogglePin(GPIOA, GPIO_PIN_8);              /* 지연 측정 루프백용 */
            HAL_GPIO_TogglePin(LD2_GPIO_Port, LD2_Pin);
            float el, az; pose_angles(&pose, &el, &az);

            if (cal_step >= 0) {
                /* 캘리브레이션 중: 판정하지 않고 방향만 모은다 */
                uint8_t id = cal_order[cal_step];
                pad_acc_add(&cal_acc, el, az);
                printf("[CAL] %s %d/%d  el %d az %d\r\n", pad_name(id), ++cal_count, CAL_HITS, (int)el, (int)az);
                if (cal_count >= CAL_HITS) {
                    float me, ma;
                    if (pad_acc_mean(&cal_acc, &me, &ma)) pad_table_set(&cal_table, id, me, ma, 30.0f);
                    pad_acc_reset(&cal_acc);
                    cal_count = 0;
                    if (++cal_step >= (int)CAL_PADS) {
                        pad_table_autoradius(&cal_table);
                        pads = cal_table;
                        cal_step = -1;
                        printf("[CAL] done\r\n");
                        for (uint8_t i = 0; i < pads.n; i++)
                            printf("[CAL] %-9s el %4d az %4d r %2d\r\n", pad_name(pads.a[i].id),
                                   (int)pads.a[i].elev_deg, (int)pads.a[i].azim_deg, (int)pads.a[i].radius_deg);
                    } else {
                        printf("[CAL] hit %s x%d\r\n", pad_name(cal_order[cal_step]), CAL_HITS);
                    }
                }
                busy_max = 0;
                printed = 1;
                goto slot_end;
            }

            pad_result_t pr = pad_classify(&pads, el, az);
            uint32_t busy_now = dwt_elapsed_us(t0);              /* 출력 전까지 (출력 시간 제외) */
            if (busy_now > busy_max) busy_max = busy_now;
            printf("%2lu %8lu %-9s%c %3d %4d %3d %4u %3u | %5lu | %lu/%lu/%lu\r\n",
                   hitd.n_hits, ev.t_hit_us / 1000, pad_name(pr.id), pr.margin_deg < HIT_MARGIN_AMBIG ? '?' : ' ',
                   (int)el, (int)az, (int)pr.margin_deg, ev.peak_dps, ev.velocity, busy_max,
                   hitd.n_reject_weak, hitd.n_reject_slow, hitd.n_reject_long);
            busy_max = 0;
            printed = 1;
        }
    }
slot_end:
    slot++;

    if (!printed) {                                            /* 출력한 칸은 통계에서 제외 */
        uint32_t busy = dwt_elapsed_us(t0);
        if (busy > busy_max) busy_max = busy;
    }

    next += period_cyc;
    while ((int32_t)(dwt_now() - next) >= (int32_t)period_cyc) next += period_cyc;
}

/* ------------------------------------------------------------------ */
#else /* TEST_FUSION */

void app_imu_test_loop(void)
{
    bno055_vec3_t e;
    bno055_calib_t c;

    if (!ready) return;

    HAL_StatusTypeDef s1 = bno055_read_euler(&imu, &e);
    track_error(s1);
    HAL_StatusTypeDef s2 = (s1 == HAL_OK) ? bno055_get_calib(&imu, &c) : s1;
    if (s1 == HAL_OK) track_error(s2);

    if (s1 != HAL_OK || s2 != HAL_OK) {
        /* 예전엔 실패하면 아무것도 안 찍혀서 멈춘 것처럼 보였다 */
        printf("[IMU] read err (%d), rec=%lu\r\n", s1 != HAL_OK ? s1 : s2, n_recover);
    } else {
        printf("%5d %5d %5d | %u %u %u %u\r\n",
               e.x * 10 / 16, e.y * 10 / 16, e.z * 10 / 16,
               c.sys, c.gyr, c.acc, c.mag);

        static int saved = 0;
        if (!saved && c.sys == 3 && c.gyr == 3 && c.acc == 3 && c.mag == 3) {
            uint8_t off[BNO055_OFFSETS_LEN];
            if (bno055_get_offsets(&imu, off) == HAL_OK) {
                printf("[IMU] calib offsets:");
                for (int i = 0; i < BNO055_OFFSETS_LEN; i++) printf(" %02X", off[i]);
                printf("\r\n");
                saved = 1;
            }
        }
    }
    HAL_Delay(100);
}

#endif
