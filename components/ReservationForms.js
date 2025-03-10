import React, { useState, useEffect } from "react";
import { db } from "../firebaseConfig";
import { collection, addDoc, getDocs, query, where, serverTimestamp, doc, getDoc, orderBy } from "firebase/firestore";
import BirthdateInput from "../components/BirthdateInput";
import Link from "next/link";

export default function ReservationForm({ type }) {
  const [formData, setFormData] = useState({ name: "", birthdate: "", phone: "", cardNumber: "" });
  const [receptionNumber, setReceptionNumber] = useState(null);
  const [isFull, setIsFull] = useState(false); // 🔥 予約上限チェック
  const [loading, setLoading] = useState(true);

  // 🔥 Firestore から予約上限を取得し、本日の予約数と比較
  useEffect(() => {
    const checkReservationLimit = async () => {
      try {
        const today = new Date().toISOString().split("T")[0]; // YYYY-MM-DD
        const q = query(collection(db, "reservations"), where("date", "==", today));
        const snapshotReservations = await getDocs(q);
        const todayReservations = snapshotReservations.size;
    
        console.log(`📡 予約数チェック: ${todayReservations} / ${maxReservations}`);
    
        setIsFull(todayReservations >= maxReservations);
        console.log(`✅ isFull の値更新: ${todayReservations >= maxReservations}`);
      } catch (error) {
        console.error("❌ Firestore からのデータ取得エラー:", error);
      }
    };
    

    checkReservationLimit();
  }, []);

  const handleChange = (e) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    const todayDate = new Date().toISOString().split("T")[0]; // YYYY-MM-DD
    console.log(`📡 予約の日付 (date): ${todayDate}`); // 🔥 `date` の値をデバッグ
    

    // 🔥 予約上限チェック
    if (isFull) {
      alert("本日の予約上限に達しました。別の日をお選びください。");
      return;
    }

    try {
      console.log("📡 予約データを取得...");
      const q = query(collection(db, "reservations"), orderBy("receptionNumber", "desc"));
      const snapshot = await getDocs(q);
      const newReceptionNumber = snapshot.empty ? 1 : (snapshot.docs[0].data()?.receptionNumber || 0) + 1;
      const todayDate = new Date().toISOString().split("T")[0]; // YYYY-MM-DD
      console.log(`📡 予約の日付 (date): ${todayDate}`); // 🔥 `date` の値をデバッグ
      
      await addDoc(collection(db, "reservations"), {
        type,
        name: formData.name,
        birthdate: formData.birthdate,
        phone: formData.phone,
        cardNumber: formData.cardNumber || "",
        receptionNumber: newReceptionNumber,
        date: todayDate, // 🔥 予約の日付を `YYYY-MM-DD` 形式で保存
        status: "未受付",
        createdAt: serverTimestamp(),
      });
      
      

      setReceptionNumber(newReceptionNumber);
      console.log(`✅ 予約完了！受付番号: ${newReceptionNumber}`);
      setFormData({ name: "", birthdate: "", phone: "", cardNumber: "" });

      // 🔥 予約完了後に Firestore の最新データを取得し、予約上限を再チェック
      setTimeout(() => {
        window.location.reload();
      }, 1000);
    } catch (error) {
      console.error("❌ Firestore へのデータ追加エラー:", error);
      alert("予約に失敗しました。もう一度試してください。");
    }
  };

  return (
    <div className="flex flex-col items-center justify-center p-4 w-full max-w-lg mx-auto">
      <h2 className="text-3xl font-bold text-center">けんおう皮フ科クリニック</h2>
      <h3 className="text-2xl font-semibold text-center">{type} 予約</h3>

      {isFull ? (
        <p className="text-xl text-red-600 font-bold">⛔ 本日の予約は満員です。</p>
      ) : receptionNumber ? (
        <div className="text-center">
          <p className="text-lg font-bold">予約が完了しました！</p>
          <p className="text-6xl font-extrabold text-blue-500 mt-4">{receptionNumber}</p>
          <div className="mt-6">
            <Link href="/">
              <div className="px-8 py-4 bg-blue-500 text-white text-center text-2xl font-bold rounded-lg hover:bg-blue-700 shadow-lg cursor-pointer">
                予約トップに戻る
              </div>
            </Link>
          </div>
        </div>
      ) : (
        <form className="flex flex-col gap-6 w-full max-w-md" onSubmit={handleSubmit}>
          <input type="text" placeholder="名前（カタカナ）" name="name" value={formData.name} onChange={handleChange} required className="border p-4 rounded-md w-full text-lg" />
          <BirthdateInput onChange={(value) => setFormData({ ...formData, birthdate: value })} />
          <input type="tel" placeholder="電話番号" name="phone" value={formData.phone} onChange={handleChange} required className="border p-4 rounded-md w-full text-lg" />
          <button
            type="submit"
            className={`px-8 py-6 text-2xl font-bold rounded-lg shadow-lg ${
              isFull ? "bg-gray-400 text-gray-600 cursor-not-allowed" : "bg-blue-500 text-white hover:bg-blue-700"
            }`}
            disabled={isFull}
          >
            予約する
          </button>
        </form>
      )}
    </div>
  );
}
