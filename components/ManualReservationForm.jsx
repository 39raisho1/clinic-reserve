import React, { useMemo, useState } from "react";
import {
  collection,
  doc,
  getDocs,
  query,
  runTransaction,
  serverTimestamp,
  where,
} from "firebase/firestore";
import { db } from "../firebaseConfig";
import { nowJST, isoDateKey, jstDayRange } from "../utils/timeJST.js";

// AdminPage と同じ仕様：JSTの YYYYMMDD
const pad2 = (n) => String(n).padStart(2, "0");
const toDateKeyJST = (d) => `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}`;

// ★スロットDocId（これが「重複防止」の本体）
const slotDocId = (dateKeyISO, receptionNumber) => `${dateKeyISO}_${receptionNumber}`;

// 入力の厳格化
const isDigits = (s) => /^\d+$/.test(s);
const isBirth8 = (s) => !s || /^\d{8}$/.test(s);
const isPhone10_11 = (s) => !s || /^\d{10,11}$/.test(s);

export default function ManualReservationForm() {
  const [receptionNumber, setReceptionNumber] = useState("");
  const [name, setName] = useState("");
  const [type, setType] = useState("初診");
  const [cardNumber, setCardNumber] = useState("");
  const [birthdate, setBirthdate] = useState("");
  const [phone, setPhone] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const normalizedInput = useMemo(() => {
    const rawNo = String(receptionNumber ?? "").trim();
    const rawName = String(name ?? "").trim();
    const rawBirth = String(birthdate ?? "").trim();
    const rawPhone = String(phone ?? "").trim();
    const rawCard = String(cardNumber ?? "").trim();
    return { rawNo, rawName, rawBirth, rawPhone, rawCard };
  }, [receptionNumber, name, birthdate, phone, cardNumber]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (isSubmitting) return;

    const { rawNo, rawName, rawBirth, rawPhone, rawCard } = normalizedInput;

    // バリデーション
    if (!isDigits(rawNo)) return alert("受付番号は半角数字で入力してください。");
    const n = Number(rawNo);
    if (!Number.isInteger(n) || n <= 0) return alert("受付番号は正の整数で入力してください。");
    if (!rawName) return alert("名前を入力してください。");
    if (!isBirth8(rawBirth)) return alert("生年月日は8桁の半角数字（YYYYMMDD）で入力してください。");
    if (!isPhone10_11(rawPhone)) return alert("電話番号は10〜11桁の半角数字で入力してください。");

    setIsSubmitting(true);

    const submittedNoStr = rawNo;
    const submittedNo = n;
    const submittedName = rawName;

    try {
      const now = nowJST();
      const dateKey = toDateKeyJST(now);     // YYYYMMDD
      const dateKeyISO = isoDateKey(now);    // YYYY-MM-DD

      // reservations コレクションで当該番号が本日すでに使われていないか確認
      // （Web予約はreservationSlotsを作らないためslotチェックだけでは不十分）
      const conflictSnap = await getDocs(
        query(collection(db, "reservations"), where("receptionNumber", "==", submittedNo))
      );
      const alreadyUsed = conflictSnap.docs.some((d) => {
        const r = d.data();
        return r.dateKeyISO === dateKeyISO || r.dateKey === dateKeyISO || r.dateKey === dateKey;
      });
      if (alreadyUsed) throw new Error("DUPLICATE");

      // AdminPage と同じ（1日単位に統一）
      const counterRef = doc(db, "counters", dateKeyISO);

      // ★スロット
      const slotRef = doc(db, "reservationSlots", slotDocId(dateKeyISO, submittedNo));

      await runTransaction(db, async (tx) => {
        // ① slot チェック（存在したら終了）
        const slotSnap = await tx.get(slotRef);
        if (slotSnap.exists()) {
          throw new Error("DUPLICATE");
        }

        // ② counter の count を +1（上限判定・自動停止と同じ土俵）
        const cSnap = await tx.get(counterRef);
        const c = cSnap.exists() ? cSnap.data() || {} : {};
        const prevCount = Number(c.count ?? 0);
        tx.set(counterRef, { count: prevCount + 1 }, { merge: true });

        // ③ 予約ドキュメント作成
        const newRef = doc(collection(db, "reservations"));
        tx.set(newRef, {
          receptionNumber: submittedNo,
          type,
          name: submittedName,
          cardNumber: rawCard,
          birthdate: rawBirth,
          phone: rawPhone,
          status: "未受付",
          createdAt: serverTimestamp(),

          // ★ Admin と整合するキー
          dateKey,
          dateKeyISO,
          vip: submittedNo >= 1001,
          comment: "",

          createdBy: "admin",
        });

        // ④ スロット確保（reservationId を保持）
        tx.set(slotRef, {
          dateKeyISO,
          receptionNumber: submittedNo,
          reservationId: newRef.id,
          createdAt: serverTimestamp(),
          createdBy: "admin",
          kind: "manual",
        });
      });

      alert(`✅ 番号「${submittedNoStr}」で予約を作成しました！`);

      // フォームクリア
      setReceptionNumber("");
      setName("");
      setType("初診");
      setCardNumber("");
      setBirthdate("");
      setPhone("");
    } catch (err) {
      console.error(err);
      const msg = err?.message || "";
      if (msg === "DUPLICATE") {
        alert(`❌ 番号「${submittedNoStr}」は既に使われています。別の番号を指定してください。`);
      } else {
        alert("❌ 予約作成に失敗しました: " + msg);
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="grid grid-cols-1 md:grid-cols-6 gap-2 items-end">
      <div className="col-span-1">
        <label className="block text-sm mb-1">受付番号</label>
        <input
          type="text"
          value={receptionNumber}
          onChange={(e) => setReceptionNumber(e.target.value)}
          className="border rounded p-2 w-full"
          placeholder="例: 53"
          disabled={isSubmitting}
        />
      </div>

      <div className="col-span-1">
        <label className="block text-sm mb-1">名前</label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="border rounded p-2 w-full"
          placeholder="例: チンオウ ケンシロウ"
          disabled={isSubmitting}
        />
      </div>

      <div className="col-span-1">
        <label className="block text-sm mb-1">初診/再診</label>
        <select value={type} onChange={(e) => setType(e.target.value)} className="border rounded p-2 w-full" disabled={isSubmitting}>
          <option value="初診">初診</option>
          <option value="再診">再診</option>
        </select>
      </div>

      <div className="col-span-1">
        <label className="block text-sm mb-1">診察券番号</label>
        <input
          type="text"
          value={cardNumber}
          onChange={(e) => setCardNumber(e.target.value)}
          className="border rounded p-2 w-full"
          placeholder="例: 123456"
          disabled={isSubmitting}
        />
      </div>

      <div className="col-span-1">
        <label className="block text-sm mb-1">生年月日</label>
        <input
          type="text"
          value={birthdate}
          onChange={(e) => setBirthdate(e.target.value)}
          className="border rounded p-2 w-full"
          placeholder="YYYYMMDD"
          disabled={isSubmitting}
        />
      </div>

      <div className="col-span-1">
        <label className="block text-sm mb-1">電話番号</label>
        <input
          type="tel"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          className="border rounded p-2 w-full"
          placeholder="例: 08012345678"
          disabled={isSubmitting}
        />
      </div>

      <div className="col-span-6">
        <button
          type="submit"
          disabled={isSubmitting}
          className={`w-full py-3 font-bold text-white rounded ${isSubmitting ? "bg-green-300 cursor-not-allowed" : "bg-green-500 hover:bg-green-700"}`}
        >
          {isSubmitting ? "送信中…" : "登録する"}
        </button>
      </div>
    </form>
  );
}
