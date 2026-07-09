// Microgate Witty HID プロトコル実装
// Falcon Witty Manager の Microgate.UsbLibrary.dll を逆コンパイルして得たフレーム仕様に基づく。
//
// フレーム構造 (DataPacket.CreateFrame):
//   [0]      0x24('$')=リクエスト / 0x21('!')=レスポンス
//   [1]      フレーム全長 = ペイロード長 + 5
//   [2]      コマンド下位バイト
//   [3]      コマンド上位バイト
//   [4..]    ペイロード
//   [末尾]   チェックサム = (先頭〜末尾直前のバイト総和) & 0x7F
//
// HID転送: 出力レポートID=0 / 入力レポートID=0、いずれも64バイト。
//   送信は sendReport(0, 64バイトバッファ) で先頭から frame を置く。
//   受信は inputreport イベントの e.data (レポートID除く) の先頭が frame。

export const REQUEST = 0x24;
export const RESPONSE = 0x21;
export const MAX_PACKET_SIZE = 64;

// 全Microgate機器共通コマンド (Microgate.HIDProtocol.Base.CommandEnum)
export const BaseCmd = {
  ERROR: 1,
  GET_INFO_HW_SW: 2,
  ACTIVATE_APPLICATION: 3,
  RESET_AND_ACTIVE_BOOTLOADER: 4,
  SET_SERIALNO: 5,
  GET_INFO_BATTERY: 6,
  GET_HWSW_INFORMATION: 9,
};

// タイマー本体コマンド (Microgate.HIDProtocol.Witty.CommandEnum)
export const WittyCmd = {
  SET_MSC: 0x2000,            // 8192  マスストレージ化 (USBメモリとしてマウント)
  HID_CMD_SET_OJ_MODE: 0x2002,
  HID_CMD_SEND_OJ_TIME: 0x2004,
  GET_DATE_TIME: 0x20A0,      // 8352
  SET_DATE_TIME: 0x20A1,
  SET_TEST_START: 0x20B0,     // 8368  オンライン計測開始
  EVENT_TEST_RESULTS: 0x20B1, // 8369  計測結果イベント (機器→PC)
  GET_RADIO_CONFIG: 0x3000,
};

// 7ビット加算チェックサム
export function checksum(bytes, begin, end) {
  let sum = 0;
  for (let i = begin; i < end; i++) sum += bytes[i];
  return sum & 0x7f;
}

// リクエストフレームを組み立てて 64バイトの送信バッファを返す
export function buildFrame(command, payload = new Uint8Array(0)) {
  const len = payload.length + 5;
  if (len > MAX_PACKET_SIZE) throw new Error('ペイロードが大きすぎます');
  const buf = new Uint8Array(MAX_PACKET_SIZE); // 残りは0埋め
  buf[0] = REQUEST;
  buf[1] = len;
  buf[2] = command & 0xff;
  buf[3] = (command >> 8) & 0xff;
  buf.set(payload, 4);
  buf[len - 1] = checksum(buf, 0, len - 1);
  return buf;
}

// 文字列を UTF-16LE バイト列に (C# Encoding.Unicode 相当)
export function encodeUtf16le(str) {
  const out = new Uint8Array(str.length * 2);
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    out[i * 2] = c & 0xff;
    out[i * 2 + 1] = (c >> 8) & 0xff;
  }
  return out;
}

// オンライン計測開始フレーム (RequestWittyTestStart 相当)
// payload = 59バイト固定、先頭にテスト名(UTF-16LE, 最大57バイト), 残り0埋め
export function buildTestStart(testName) {
  const name = encodeUtf16le(testName);
  if (name.length > 57) throw new Error('テスト名が長すぎます');
  const payload = new Uint8Array(59);
  payload.set(name, 0);
  return buildFrame(WittyCmd.SET_TEST_START, payload);
}

