// utils/dateKey.js  （pages ディレクトリから見て ../utils/dateKey.js に置く）

import { nowJST } from "./timeJST.js";
import { Timestamp } from "firebase/firestore";

/** JSTの当日キー（YYYY-MM-DD）を返す */
export function jstDateKey(d = nowJST()) {
  const tz = "Asia/Tokyo";
  const y = new Intl.DateTimeFormat("ja-JP", {
    timeZone: tz,
    year: "numeric",
  }).format(d);
  const m = new Intl.DateTimeFormat("ja-JP", {
    timeZone: tz,
    month: "2-digit",
  }).format(d);
  const day = new Intl.DateTimeFormat("ja-JP", {
    timeZone: tz,
    day: "2-digit",
  }).format(d);
  return `${y}-${m}-${day}`;
}

/** Firestore Timestamp から JST 日付キーを生成 */
export function dateKeyFromTimestamp(ts) {
  if (!ts) return null;

  let d;
  if (ts instanceof Timestamp) {
    d = ts.toDate();
  } else if (ts?.toDate) {
    d = ts.toDate();
  } else {
    return null;
  }
  return jstDateKey(d);
}
