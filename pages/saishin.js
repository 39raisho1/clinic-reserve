import React, { useState, useEffect } from "react";
import { db } from "../firebaseConfig";
import {
  collection,
  addDoc,
  getDocs,
  query,
  where,
  serverTimestamp,
  doc,
  onSnapshot
} from "firebase/firestore";
import Link from "next/link";

export default function SaishinPage() {
  const [formData, setFormData] = useState({ name: "", cardNumber: "" });
  const [receptionNumber, setReceptionNumber] = useState(null);
  const [callingPatients, setCallingPatients] = useState([]);
  const [loading, setLoading] = useState(true);

  // ─── 上限チェック用の state ───────────────────
  // 上限チェック用 state
  // 午前／午後別の上限を保持する state
  const [maxMorning, setMaxMorning]     = useState(null);
  const [maxAfternoon, setMaxAfternoon] = useState(null);
  const [isFull, setIsFull] = useState(false);

// ① settings/clinic から午前／午後の上限をリアルタイム購読
 useEffect(() => {
  const settingsRef = doc(db, "settings", "clinic");
  const unsub = onSnapshot(settingsRef, snap => {
    if (!snap.exists()) return;
    const data = snap.data();
    setMaxMorning(   data.maxReservationsMorning   ?? 10);
    setMaxAfternoon( data.maxReservationsAfternoon ?? 10);
  });
  return () => unsub();
}, []);


 // ② 午前／午後別上限がロードされたら当日の予約数をリアルタイム監視
 useEffect(() => {
  // まだ読み込まれていなければ何もしない
  if (maxMorning === null || maxAfternoon === null) return;

  // 今日の日付
  const today = new Date().toISOString().split("T")[0];
  const q = query(
    collection(db, "reservations"),
    where("date", "==", today)
  );

  // 監視開始
  const unsub = onSnapshot(q, snap => {
    // 今が午前か午後か判定
    const now = new Date();
    const cutoff = new Date(now);
    cutoff.setHours(14, 30, 0, 0);
    const maxLimit = now < cutoff ? maxMorning : maxAfternoon;

    setIsFull(snap.size >= maxLimit);
  });

  return () => unsub();
}, [maxMorning, maxAfternoon]);
  const handleChange = (e) => {
    setFormData({
      ...formData,
      [e.target.name]: e.target.value
    });
  };
  const handleSubmit = async (e) => {
    e.preventDefault();
    if (isFull) {
      alert("申し訳ありません。本日の予約上限に達しました。");
      return;
    }

    try {
      // 全予約から既存の receptionNumber を集める
      const allSnap = await getDocs(collection(db, "reservations"));
      const used = new Set(allSnap.docs.map(d => d.data().receptionNumber));

      // 1から順に回して、未使用かつ6の倍数でない最小番号を探す
      let newReceptionNumber = 1;
      while (used.has(newReceptionNumber) || newReceptionNumber % 6 === 0) {
        newReceptionNumber++;
      }

      // Firestore に書き込む
      const todayDate = new Date().toISOString().split("T")[0];
      await addDoc(collection(db, "reservations"), {
        type: "再診",
        name: formData.name,
        phone: formData.phone || "不明",
        cardNumber: formData.cardNumber || "",
        receptionNumber: newReceptionNumber,
        date: todayDate,
        status: "未受付",
        createdAt: serverTimestamp(),
      });

      setReceptionNumber(newReceptionNumber);
      setFormData({ name: "", cardNumber: "" });
      fetchCallingPatients();
    } catch (error) {
      console.error("Firestore 書き込みエラー:", error);
      alert("予約に失敗しました。もう一度試してください。");
    }
  };

    // 🔥 Firestore から「呼び出し中の患者情報」を取得（番号順に並べる）
  const fetchCallingPatients = async () => {
    console.log("📡 Firestore から呼び出し中の患者情報を取得");

    const callQuery = query(
      collection(db, "reservations"),
      where("status", "==", "呼び出し中")
    );

    try {
      const snapshot = await getDocs(callQuery);
      let callList = snapshot.docs.map(doc => ({
        id: doc.id,
        receptionNumber: doc.data().receptionNumber ?? "未設定"
      }));

      // 🔥 `receptionNumber` の昇順に並べ替え
      callList.sort((a, b) => a.receptionNumber - b.receptionNumber);

      setCallingPatients(callList);
    } catch (error) {
      console.error("Firestore からのデータ取得に失敗:", error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col items-center justify-center p-4 w-full max-w-lg mx-auto">
      <img src="/logo.png" alt="けんおう皮フ科クリニック" className="w-40 h-40 mb-6" />

      <h2 className="text-3xl font-bold text-center">けんおう皮フ科クリニック</h2>
      <h3 className="text-2xl font-semibold text-center">再診予約</h3>

      {/* ─── 上限到達時のメッセージ ─────────────────── */}
      {isFull && (
        <div className="mt-6 text-center text-red-600 font-bold">
          ⛔ 本日の予約上限数に達しました。受付を締め切りました。
        </div>
      )}
      {/* ───────────────────────────────────────────── */}

      {receptionNumber ? (
        <div className="text-center">
          <p className="text-lg font-bold">予約が完了しました！</p>
          <p className="text-6xl font-extrabold text-green-500 mt-4">{receptionNumber}</p>
          <p className="text-sm text-gray-600 mt-2">
            受付番号を忘れないよう、スクリーンショットを撮るかメモをお取りください。
          </p>

          <div className="mt-6">
            <Link href="/">
              <div className="px-8 py-4 bg-blue-500 text-white text-center text-2xl font-bold rounded-lg hover:bg-blue-700 shadow-lg cursor-pointer">
                予約トップに戻る
              </div>
            </Link>
          </div>

          <div className="text-center text-lg font-semibold mt-12">
            <p className="text-gray-700 text-2xl">現在お呼び出し中の方</p>
            {loading ? (
              <p className="text-gray-500 mt-4 text-xl">データを取得中...</p>
            ) : callingPatients.length > 0 ? (
              <div className="bg-gradient-to-r from-blue-600 to-blue-400 p-6 rounded-2xl shadow-xl text-white text-2xl font-bold mt-4 w-full max-w-lg">
                <div className="grid grid-cols-2 md:grid-cols-3 gap-6 justify-center">
                  {callingPatients.map((patient) => (
                    <div key={patient.id} className="bg-white text-blue-600 px-8 py-4 rounded-xl shadow-lg text-6xl font-bold flex items-center justify-center">
                      {patient.receptionNumber}
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <p className="text-gray-500 mt-4 text-xl">現在呼び出し中の方はいません</p>
            )}
          </div>
        </div>
      ) : (
        <form className="flex flex-col gap-6 w-full max-w-md" onSubmit={handleSubmit}>
          <input
            type="text"
            placeholder="名前（カタカナ）"
            name="name"
            value={formData.name}
            onChange={handleChange}
            required
            className="border p-4 rounded-md w-full text-lg"
          />
          <input
            type="text"
            placeholder="診察券番号（空欄可）"
            name="cardNumber"
            value={formData.cardNumber}
            onChange={handleChange}
            className="border p-4 rounded-md w-full text-lg"
          />
          <button
            type="submit"
            disabled={isFull}
            className={`px-8 py-6 bg-green-500 text-white text-2xl font-bold rounded-lg hover:bg-green-700 shadow-lg ${
              isFull ? "opacity-50 cursor-not-allowed" : ""
            }`}
          >
            予約する
          </button>
        </form>
      )}
    </div>
  );
}
