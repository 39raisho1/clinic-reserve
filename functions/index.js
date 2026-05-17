const functions = require("firebase-functions");
const admin     = require("firebase-admin");
const dayjs     = require("dayjs");
require("dayjs/plugin/utc");
require("dayjs/plugin/timezone");
dayjs.extend(require("dayjs/plugin/utc"));
dayjs.extend(require("dayjs/plugin/timezone"));
dayjs.extend(require("dayjs/plugin/isBetween"));

admin.initializeApp();
const db = admin.firestore();

const TZ = "Asia/Tokyo";
const SETTINGS_PATH = "settings/clinic";

exports.addDateField = functions.firestore
  .document("reservations/{docId}")
  .onCreate(async (snap, ctx) => {
    const createdAt = snap.get("createdAt");
    if (!createdAt) return;
    const dateString = dayjs(createdAt.toDate()).tz(TZ).format("YYYY-MM-DD");
    return snap.ref.update({ date: dateString });
  });

async function syncReservationStatus() {
  const ref  = db.doc(SETTINGS_PATH);
  const snap = await ref.get();
  const data = snap.exists ? snap.data() : {};
  if (data.autoToggleEnabled === false) return "自動切替オフ";

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
      lastAutoToggle:    admin.firestore.FieldValue.serverTimestamp(),
    });
    await db.collection("logs").add({
      action:    shouldOpen ? "自動：受付再開" : "自動：受付停止",
      details:   "スケジュール更新",
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
      user:      "system",
    });
    return `切替: ${shouldOpen}`;
  }
  return "状態に変更なし";
}

exports.manualToggleReservation = functions.https.onRequest(async (req, res) => {
  try {
    const result = await syncReservationStatus();
    res.send(`手動トリガー実行結果: ${result}`);
  } catch (e) {
    console.error(e);
    res.status(500).send("エラー：" + e.message);
  }
});

exports.autoOpen830 = functions.pubsub
  .schedule("30 8 * * *")
  .timeZone("Asia/Tokyo")
  .onRun(async () => {
    const ref  = db.doc(SETTINGS_PATH);
    const snap = await ref.get();
    const data = snap.exists ? snap.data() : {};

    if (!data.timerOpen830)     return null;
    if (data.isReservationOpen) return null;

    await ref.update({ isReservationOpen: true, forceOpenUntil: null });
    await db.collection("logs").add({
      action:    "タイマー：自動開始",
      details:   "8:30タイマーにより予約受付を自動再開",
      user:      "system",
      device:    "server",
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
    });
    return null;
  });

exports.autoOpen1430 = functions.pubsub
  .schedule("30 14 * * *")
  .timeZone("Asia/Tokyo")
  .onRun(async () => {
    const ref  = db.doc(SETTINGS_PATH);
    const snap = await ref.get();
    const data = snap.exists ? snap.data() : {};

    if (!data.timerOpen1430)    return null;
    if (data.isReservationOpen) return null;

    await ref.update({ isReservationOpen: true, forceOpenUntil: null });
    await db.collection("logs").add({
      action:    "タイマー：自動開始",
      details:   "14:30タイマーにより予約受付を自動再開",
      user:      "system",
      device:    "server",
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
    });
    return null;
  });
