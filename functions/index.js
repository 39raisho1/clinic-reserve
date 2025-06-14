const functions = require("firebase-functions");
const admin     = require("firebase-admin");
const dayjs     = require("dayjs");
require("dayjs/plugin/utc");
require("dayjs/plugin/timezone");
dayjs.extend(require("dayjs/plugin/utc"));
dayjs.extend(require("dayjs/plugin/timezone"));

admin.initializeApp();
const db = admin.firestore();
const TZ = "Asia/Tokyo";
const SETTINGS_PATH = "settings/clinic";

// 元のロジックを関数化
async function syncReservationStatus() {
  const ref  = db.doc(SETTINGS_PATH);
  const snap = await ref.get();
  const data = snap.exists ? snap.data() : {};
  if (data.autoToggleEnabled === false) {
    return "自動切替オフ";
  }

  const now        = dayjs().tz(TZ);
  const sched      = data.reservationHours || {};
  const weekday    = now.format("dddd").toLowerCase();
  const config     = sched[weekday];
  let shouldOpen   = false;
  if (config?.morning && config?.afternoon) {
    for (const period of ["morning","afternoon"]) {
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
      lastAutoToggle: admin.firestore.FieldValue.serverTimestamp()
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

// Pub/Sub トリガー版（そのまま）
exports.autoToggleReservation = functions
  .pubsub.schedule("every 1 minutes")
  .timeZone(TZ)
  .onRun(async () => {
    return syncReservationStatus();
  });

// HTTP トリガー版（追加）
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
