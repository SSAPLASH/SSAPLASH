/*
 * bno055.c - BNO055 I2C 드라이버 (STM32 HAL)
 */
#include "bno055.h"

#define I2C_TIMEOUT_MS   10

static HAL_StatusTypeDef wr(bno055_t *dev, uint8_t reg, uint8_t val)
{
    return HAL_I2C_Mem_Write(dev->hi2c, dev->addr, reg, I2C_MEMADD_SIZE_8BIT,
                             &val, 1, I2C_TIMEOUT_MS);
}

static HAL_StatusTypeDef rd(bno055_t *dev, uint8_t reg, uint8_t *buf, uint16_t len)
{
    return HAL_I2C_Mem_Read(dev->hi2c, dev->addr, reg, I2C_MEMADD_SIZE_8BIT,
                            buf, len, I2C_TIMEOUT_MS);
}

static inline int16_t le16(const uint8_t *p)
{
    return (int16_t)((uint16_t)p[0] | ((uint16_t)p[1] << 8));
}

static HAL_StatusTypeDef wait_chip_id(bno055_t *dev, uint32_t timeout_ms)
{
    uint32_t start = HAL_GetTick();
    uint8_t id = 0;
    while (HAL_GetTick() - start < timeout_ms) {
        if (rd(dev, BNO055_REG_CHIP_ID, &id, 1) == HAL_OK && id == BNO055_CHIP_ID_VALUE)
            return HAL_OK;
        HAL_Delay(10);
    }
    return HAL_TIMEOUT;
}

HAL_StatusTypeDef bno055_init(bno055_t *dev, I2C_HandleTypeDef *hi2c, uint8_t addr7)
{
    HAL_StatusTypeDef st;
    uint8_t v;

    dev->hi2c = hi2c;
    dev->addr = (uint16_t)(addr7 << 1);
    dev->mode = BNO055_MODE_CONFIG;

    /* 전원 인가 후 부팅 약 650ms */
    if ((st = wait_chip_id(dev, 1000)) != HAL_OK) return st;

    if ((st = wr(dev, BNO055_REG_OPR_MODE, BNO055_MODE_CONFIG)) != HAL_OK) return st;
    HAL_Delay(20);

    /* 소프트 리셋. 리셋 중에는 NACK이 나므로 chip id로 복귀 확인 */
    wr(dev, BNO055_REG_SYS_TRIGGER, 0x20);
    HAL_Delay(650);
    if ((st = wait_chip_id(dev, 1000)) != HAL_OK) return st;
    HAL_Delay(50);

    if ((st = wr(dev, BNO055_REG_PWR_MODE, 0x00)) != HAL_OK) return st;   /* normal */
    HAL_Delay(10);
    if ((st = wr(dev, BNO055_REG_PAGE_ID, 0x00)) != HAL_OK) return st;

    /* 외부 32kHz 크리스탈 사용 (Adafruit 2472에 실장됨) - 퓨전 정확도 향상 */
    if ((st = wr(dev, BNO055_REG_SYS_TRIGGER, 0x80)) != HAL_OK) return st;
    HAL_Delay(10);

    /* 단위: m/s^2, dps, deg, Windows 방향 규약 */
    if ((st = wr(dev, BNO055_REG_UNIT_SEL, 0x00)) != HAL_OK) return st;

    /* 셀프테스트: bit0 ACC, bit1 MAG, bit2 GYR, bit3 MCU -> 0x0F 정상 */
    if ((st = rd(dev, BNO055_REG_ST_RESULT, &v, 1)) != HAL_OK) return st;
    if ((v & 0x0F) != 0x0F) return HAL_ERROR;

    return HAL_OK;
}

HAL_StatusTypeDef bno055_set_mode(bno055_t *dev, bno055_mode_t mode)
{
    HAL_StatusTypeDef st = wr(dev, BNO055_REG_OPR_MODE, (uint8_t)mode);
    if (st != HAL_OK) return st;
    /* 데이터시트: 임의→CONFIG 19ms, CONFIG→임의 7ms */
    HAL_Delay(mode == BNO055_MODE_CONFIG ? 20 : 10);
    dev->mode = mode;
    return HAL_OK;
}

HAL_StatusTypeDef bno055_config_fast(bno055_t *dev)
{
    HAL_StatusTypeDef st;
    uint8_t v;

    if (dev->mode != BNO055_MODE_CONFIG) return HAL_ERROR;

    if ((st = wr(dev, BNO055_REG_PAGE_ID, 0x01)) != HAL_OK) return st;

    /* ACC_Config: [7:5] normal=000, [4:2] BW 1000Hz=111, [1:0] ±16g=11 */
    if ((st = wr(dev, BNO055_REG_ACC_CONFIG, 0x1F)) != HAL_OK) goto out;
    /* GYR_Config_0: [5:3] BW 523Hz=000, [2:0] 2000dps=000 (기본값 0x38은 32Hz라 느림) */
    if ((st = wr(dev, BNO055_REG_GYR_CONFIG0, 0x00)) != HAL_OK) goto out;
    /* GYR_Config_1: normal */
    if ((st = wr(dev, BNO055_REG_GYR_CONFIG1, 0x00)) != HAL_OK) goto out;

    /* 읽어서 확인 */
    if ((st = rd(dev, BNO055_REG_GYR_CONFIG0, &v, 1)) != HAL_OK) goto out;
    if (v != 0x00) st = HAL_ERROR;

out:
    wr(dev, BNO055_REG_PAGE_ID, 0x00);
    return st;
}

