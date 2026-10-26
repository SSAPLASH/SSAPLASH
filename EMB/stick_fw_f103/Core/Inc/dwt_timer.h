/*
 * dwt_timer.h - Cortex-M3 DWT 사이클 카운터 기반 시간 측정
 *
 * 72MHz에서 CYCCNT는 약 59.6초마다 한 바퀴 돈다.
 * micros()를 CYCCNT/72로 만들면 랩어라운드 지점에서 값이 튀므로,
 * 구간 측정은 반드시 "사이클 차이를 먼저 구하고 나서" µs로 바꾼다.
 */
#ifndef DWT_TIMER_H
#define DWT_TIMER_H

#include "stm32f1xx_hal.h"
#include <stdint.h>

static inline void dwt_init(void)
{
    CoreDebug->DEMCR |= CoreDebug_DEMCR_TRCENA_Msk;
    DWT->CYCCNT = 0;
    DWT->CTRL |= DWT_CTRL_CYCCNTENA_Msk;
}

static inline uint32_t dwt_now(void)
{
    return DWT->CYCCNT;
}

/* start 이후 경과 시간(µs). 59초 이내 구간에서만 유효 */
static inline uint32_t dwt_elapsed_us(uint32_t start)
{
    return (uint32_t)(DWT->CYCCNT - start) / (SystemCoreClock / 1000000U);
}

#endif /* DWT_TIMER_H */
