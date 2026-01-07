const functions = require("firebase-functions");
const admin     = require("firebase-admin");
const dayjs     = require("dayjs");
require("dayjs/plugin/utc");
require("dayjs/plugin/timezone");
dayjs.extend(require("dayjs/plugin/utc"));
dayjs.extend(require("dayjs/plugin/timezone"));

admin.initializeApp();
const db = admin.firestore();

// ← 先に定義！
const TZ = "Asia/Tokyo";
const SETTINGS_PATH = "settings/clinic";

/**
 * Firestore に書き込まれた createdAt を JST ベースの日付文字列にして date フィールドに追加
 */
exports.addDateField = functions.firestore
  .document("reservations/{docId}")
  .onCreate(async (snap, ctx) => {
    const createdAt = snap.get("createdAt");
    if (!createdAt) return;
    const jsDate     = createdAt.toDate();
    const dateString = dayjs(jsDate).tz(TZ).format("YYYY-MM-DD");
    return snap.ref.update({ date: dateString });
  });

/**
 * 予約受付の自動切り替えロジック
 */
async function syncReservationStatus() {
  const ref  = db.doc(SETTINGS_PATH);
  const snap = await ref.get();
  const data = snap.exists ? snap.data() : {};
  if (data.autoToggleEnabled === false) {
    return "自動切替オフ";
  }

  const now     = dayjs().tz(TZ);
  const weekday = now.format("dddd").toLowerCase();
  const sched   = data.reservationHours || {};
  const config  = sched[weekday];
  let shouldOpen = false;

  if (config?.morning && config?.afternoon) {
    for (const period of ["morning", "afternoon"]) {
      const { start, end } = config[period];
      const startDt = dayjs.tz(`${now.format("YYYY-MM-DD")} ${start}`, "YYYY-MM-DD HH:mm", TZ);
      const endDt   = dayjs.tz(`${now.format("YYYY-MM-DD")} ${end}`,   "YYYY-MM-DD HH:mm", TZ);
      if (now.isBetween(startDt, endDt, null, "[)")) {
        shouldOpen = true;
        break;
      }
    }
  }

  if (Boolean(data.isReservationOpen) !== shouldOpen) {
    await ref.update({
      isReservationOpen: shouldOpen,
      lastAutoToggle:    admin.firestore.FieldValue.serverTimestamp()
    });
    await db.collection("logs").add({
      action:    shouldOpen ? "自動：受付再開" : "自動：受付停止",
      details:   "スケジュール更新",
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
      user:      "system"
    });
    return `切替: ${shouldOpen}`;
  }
  return "状態に変更なし";
}

/**
 * 手動トリガー用 HTTP エンドポイント
 */
exports.manualToggleReservation = functions
  .https.onRequest(async (req, res) => {
    try {
      const result = await syncReservationStatus();
      res.send(`手動トリガー実行結果: ${result}`);
    } catch (e) {
      console.error(e);
      res.status(500).send("エラー：" + e.message);
    }
  });
