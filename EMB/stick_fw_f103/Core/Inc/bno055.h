/*
 * bno055.h - BNO055 I2C 드라이버 (STM32 HAL)
 *
 * 단위 (UNIT_SEL = 0x00 기준)
 *   가속도  : 1 m/s^2 = 100 LSB
 *   자이로  : 1 dps   = 16 LSB
 *   오일러  : 1 deg   = 16 LSB
 *   쿼터니언: 1.0     = 16384 LSB
 */
#ifndef BNO055_H
#define BNO055_H

#include "stm32f1xx_hal.h"
#include <stdint.h>

#define BNO055_ADDR_DEFAULT   0x28   /* ADR 핀 LOW (Adafruit 기본) */
#define BNO055_CHIP_ID_VALUE  0xA0

/* Page 0 */
#define BNO055_REG_CHIP_ID      0x00
#define BNO055_REG_PAGE_ID      0x07
#define BNO055_REG_ACC_DATA     0x08   /* 0x08~0x0D, 이어서 MAG 0x0E~0x13, GYR 0x14~0x19 */
#define BNO055_REG_MAG_DATA     0x0E
#define BNO055_REG_GYR_DATA     0x14
#define BNO055_REG_EUL_DATA     0x1A   /* heading, roll, pitch */
#define BNO055_REG_QUA_DATA     0x20   /* w, x, y, z */
#define BNO055_REG_CALIB_STAT   0x35
#define BNO055_REG_ST_RESULT    0x36
#define BNO055_REG_SYS_STATUS   0x39
#define BNO055_REG_SYS_ERR      0x3A
#define BNO055_REG_UNIT_SEL     0x3B
#define BNO055_REG_OPR_MODE     0x3D
#define BNO055_REG_PWR_MODE     0x3E
#define BNO055_REG_SYS_TRIGGER  0x3F
#define BNO055_REG_OFFSETS      0x55   /* 0x55~0x6A, 22 bytes */

/* Page 1 (CONFIG 모드 + 비퓨전 모드에서만 의미 있음) */
#define BNO055_REG_ACC_CONFIG   0x08
#define BNO055_REG_GYR_CONFIG0  0x0A
#define BNO055_REG_GYR_CONFIG1  0x0B

#define BNO055_OFFSETS_LEN      22

typedef enum {
    BNO055_MODE_CONFIG   = 0x00,
    BNO055_MODE_ACCGYRO  = 0x05,
    BNO055_MODE_AMG      = 0x07,
    BNO055_MODE_IMU      = 0x08,   /* 퓨전: 가속도+자이로 (지자기 없음) */
    BNO055_MODE_NDOF     = 0x0C,   /* 퓨전: 9축 */
} bno055_mode_t;

typedef struct {
    int16_t x, y, z;
} bno055_vec3_t;

typedef struct {
    int16_t w, x, y, z;
} bno055_quat_t;

typedef struct {
    uint8_t sys, gyr, acc, mag;   /* 각 0~3, 3이 완료 */
} bno055_calib_t;

typedef struct {
    I2C_HandleTypeDef *hi2c;
    uint16_t addr;                /* HAL용 8bit 주소 (7bit << 1) */
    bno055_mode_t mode;
} bno055_t;

/* 초기화: 리셋 → 외부 크리스탈 → 단위 설정 → 셀프테스트 확인. 끝나면 CONFIG 모드 */
HAL_StatusTypeDef bno055_init(bno055_t *dev, I2C_HandleTypeDef *hi2c, uint8_t addr7);

HAL_StatusTypeDef bno055_set_mode(bno055_t *dev, bno055_mode_t mode);

/* AMG/ACCGYRO 모드용 고속 설정: 가속도 ±16g/1kHz BW, 자이로 2000dps/523Hz BW
 * CONFIG 모드에서 호출해야 함. 퓨전 모드로 바꾸면 BNO055가 덮어씀 */
HAL_StatusTypeDef bno055_config_fast(bno055_t *dev);

/* 0x08부터 18바이트 버스트: 가속도 + (지자기) + 자이로. mag는 NULL 가능 */
HAL_StatusTypeDef bno055_read_amg(bno055_t *dev, bno055_vec3_t *acc,
                                  bno055_vec3_t *mag, bno055_vec3_t *gyr);
HAL_StatusTypeDef bno055_read_gyro(bno055_t *dev, bno055_vec3_t *gyr);
/* 0x08부터 12바이트: 가속도 + 지자기 (주소가 붙어 있어 한 번에 읽음) */
HAL_StatusTypeDef bno055_read_acc_mag(bno055_t *dev, bno055_vec3_t *acc, bno055_vec3_t *mag);
/* 각각 6바이트 */
HAL_StatusTypeDef bno055_read_acc(bno055_t *dev, bno055_vec3_t *acc);
HAL_StatusTypeDef bno055_read_mag(bno055_t *dev, bno055_vec3_t *mag);

/* 퓨전 모드 전용. euler: x=heading, y=roll, z=pitch */
HAL_StatusTypeDef bno055_read_euler(bno055_t *dev, bno055_vec3_t *eul);
HAL_StatusTypeDef bno055_read_quat(bno055_t *dev, bno055_quat_t *q);

HAL_StatusTypeDef bno055_get_calib(bno055_t *dev, bno055_calib_t *c);

/* 캘리브레이션 오프셋 저장/복원. 내부에서 CONFIG 모드로 갔다가 원래 모드로 복귀 */
HAL_StatusTypeDef bno055_get_offsets(bno055_t *dev, uint8_t out[BNO055_OFFSETS_LEN]);
HAL_StatusTypeDef bno055_set_offsets(bno055_t *dev, const uint8_t in[BNO055_OFFSETS_LEN]);

#endif /* BNO055_H */
