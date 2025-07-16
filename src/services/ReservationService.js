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
  orderBy,
  limit
} from "firebase/firestore";

/**
 * 通常予約 (6の倍数を飛ばす)
 */
export async function createReservation(data) {
  const today           = data.date;   // YYYY-MM-DD
  const counterRef      = doc(db, "counters", "reservation");
  const dailyCounterRef = doc(db, "dailyCounters", today);
  const reservationsCol = collection(db, "reservations");
  const newDocRef       = doc(reservationsCol);

  const result = await runTransaction(db, async (tx) => {
    // ── (1) グローバルカウンターを取得 ───────────────────
    const snap     = await tx.get(counterRef);
    let rawCount   = snap.exists() ? snap.data().count : 0;

    // カウンターが未作成 or リセット(0)なら、既存予約から最大番号を拾う
    if (!snap.exists() || rawCount === 0) {
      const maxSnap = await getDocs(
        query(reservationsCol, orderBy("receptionNumber", "desc"), limit(1))
      );
      if (!maxSnap.empty) {
        rawCount = maxSnap.docs[0].data().receptionNumber;
      }
    }

    // ── (2) 6の倍数を飛ばしつつ次の番号を計算 ────────────────
    const baseCount = rawCount < 6 ? 6 : rawCount;
    let nextGlobal  = baseCount + 1;
    while (nextGlobal % 6 === 0) {
      nextGlobal += 1;
    }

    // ── (3) 日次カウンター取得 ───────────────────────────
    const dailySnap = await tx.get(dailyCounterRef);
    const nextDaily = (dailySnap.exists() ? dailySnap.data().count : 0) + 1;

    // ── (4) 予約ドキュメントを書き込み ──────────────────────
    tx.set(newDocRef, {
      ...data,
      receptionNumber: nextGlobal,
      createdAt:       serverTimestamp(),
    });

    // ── (5) counters/reservation & dailyCounters を更新 ─────
    tx.set(counterRef,      { count: nextGlobal }, { merge: true });
    tx.set(dailyCounterRef, { count: nextDaily },   { merge: true });

    return { id: newDocRef.id, receptionNumber: nextGlobal };
  });

  return result;
}

/**
 * VIP予約 (1001以上、重複と6の倍数もスキップ)
 */
export async function createVIPReservation(data) {
  const MIN_VIP         = 1001;
  const reservationsCol = collection(db, "reservations");

  // (A) 既存の1001以上の番号を全取得
  const snap = await getDocs(
    query(
      reservationsCol,
      where("receptionNumber", ">=", MIN_VIP)
    )
  );
  const used = new Set(snap.docs.map(d => d.data().receptionNumber));

  // (B) 空いている最小番号を探す（かつ6の倍数もスキップ）
  let nextVIP = MIN_VIP;
  while (used.has(nextVIP) || nextVIP % 6 === 0) {
    nextVIP += 1;
  }

  // (C) トランザクションで書き込み（並列重複を防止）
  const newRef = doc(reservationsCol);
  await runTransaction(db, async tx => {
    // 念のため同じチェックをトランザクション内でも
    const verifySnap = await tx.get(query(
      reservationsCol,
      where("receptionNumber", "==", nextVIP),
      limit(1)
    ));
    if (!verifySnap.empty) {
      throw new Error(`VIP番号${nextVIP}は既に使われています`);
    }
    tx.set(newRef, {
      ...data,
      receptionNumber: nextVIP,
      createdAt:       serverTimestamp(),
    });
  });

  return { id: newRef.id, receptionNumber: nextVIP };
}
