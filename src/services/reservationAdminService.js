// src/services/reservationAdminService.js
import { db } from "../../firebaseConfig";
import { doc, runTransaction, serverTimestamp } from "firebase/firestore";

const slotDocId = (dateKeyISO, receptionNumber) => `${dateKeyISO}_${receptionNumber}`;

export async function cancelReservationAndRelease(reservationId) {
  const resRef = doc(db, "reservations", reservationId);

  return runTransaction(db, async (tx) => {
    // --- READ PHASE（先に全部読む） ---
    const resSnap = await tx.get(resRef);
    if (!resSnap.exists()) throw new Error("予約が見つかりません");

    const r = resSnap.data() || {};
    const dateKeyISO = r.dateKeyISO; // "YYYY-MM-DD"
    const dateKey = r.dateKey;       // "YYYYMMDD"（旧）
    const no = Number(r.receptionNumber);
    const prevStatus = String(r.status || "").trim();

    const shouldDecrement = prevStatus !== "キャンセル済";

    // counters のIDをどっちで運用するか（統一推奨：ISO）
    const counterId = dateKeyISO || String(dateKey || "");
    const counterRef = counterId ? doc(db, "counters", String(counterId)) : null;

    const counterSnap = (shouldDecrement && counterRef) ? await tx.get(counterRef) : null;
    const cur = counterSnap?.exists() ? Number((counterSnap.data() || {}).count ?? 0) : 0;
    const nextCount = Math.max(0, cur - 1);

    // --- WRITE PHASE（ここから書き込みのみ） ---
    tx.update(resRef, {
      status: "キャンセル済",
      canceledAt: serverTimestamp(),
    });

    if (dateKeyISO && Number.isFinite(no)) {
      const slotRef = doc(db, "reservationSlots", slotDocId(dateKeyISO, no));
      tx.delete(slotRef);
    }

    if (shouldDecrement && counterRef) {
      tx.set(counterRef, { count: nextCount }, { merge: true });
    }
  });
}

export async function deleteReservationAndRelease(reservationId) {
  const resRef = doc(db, "reservations", reservationId);

  return runTransaction(db, async (tx) => {
    // --- READ PHASE ---
    const resSnap = await tx.get(resRef);
    if (!resSnap.exists()) return;

    const r = resSnap.data() || {};
    const dateKeyISO = r.dateKeyISO;
    const dateKey = r.dateKey;
    const no = Number(r.receptionNumber);
    const prevStatus = String(r.status || "").trim();

    const shouldDecrement = prevStatus !== "キャンセル済";

    const counterId = dateKeyISO || String(dateKey || "");
    const counterRef = counterId ? doc(db, "counters", String(counterId)) : null;

    const counterSnap = (shouldDecrement && counterRef) ? await tx.get(counterRef) : null;
    const cur = counterSnap?.exists() ? Number((counterSnap.data() || {}).count ?? 0) : 0;
    const nextCount = Math.max(0, cur - 1);

    // --- WRITE PHASE ---
    tx.delete(resRef);

    if (dateKeyISO && Number.isFinite(no)) {
      const slotRef = doc(db, "reservationSlots", slotDocId(dateKeyISO, no));
      tx.delete(slotRef);
    }

    if (shouldDecrement && counterRef) {
      tx.set(counterRef, { count: nextCount }, { merge: true });
    }
  });
}
