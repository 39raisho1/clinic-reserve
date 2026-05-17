// utils/timeJST.js
export const TZ = "Asia/Tokyo";

// JST 現在時刻
export function nowJST() {
  // ローカルのタイムゾーンに依存しない JST の Date を作る
  return new Date(new Date().toLocaleString("en-US", { timeZone: TZ }));
}

// YYYY-MM-DD（JST）
export function isoDateKey(d = nowJST()) {
  const y = String(d.getFullYear());
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// 1日（00:00〜24:00 JST）の範囲
export function jstDayRange(base = nowJST()) {
  const y = base.getFullYear();
  const m = base.getMonth();
  const d = base.getDate();
  const start = new Date(y, m, d, 0, 0, 0, 0);
  const end   = new Date(y, m, d + 1, 0, 0, 0, 0);
  return { start, end };
}

/**
 * 互換用：午前/午後の半日レンジ
 * 既存コードが使っていても落ちないように残しておく。
 * 午前: 00:00〜14:30 JST、午後: 14:30〜24:00 JST
 */
export function jstHalfDayRange(base = nowJST()) {
  const { start: dayStart } = jstDayRange(base);
  const amEnd = new Date(
    dayStart.getFullYear(),
    dayStart.getMonth(),
    dayStart.getDate(),
    14, 30, 0, 0
  );
  if (base < amEnd) {
    return { period: "morning", start: dayStart, end: amEnd };
  }
  const pmEnd = new Date(
    dayStart.getFullYear(),
    dayStart.getMonth(),
    dayStart.getDate() + 1,
    0, 0, 0, 0
  );
  return { period: "afternoon", start: amEnd, end: pmEnd };
}
