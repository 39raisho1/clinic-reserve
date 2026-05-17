// src/services/reservationService.js

import { db } from "../../firebaseConfig";
import {
  doc,
  runTransaction,
  serverTimestamp,
  collection,
  getDocs,
  query,
  where,
  Timestamp,
} from "firebase/firestore";
import { nowJST, isoDateKey, jstDayRange } from "../../utils/timeJST";

function getTodayKey(dateOverride) {
  return dateOverride || isoDateKey(nowJST());
}

const readBool = (v, fallback) => {
  if (v === true) return true;
  if (v === false) return false;
  return fallback;
};

const toPositiveIntOr = (v, fallback) => {
  const n = typeof v === "string" ? Number(v.trim()) : Number(v);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

function readDailyLimit(settings) {
  const day = toPositiveIntOr(settings.maxReservationsDay, 0);
  if (day > 0) return day;
  const perDay = toPositiveIntOr(settings.maxReservationsPerDay, 0);
  if (perDay > 0) return perDay;
  const m = toPositiveIntOr(settings.maxReservationsMorning, 0);
  const a = toPositiveIntOr(settings.maxReservationsAfternoon, 0);
  const sum = m + a;
  return sum > 0 ? sum : 0;
}

/**
 * 通常 WEB 予約（公開側）
 * 採番方式：
 *   ① トランザクション前に今日の予約を全件クエリ → DBの実態を把握
 *   ② トランザクション内でカウンターとDBクエリ両方を踏まえて番号決定
 *   → コード更新・複数端末同時操作など、いかなる場合も重複しない
 */
export async function createReservation(data) {
  const now      = nowJST();
  const todayISO = getTodayKey(data.date);
  const { start, end } = jstDayRange(now);

  // ① 今日の予約を全件取得（createdAt 範囲で確実に拾う）
  const todaySnap = await getDocs(
    query(
      collection(db, "reservations"),
      where("createdAt", ">=", Timestamp.fromDate(start)),
      where("createdAt", "<",  Timestamp.fromDate(end))
    )
  );
  const usedOnline = new Set();
  todaySnap.docs.forEach((d) => {
    const num = Number(d.data().receptionNumber ?? 0);
    if (num >= 1 && num <= 1000 && num % 6 !== 0) usedOnline.add(num);
  });
  const dbMaxOnline = usedOnline.size > 0 ? Math.max(...usedOnline) : 0;

  const settingsRef     = doc(db, "settings", "clinic");
  const counterRef      = doc(db, "counters", todayISO);
  const reservationsCol = collection(db, "reservations");

  // ② トランザクション（競合時はFirestoreが自動リトライ → 二重取りなし）
  const result = await runTransaction(db, async (tx) => {
    const [settingsSnap, counterSnap] = await Promise.all([
      tx.get(settingsRef),
      tx.get(counterRef),
    ]);

    const settings    = settingsSnap.exists() ? settingsSnap.data() || {} : {};
    const isOpen      = readBool(settings.isReservationOpen, true);
    const until       = settings.forceOpenUntil?.toDate?.() ?? null;
    const forceActive = until ? now < until : false;
    const limit       = readDailyLimit(settings);

    const counter = counterSnap.exists() ? counterSnap.data() || {} : {};
    const count   = Number(counter.count ?? 0);

    if (!forceActive && !isOpen) throw new Error("受付停止中です");
    if (!forceActive && limit > 0 && count >= limit) {
      throw new Error(`本日の予約上限に達しました（${count}/${limit}）`);
    }

    // 穴リスト：DBに既に存在する番号は除外して安全なものだけ再利用
    const holes = (Array.isArray(counter.onlineHoles) ? counter.onlineHoles : [])
      .filter((n) => !usedOnline.has(n))
      .sort((a, b) => a - b);

    let candidate;
    let counterUpdate;

    if (holes.length > 0) {
      candidate     = holes[0];
      counterUpdate = { count: count + 1, onlineHoles: holes.slice(1) };
    } else {
      // カウンターとDBクエリの両方の最大値 + 1 をスタート地点にする
      let next = Math.max(Number(counter.nextOnline ?? 1), dbMaxOnline + 1);
      while (next <= 1000 && next % 6 === 0) next++;
      if (next > 1000) throw new Error("本日のWEB予約番号枠（1〜1000, 6の倍数除外）が満杯です");
      candidate     = next;
      counterUpdate = { count: count + 1, nextOnline: candidate + 1 };
    }

    tx.set(counterRef, counterUpdate, { merge: true });

    const newRef = doc(reservationsCol);
    tx.set(newRef, {
      ...data,
      dateKey:         todayISO,
      dateKeyISO:      todayISO,
      receptionNumber: candidate,
      status:          "予約済",
      vip:             false,
      createdBy:       "public",
      createdAt:       serverTimestamp(),
    });

    return { id: newRef.id, receptionNumber: candidate };
  });

  return result;
}

/**
 * VIP 予約（1001〜）
 */
export async function createVIPReservation(data) {
  const now      = nowJST();
  const todayISO = getTodayKey(data.date);
  const { start, end } = jstDayRange(now);

  const todaySnap = await getDocs(
    query(
      collection(db, "reservations"),
      where("createdAt", ">=", Timestamp.fromDate(start)),
      where("createdAt", "<",  Timestamp.fromDate(end))
    )
  );
  const usedVip = new Set();
  todaySnap.docs.forEach((d) => {
    const num = Number(d.data().receptionNumber ?? 0);
    if (num >= 1001) usedVip.add(num);
  });
  const dbMaxVip = usedVip.size > 0 ? Math.max(...usedVip) : 0;

  const settingsRef     = doc(db, "settings", "clinic");
  const counterRef      = doc(db, "counters", todayISO);
  const reservationsCol = collection(db, "reservations");

  const result = await runTransaction(db, async (tx) => {
    const [settingsSnap, counterSnap] = await Promise.all([
      tx.get(settingsRef),
      tx.get(counterRef),
    ]);

    const settings    = settingsSnap.exists() ? settingsSnap.data() || {} : {};
    const isOpen      = readBool(settings.isReservationOpen, true);
    const until       = settings.forceOpenUntil?.toDate?.() ?? null;
    const forceActive = until ? now < until : false;
    const limit       = readDailyLimit(settings);

    const counter = counterSnap.exists() ? counterSnap.data() || {} : {};
    const count   = Number(counter.count ?? 0);

    if (!forceActive && !isOpen) throw new Error("受付停止中です");
    if (!forceActive && limit > 0 && count >= limit) {
      throw new Error(`本日の予約上限に達しました（${count}/${limit}）`);
    }

    const holes = (Array.isArray(counter.vipHoles) ? counter.vipHoles : [])
      .filter((n) => !usedVip.has(n))
      .sort((a, b) => a - b);

    let candidate;
    let counterUpdate;

    if (holes.length > 0) {
      candidate     = holes[0];
      counterUpdate = { count: count + 1, vipHoles: holes.slice(1) };
    } else {
      const next = Math.max(Number(counter.nextVip ?? 1001), dbMaxVip + 1);
      if (next > 2000) throw new Error("本日のVIP予約番号枠（1001〜2000）が満杯です");
      candidate     = next;
      counterUpdate = { count: count + 1, nextVip: candidate + 1 };
    }

    tx.set(counterRef, counterUpdate, { merge: true });

    const newRef = doc(reservationsCol);
    tx.set(newRef, {
      ...data,
      dateKey:         todayISO,
      dateKeyISO:      todayISO,
      receptionNumber: candidate,
      status:          "予約済",
      vip:             true,
      createdBy:       "vip",
      createdAt:       serverTimestamp(),
    });

    return { id: newRef.id, receptionNumber: candidate };
  });

  return result;
}
