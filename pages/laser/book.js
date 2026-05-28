import React, { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/router";
import { db } from "../../firebaseConfig";
import { doc, getDoc, setDoc, runTransaction, serverTimestamp } from "firebase/firestore";

const TIME_SLOTS = [
  "09:30","10:00","10:30","11:00","11:30","12:00","12:30",
  "13:00","13:30","14:00","14:30","15:00","15:30","16:00","16:30","17:00","17:30",
  "18:00","18:30",
];

function genToken() {
  const a = Math.random().toString(36).substr(2, 4).toUpperCase();
  const b = Math.random().toString(36).substr(2, 4).toUpperCase();
  return a + b;
}

function addMinutes(timeStr, minutes) {
  const [h, m] = timeStr.split(":").map(Number);
  const total = h * 60 + m + minutes;
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

export default function LaserBookPage() {
  const router = useRouter();
  const { date, time, typeName, typeSlots } = router.query;
  const slotsNeeded = parseInt(typeSlots) ?? 1;
  const startIndex = TIME_SLOTS.indexOf(time);

  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [cardNumber, setCardNumber] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (!router.isReady) return;
    if (!date || !time || !typeName) router.replace("/laser");
  }, [router.isReady, date, time, typeName]);

  if (!router.isReady || !date || !time || !typeName) return null;

  const isFlexBooking = slotsNeeded === 0;
  const endTime = isFlexBooking ? null : addMinutes(time, slotsNeeded * 30);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (isSubmitting) return;
    const trimName = name.trim();
    const trimPhone = phone.trim();
    if (!trimName) return alert("お名前を入力してください。");
    if (!/^\d{10,11}$/.test(trimPhone))
      return alert("電話番号は10〜11桁の半角数字で入力してください（ハイフンなし）。");

    setIsSubmitting(true);
    const token = genToken();

    try {
      if (isFlexBooking) {
        // 0枠: 継続枠 or 複数枠施術（全身など）の開始枠でないか確認
        const slotRef = doc(db, "laserReservations", `${date}_${time}`);
        const slotSnap = await getDoc(slotRef);
        if (slotSnap.exists()) {
          const data = slotSnap.data();
          if (data.blocked || (data.slotsUsed || 0) >= 2) throw new Error("BLOCKED");
        }
        // トークンをドキュメントIDとして使用（キャンセル時に直接参照するため）
        await setDoc(doc(db, "laserFlexReservations", token), {
          dateISO: date,
          timeSlot: time,
          treatmentType: typeName,
          slotsUsed: 0,
          name: trimName,
          phone: trimPhone,
          cardNumber: cardNumber.trim(),
          cancelToken: token,
          createdAt: serverTimestamp(),
        });
      } else {
        // N枠: トランザクションでN連続スロットを原子的に確保
        if (startIndex < 0 || startIndex + slotsNeeded > TIME_SLOTS.length)
          throw new Error("INVALID_SLOT");

        await runTransaction(db, async (tx) => {
          for (let i = 0; i < slotsNeeded; i++) {
            const slotTime = TIME_SLOTS[startIndex + i];
            const ref = doc(db, "laserReservations", `${date}_${slotTime}`);
            const snap = await tx.get(ref);
            if (snap.exists()) throw new Error("TAKEN");
          }
          // メイン予約ドキュメント
          tx.set(doc(db, "laserReservations", `${date}_${time}`), {
            dateISO: date,
            timeSlot: time,
            endTime,
            treatmentType: typeName,
            slotsUsed: slotsNeeded,
            name: trimName,
            phone: trimPhone,
            cardNumber: cardNumber.trim(),
            cancelToken: token,
            createdAt: serverTimestamp(),
          });
          // 継続ブロックドキュメント（2枠目以降）
          for (let i = 1; i < slotsNeeded; i++) {
            const slotTime = TIME_SLOTS[startIndex + i];
            tx.set(doc(db, "laserReservations", `${date}_${slotTime}`), {
              dateISO: date,
              timeSlot: slotTime,
              blocked: true,
              parentId: `${date}_${time}`,
            });
          }
        });
      }

      router.push(
        `/laser/done?date=${encodeURIComponent(date)}&time=${encodeURIComponent(time)}&endTime=${encodeURIComponent(endTime || "")}&name=${encodeURIComponent(trimName)}&typeName=${encodeURIComponent(typeName)}&token=${token}&flex=${isFlexBooking ? "1" : "0"}`
      );
    } catch (err) {
      if (err.message === "TAKEN") {
        alert("申し訳ありません。この時間はすでに予約が入りました。別の時間をお選びください。");
        router.push("/laser");
      } else if (err.message === "BLOCKED") {
        alert("この時間は他の施術中のため、予約できません。別の時間をお選びください。");
        router.push("/laser");
      } else {
        alert("予約の登録に失敗しました: " + err.message);
        setIsSubmitting(false);
      }
    }
  };

  return (
    <div className="flex flex-col items-center p-4 min-h-screen">
      <img src="/logo.png" alt="けんおう皮フ科クリニック" className="w-32 h-32 mb-4" />
      <h1 className="text-3xl font-bold mb-4 text-center">レーザー脱毛 予約フォーム</h1>

      <div className="w-full max-w-md bg-green-50 border-2 border-green-400 rounded-xl p-4 mb-6 text-center">
        <p className="text-xl font-bold text-green-700">{typeName}</p>
        <p className="text-lg text-green-700">
          {date}　{time}{endTime ? ` 〜 ${endTime}` : ""}
        </p>
      </div>

      <form onSubmit={handleSubmit} className="w-full max-w-md flex flex-col gap-5">
        <div>
          <label className="block font-bold mb-1">
            診察券番号
            <span className="text-gray-500 font-normal text-sm ml-1">（初診の方は空欄可）</span>
          </label>
          <input type="text" value={cardNumber} onChange={(e) => setCardNumber(e.target.value)}
            className="border rounded p-3 w-full text-xl" placeholder="例: 123456" disabled={isSubmitting} />
        </div>
        <div>
          <label className="block font-bold mb-1">お名前 <span className="text-red-500">*</span></label>
          <input type="text" value={name} onChange={(e) => setName(e.target.value)}
            className="border rounded p-3 w-full text-xl" placeholder="例: 山田 花子"
            required disabled={isSubmitting} />
        </div>
        <div>
          <label className="block font-bold mb-1">電話番号（ハイフンなし） <span className="text-red-500">*</span></label>
          <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)}
            className="border rounded p-3 w-full text-xl" placeholder="例: 09012345678"
            required disabled={isSubmitting} />
        </div>

        <button type="submit" disabled={isSubmitting}
          className={`py-4 text-2xl font-bold text-white rounded-xl mt-2 ${
            isSubmitting ? "bg-green-300 cursor-not-allowed" : "bg-green-500 hover:bg-green-700"
          }`}>
          {isSubmitting ? "送信中..." : "予約を確定する"}
        </button>
      </form>

      <Link href="/laser" className="mt-6 text-blue-500 underline">← 日時選択に戻る</Link>
    </div>
  );
}
