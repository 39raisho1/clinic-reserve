import React, { useState } from "react";
import Link from "next/link";
import { db } from "../../firebaseConfig";
import { doc, getDoc, deleteDoc, writeBatch } from "firebase/firestore";

const TIME_SLOTS = [
  "09:30","10:00","10:30","11:00","11:30","12:00","12:30",
  "13:00","13:30","14:00","14:30","15:00","15:30","16:00","16:30","17:00","17:30",
  "18:00","18:30",
];

export default function LaserCancelPage() {
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [token, setToken] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (isSubmitting) return;
    const trimToken = token.trim().toUpperCase();
    if (!date || !time || !trimToken) return alert("すべての項目を入力してください。");

    setIsSubmitting(true);
    try {
      // ① まず通常予約（N枠）を確認
      const regularRef = doc(db, "laserReservations", `${date}_${time}`);
      const regularSnap = await getDoc(regularRef);

      if (regularSnap.exists() && !regularSnap.data().blocked) {
        const data = regularSnap.data();
        if (data.cancelToken !== trimToken) {
          alert("キャンセルコードが一致しません。もう一度ご確認ください。");
          return;
        }
        // 連続スロットをまとめて削除
        const slotsUsed = data.slotsUsed || 1;
        const startIndex = TIME_SLOTS.indexOf(time);
        const batch = writeBatch(db);
        for (let i = 0; i < slotsUsed; i++) {
          const slotTime = TIME_SLOTS[startIndex + i];
          if (slotTime) batch.delete(doc(db, "laserReservations", `${date}_${slotTime}`));
        }
        await batch.commit();
        setDone(true);
        return;
      }

      // ② 0枠予約を確認（トークンがドキュメントIDになっている）
      const flexRef = doc(db, "laserFlexReservations", trimToken);
      const flexSnap = await getDoc(flexRef);

      if (flexSnap.exists()) {
        const data = flexSnap.data();
        if (data.dateISO !== date || data.timeSlot !== time) {
          alert("日付・時間またはキャンセルコードが一致しません。");
          return;
        }
        await deleteDoc(flexRef);
        setDone(true);
        return;
      }

      alert("予約が見つかりませんでした。日付・時間・キャンセルコードをご確認ください。");
    } catch (err) {
      alert("エラーが発生しました: " + err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (done) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen p-4">
        <img src="/logo.png" alt="けんおう皮フ科クリニック" className="w-32 h-32 mb-4" />
        <h1 className="text-3xl font-bold mb-4">キャンセル完了</h1>
        <p className="text-xl mb-8">予約をキャンセルしました。</p>
        <Link href="/laser"
          className="px-8 py-4 bg-blue-500 text-white text-2xl font-bold rounded-lg hover:bg-blue-700">
          レーザー予約トップへ
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center p-4 min-h-screen">
      <img src="/logo.png" alt="けんおう皮フ科クリニック" className="w-32 h-32 mb-4" />
      <h1 className="text-3xl font-bold mb-2 text-center">レーザー予約のキャンセル</h1>
      <p className="text-gray-500 mb-6 text-center text-sm">
        予約時に表示されたキャンセルコードが必要です。<br />
        日付・時間は予約した開始時間を入力してください。
      </p>

      <form onSubmit={handleSubmit} className="w-full max-w-md flex flex-col gap-5">
        <div>
          <label className="block font-bold mb-1">予約日</label>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)}
            className="border rounded p-3 w-full text-xl" required disabled={isSubmitting} />
        </div>
        <div>
          <label className="block font-bold mb-1">予約開始時間</label>
          <select value={time} onChange={(e) => setTime(e.target.value)}
            className="border rounded p-3 w-full text-xl" required disabled={isSubmitting}>
            <option value="">選択してください</option>
            {TIME_SLOTS.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div>
          <label className="block font-bold mb-1">キャンセルコード</label>
          <input type="text" value={token} onChange={(e) => setToken(e.target.value.toUpperCase())}
            className="border rounded p-3 w-full text-xl tracking-widest"
            placeholder="例: AB12CD34" maxLength={8} required disabled={isSubmitting} />
        </div>

        <button type="submit" disabled={isSubmitting}
          className={`py-4 text-2xl font-bold text-white rounded-xl mt-2 ${
            isSubmitting ? "bg-red-300 cursor-not-allowed" : "bg-red-500 hover:bg-red-700"
          }`}>
          {isSubmitting ? "処理中..." : "予約をキャンセルする"}
        </button>
      </form>

      <Link href="/laser" className="mt-6 text-blue-500 underline">← レーザー予約トップへ戻る</Link>
    </div>
  );
}