HAL_StatusTypeDef bno055_read_amg(bno055_t *dev, bno055_vec3_t *acc,
                                  bno055_vec3_t *mag, bno055_vec3_t *gyr)
{
    uint8_t b[18];
    HAL_StatusTypeDef st = rd(dev, BNO055_REG_ACC_DATA, b, sizeof b);
    if (st != HAL_OK) return st;

    if (acc) { acc->x = le16(&b[0]);  acc->y = le16(&b[2]);  acc->z = le16(&b[4]);  }
    if (mag) { mag->x = le16(&b[6]);  mag->y = le16(&b[8]);  mag->z = le16(&b[10]); }
    if (gyr) { gyr->x = le16(&b[12]); gyr->y = le16(&b[14]); gyr->z = le16(&b[16]); }
    return HAL_OK;
}

HAL_StatusTypeDef bno055_read_gyro(bno055_t *dev, bno055_vec3_t *gyr)
{
    uint8_t b[6];
    HAL_StatusTypeDef st = rd(dev, BNO055_REG_GYR_DATA, b, sizeof b);
    if (st != HAL_OK) return st;
    gyr->x = le16(&b[0]); gyr->y = le16(&b[2]); gyr->z = le16(&b[4]);
    return HAL_OK;
}

HAL_StatusTypeDef bno055_read_acc_mag(bno055_t *dev, bno055_vec3_t *acc, bno055_vec3_t *mag)
{
    uint8_t b[12];
    HAL_StatusTypeDef st = rd(dev, BNO055_REG_ACC_DATA, b, sizeof b);
    if (st != HAL_OK) return st;
    acc->x = le16(&b[0]); acc->y = le16(&b[2]); acc->z = le16(&b[4]);
    mag->x = le16(&b[6]); mag->y = le16(&b[8]); mag->z = le16(&b[10]);
    return HAL_OK;
}

static HAL_StatusTypeDef read_vec3(bno055_t *dev, uint8_t reg, bno055_vec3_t *v)
{
    uint8_t b[6];
    HAL_StatusTypeDef st = rd(dev, reg, b, sizeof b);
    if (st != HAL_OK) return st;
    v->x = le16(&b[0]); v->y = le16(&b[2]); v->z = le16(&b[4]);
    return HAL_OK;
}

HAL_StatusTypeDef bno055_read_acc(bno055_t *dev, bno055_vec3_t *acc)
{
    return read_vec3(dev, BNO055_REG_ACC_DATA, acc);
}

HAL_StatusTypeDef bno055_read_mag(bno055_t *dev, bno055_vec3_t *mag)
{
    return read_vec3(dev, BNO055_REG_MAG_DATA, mag);
}

HAL_StatusTypeDef bno055_read_euler(bno055_t *dev, bno055_vec3_t *eul)
{
    uint8_t b[6];
    HAL_StatusTypeDef st = rd(dev, BNO055_REG_EUL_DATA, b, sizeof b);
    if (st != HAL_OK) return st;
    eul->x = le16(&b[0]);   /* heading */
    eul->y = le16(&b[2]);   /* roll */
    eul->z = le16(&b[4]);   /* pitch */
    return HAL_OK;
}

HAL_StatusTypeDef bno055_read_quat(bno055_t *dev, bno055_quat_t *q)
{
    uint8_t b[8];
    HAL_StatusTypeDef st = rd(dev, BNO055_REG_QUA_DATA, b, sizeof b);
    if (st != HAL_OK) return st;
    q->w = le16(&b[0]); q->x = le16(&b[2]); q->y = le16(&b[4]); q->z = le16(&b[6]);
    return HAL_OK;
}

HAL_StatusTypeDef bno055_get_calib(bno055_t *dev, bno055_calib_t *c)
{
    uint8_t v;
    HAL_StatusTypeDef st = rd(dev, BNO055_REG_CALIB_STAT, &v, 1);
    if (st != HAL_OK) return st;
    c->sys = (v >> 6) & 0x03;
    c->gyr = (v >> 4) & 0x03;
    c->acc = (v >> 2) & 0x03;
    c->mag = v & 0x03;
    return HAL_OK;
}

HAL_StatusTypeDef bno055_get_offsets(bno055_t *dev, uint8_t out[BNO055_OFFSETS_LEN])
{
    bno055_mode_t prev = dev->mode;
    HAL_StatusTypeDef st = bno055_set_mode(dev, BNO055_MODE_CONFIG);
    if (st != HAL_OK) return st;
    st = rd(dev, BNO055_REG_OFFSETS, out, BNO055_OFFSETS_LEN);
    bno055_set_mode(dev, prev);
    return st;
}

HAL_StatusTypeDef bno055_set_offsets(bno055_t *dev, const uint8_t in[BNO055_OFFSETS_LEN])
{
    bno055_mode_t prev = dev->mode;
    HAL_StatusTypeDef st = bno055_set_mode(dev, BNO055_MODE_CONFIG);
    if (st != HAL_OK) return st;
    for (uint8_t i = 0; i < BNO055_OFFSETS_LEN && st == HAL_OK; i++)
        st = wr(dev, (uint8_t)(BNO055_REG_OFFSETS + i), in[i]);
    bno055_set_mode(dev, prev);
    return st;
}
