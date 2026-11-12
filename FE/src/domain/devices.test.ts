import { describe, expect, it } from 'vitest';
import {
  CONNECTED_TEXT,
  DEVICE_META,
  DISCONNECTED_TEXT,
  deviceGroupName,
  deviceListText,
  disconnectTitle,
} from './devices';

describe('DEVICE_META', () => {
  it('이름·칩 글자·점 글자가 설계 표와 같다', () => {
    expect(DEVICE_META).toEqual({
      LEFT: { name: '왼손', chip: '왼', mark: 'L' },
      RIGHT: { name: '오른손', chip: '오', mark: 'R' },
      PEDAL: { name: '페달', chip: '페달', mark: 'P' },
    });
  });

  it('상태 단어는 연결됨·연결 안 됨 둘이다', () => {
    expect(CONNECTED_TEXT).toBe('연결됨');
    expect(DISCONNECTED_TEXT).toBe('연결 안 됨');
  });
});

describe('deviceListText', () => {
  it('페달을 넣지 않는 소스(pedal 없음)', () => {
    expect(deviceListText({ left: true, right: true })).toBe('왼손·오른손 연결됨');
    expect(deviceListText({ left: false, right: true })).toBe('왼손 연결 안 됨');
    expect(deviceListText({ left: true, right: false })).toBe('오른손 연결 안 됨');
    expect(deviceListText({ left: false, right: false })).toBe('왼손·오른손 연결 안 됨');
  });

  it('페달을 넣는 소스의 8가지 조합', () => {
    const table: Array<[boolean, boolean, boolean, string]> = [
      [true, true, true, '왼손·오른손·페달 연결됨'],
      [true, true, false, '페달 연결 안 됨'],
      [true, false, true, '오른손 연결 안 됨'],
      [true, false, false, '오른손·페달 연결 안 됨'],
      [false, true, true, '왼손 연결 안 됨'],
      [false, true, false, '왼손·페달 연결 안 됨'],
      [false, false, true, '왼손·오른손 연결 안 됨'],
      [false, false, false, '왼손·오른손·페달 연결 안 됨'],
    ];
    for (const [left, right, pedal, text] of table) {
      expect(deviceListText({ left, right, pedal })).toBe(text);
    }
  });
});

describe('deviceGroupName', () => {
  it('페달이 필요한 소스는 스틱·페달, 아니면 스틱', () => {
    expect(deviceGroupName(true)).toBe('스틱·페달');
    expect(deviceGroupName(false)).toBe('스틱');
  });
});

describe('disconnectTitle', () => {
  it('페달을 보지 않는 소스: 한 손 / 양손', () => {
    expect(disconnectTitle(false, true)).toBe('왼손 스틱 연결이 끊겼어요');
    expect(disconnectTitle(true, false)).toBe('오른손 스틱 연결이 끊겼어요');
    expect(disconnectTitle(false, false)).toBe('양손 스틱 연결이 끊겼어요');
  });

  it('페달만 끊김', () => {
    expect(disconnectTitle(true, true, false)).toBe('페달 연결이 끊겼어요');
  });

  it('손과 페달이 함께 끊김', () => {
    expect(disconnectTitle(false, true, false)).toBe('스틱·페달 연결이 끊겼어요');
    expect(disconnectTitle(true, false, false)).toBe('스틱·페달 연결이 끊겼어요');
    expect(disconnectTitle(false, false, false)).toBe('스틱·페달 연결이 끊겼어요');
  });

  it('페달이 붙어 있으면 손 기준으로 말한다', () => {
    expect(disconnectTitle(false, true, true)).toBe('왼손 스틱 연결이 끊겼어요');
    expect(disconnectTitle(false, false, true)).toBe('양손 스틱 연결이 끊겼어요');
  });
});