// 受信データ (レポートID除く Uint8Array) を解析。妥当でなければ null。
// 機種によってフレーム先頭に 0x00 が付く(タイマー本体)ため、先頭の 0x00 は読み飛ばす。
// 有効なフレームは必ず 0x24/0x21 で始まり 0x00 で始まることは無いので安全。
export function parseFrame(data) {
  let off = 0;
  while (off < data.length && data[off] === 0x00) off++;
  const frame = off > 0 ? data.subarray(off) : data;
  if (frame.length < 5) return null;
  const type = frame[0];
  if (type !== REQUEST && type !== RESPONSE) return null;
  const len = frame[1];
  if (len < 5 || len > MAX_PACKET_SIZE || len > frame.length) return null;
  const command = frame[2] | (frame[3] << 8);
  const payload = frame.slice(4, len - 1);
  const gotSum = frame[len - 1];
  const wantSum = checksum(frame, 0, len - 1);
  if (gotSum !== wantSum) return null;
  return { type, isResponse: type === RESPONSE, command, payload, length: len };
}

// バッファ内から妥当なフレームを全て走査して返す(先頭バイトが機種/モードで変わる・
// 1レポートに複数フレームが入る場合に対応)。チェックサム一致で妥当性を判定。
export function scanFrames(data) {
  const frames = [];
  let i = 0;
  while (i + 5 <= data.length) {
    const type = data[i];
    if (type === REQUEST || type === RESPONSE) {
      const len = data[i + 1];
      if (len >= 5 && len <= MAX_PACKET_SIZE && i + len <= data.length &&
          checksum(data, i, i + len - 1) === data[i + len - 1]) {
        frames.push({
          type,
          isResponse: type === RESPONSE,
          command: data[i + 2] | (data[i + 3] << 8),
          payload: data.slice(i + 4, i + len - 1),
          length: len,
          offset: i,
        });
        i += len;
        continue;
      }
    }
    i++;
  }
  return frames;
}

// --- レスポンス解読 ---

function u16le(p, o) { return p[o] | (p[o + 1] << 8); }

// エラーレスポンス (command === 1)
export function parseError(payload) {
  if (payload.length < 3) return null;
  return { failedCommand: u16le(payload, 0), errorCode: payload[2] };
}

// GET_INFO_HW_SW の応答 (ResponseInfoHwAndSw)
export function parseInfoHwSw(payload) {
  if (payload.length < 10) return null;
  return {
    circuitCode: u16le(payload, 0),
    serialNo: u16le(payload, 2),
    bootVersion: `${payload[4]}.${payload[5]}.${payload[6]}`,
    appVersion: `${payload[7]}.${payload[8]}.${payload[9]}`,
  };
}

// GET_DATE_TIME の応答 (ResponseWittyGetDateTime)
export function parseDateTime(payload) {
  if (payload.length < 7) return null;
  return {
    year: u16le(payload, 0),
    month: payload[2],
    day: payload[3],
    hour: payload[4],
    minute: payload[5],
    second: payload[6],
  };
}

// 計測時刻tick(1/25000秒単位)を時分秒に変換 (GetTimeToVector 相当)
export function ticksToTime(time) {
  return {
    hour: Math.floor(time / 90000000),
    minute: Math.floor((time % 90000000) / 1500000),
    second: Math.floor((time % 1500000) / 25000),
    // 10万分の1秒 (0..99999)
    fraction: Math.round((time % 25000) * 4.0),
    seconds: time / 25000, // 秒(小数)
  };
}

// EVENT_TEST_RESULTS (cmd 0x20B1) のペイロード解読(実機データから解析)
//   [0..3] 時刻 uint32 LE (1/25000秒 tick)
//   [4..5] インパルス番号 uint16 LE
// ※ tick の基準(計測開始からの経過か等)は実測タイムで要確認。
export function parseTestResultEvent(payload) {
  if (payload.length < 6) return null;
  const tick = (payload[0] | (payload[1] << 8) | (payload[2] << 16) | (payload[3] << 24)) >>> 0;
  const counter = payload[4] | (payload[5] << 8);
  return { tick, counter, seconds: tick / 25000 };
}

// 論理チャンネルの意味 (Ranking の Find* より)
export function logicalChannelName(ch) {
  if (ch === 0) return 'スタート';
  if (ch === 65535) return 'ストップ';
  if (ch === 65530) return 'リアクション';
  return `中間${ch}`;
}
