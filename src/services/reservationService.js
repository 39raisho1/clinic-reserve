// src/services/reservationService.js

import { db } from "../../firebaseConfig";
import {
  doc,
  runTransaction,
  serverTimestamp,
  collection,
  query,
  getDocs,
  orderBy,
  limit,
  documentId,
} from "firebase/firestore";
import { nowJST, isoDateKey } from "../../utils/timeJST";

function getTodayISO(dateOverride) {
  return dateOverride || isoDateKey(nowJST());
}

// ★ ISO -> YYYYMMDD
function dateKeyFromISO(dateKeyISO) {
  return String(dateKeyISO || "").replace(/-/g, "");
}

// ... readBool/toPositiveIntOr/readDailyLimit/findSmallestFreeSafe はそのまま ...

const slotDocId = (dateKeyISO, receptionNumber) => `${dateKeyISO}_${receptionNumber}`;

function nextOnlineCandidate(n) {
  let x = n;
  while (x <= 1000 && x % 6 === 0) x += 1;
  return x;
}

export async function createReservation(data) {
  const now = nowJST();
  const dateKeyISO = getTodayISO(data?.date);
  const dateKey = dateKeyFromISO(dateKeyISO); // ★ここを修正

  const freeNo = await findSmallestFreeSafe(dateKeyISO, "O");

  const settingsRef = doc(db, "settings", "clinic");
  const counterRef  = doc(db, "counters", dateKeyISO); // ★ISOに統一
  const reservationsCol = collection(db, "reservations");

  return await runTransaction(db, async (tx) => {
    const settingsSnap = await tx.get(settingsRef);
    const counterSnap  = await tx.get(counterRef);

    const settings = settingsSnap.exists() ? settingsSnap.data() || {} : {};
    const isOpen   = readBool(settings.isReservationOpen, true);

    const until = settings.forceOpenUntil?.toDate?.() ?? null;
    const forceActive = until ? now < until : false;

    const limitNum = readDailyLimit(settings);
    const counter  = counterSnap.exists() ? counterSnap.data() || {} : {};
    const count    = Number(counter.count ?? 0);

    if (!forceActive && !isOpen) throw new Error("受付停止中です");
    if (!forceActive && limitNum > 0 && count >= limitNum) {
      throw new Error(`本日の予約上限に達しました（${count}/${limitNum}）`);
    }

    const rawCursor = Number(counter.nextOnline ?? 1);
    const cursorNo  = nextOnlineCandidate(rawCursor);
    if (cursorNo > 1000) throw new Error("本日のWEB予約番号枠が満杯です");

    let candidateStart =
      Number.isFinite(freeNo) && freeNo !== null && freeNo <= cursorNo
        ? freeNo
        : cursorNo;

    candidateStart = nextOnlineCandidate(Math.max(1, candidateStart));
    if (candidateStart > 1000) throw new Error("本日のWEB予約番号枠が満杯です");

    let chosen = null;
    let candidate = candidateStart;

    for (let i = 0; i < 1200; i++) {
      candidate = nextOnlineCandidate(candidate);
      if (candidate > 1000) break;

      const slotRef = doc(db, "reservationSlots", slotDocId(dateKeyISO, candidate));
      const slotSnap = await tx.get(slotRef);

      if (!slotSnap.exists()) {
        chosen = candidate;
        break;
      }
      candidate += 1;
    }

    if (chosen === null) throw new Error("本日のWEB予約番号枠が満杯です（空きが見つかりません）");

    const patch = { count: count + 1 };

    let nextBase = cursorNo;
    if (chosen >= cursorNo) nextBase = chosen + 1;
    patch.nextOnline = nextOnlineCandidate(nextBase);

    tx.set(counterRef, patch, { merge: true });

    const newRef = doc(reservationsCol);
    tx.set(newRef, {
      ...data,
      dateKeyISO,
      dateKey,
      receptionNumber: chosen,
      status: "予約済",
      vip: false,
      createdBy: "public",
      createdAt: serverTimestamp(),
    });

    const slotRef = doc(db, "reservationSlots", slotDocId(dateKeyISO, chosen));
    tx.set(slotRef, {
      dateKeyISO,
      dateKey,
      receptionNumber: chosen,
      reservationId: newRef.id,
      createdAt: serverTimestamp(),
      createdBy: "public",
      kind: "online",
    });

    return { id: newRef.id, receptionNumber: chosen };
  });
}

export async function createVIPReservation(data) {
  const now = nowJST();
  const dateKeyISO = getTodayISO(data?.date);
  const dateKey = dateKeyFromISO(dateKeyISO); // ★ここを修正

  const freeNo = await findSmallestFreeSafe(dateKeyISO, "V");

  const settingsRef = doc(db, "settings", "clinic");
  const counterRef  = doc(db, "counters", dateKeyISO); // ★既にISOなのでOK（統一）
  const reservationsCol = collection(db, "reservations");

  return await runTransaction(db, async (tx) => {
    const settingsSnap = await tx.get(settingsRef);
    const counterSnap  = await tx.get(counterRef);

    const settings = settingsSnap.exists() ? settingsSnap.data() || {} : {};
    const isOpen   = readBool(settings.isReservationOpen, true);

    const until = settings.forceOpenUntil?.toDate?.() ?? null;
    const forceActive = until ? now < until : false;

    const limitNum = readDailyLimit(settings);
    const counter  = counterSnap.exists() ? counterSnap.data() || {} : {};
    const count    = Number(counter.count ?? 0);

    if (!forceActive && !isOpen) throw new Error("受付停止中です");
    if (!forceActive && limitNum > 0 && count >= limitNum) {
      throw new Error(`本日の予約上限に達しました（${count}/${limitNum}）`);
    }

    const cursorNo = Number(counter.nextVip ?? 1001);

    let start =
      Number.isFinite(freeNo) && freeNo !== null && freeNo <= cursorNo
        ? freeNo
        : cursorNo;

    if (start < 1001) start = 1001;

    let chosen = null;
    let candidate = start;

    for (let i = 0; i < 5000; i++) {
      const slotRef = doc(db, "reservationSlots", slotDocId(dateKeyISO, candidate));
      const slotSnap = await tx.get(slotRef);

      if (!slotSnap.exists()) {
        chosen = candidate;
        break;
      }
      candidate += 1;
    }

    if (chosen === null) throw new Error("VIP番号枠が満杯です（空きが見つかりません）");

    const patch = { count: count + 1 };

    let nextBase = cursorNo;
    if (chosen >= cursorNo) nextBase = chosen + 1;
    patch.nextVip = nextBase;

    tx.set(counterRef, patch, { merge: true });

    const newRef = doc(reservationsCol);
    tx.set(newRef, {
      ...data,
      dateKeyISO,
      dateKey,
      receptionNumber: chosen,
      status: "予約済",
      vip: true,
      createdBy: "vip",
      createdAt: serverTimestamp(),
    });

    const slotRef = doc(db, "reservationSlots", slotDocId(dateKeyISO, chosen));
    tx.set(slotRef, {
      dateKeyISO,
      dateKey,
      receptionNumber: chosen,
      reservationId: newRef.id,
      createdAt: serverTimestamp(),
      createdBy: "vip",
      kind: "vip",
    });

    return { id: newRef.id, receptionNumber: chosen };
  });
}
