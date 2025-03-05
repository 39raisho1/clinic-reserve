import { useState } from "react";
import { db } from "../firebase"; // Firebase をインポート
import { collection, addDoc, getDocs, serverTimestamp } from "firebase/firestore";

export default function Home() {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [success, setSuccess] = useState(false);
  const [reservationNumber, setReservationNumber] = useState(null);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!name || !phone) {
      alert("名前と電話番号を入力してください！");
      return;
    }

    try {
      // 🔹 現在の予約数を取得し、予約番号を決定
      const querySnapshot = await getDocs(collection(db, "reservations"));
      const newReservationNumber = querySnapshot.size + 1; // 予約件数 +1 を予約番号とする

      // 🔹 Firestore に予約データを追加
      const docRef = await addDoc(collection(db, "reservations"), {
        name: name,
        phone: phone,
        reservationNumber: newReservationNumber, // 予約番号を追加
        timestamp: serverTimestamp(), // 予約時間を記録
      });

      setReservationNumber(newReservationNumber); // 予約番号を画面に表示
      setSuccess(true);
    } catch (error) {
      console.error("予約の保存に失敗しました", error);
      alert("予約の保存に失敗しました。もう一度試してください。");
    }
  };

  return (
    <div className="max-w-md mx-auto p-6 bg-white shadow-md rounded-lg">
      <h1 className="text-2xl font-bold mb-4">予約システム</h1>

      {!success ? (
        <form onSubmit={handleSubmit}>
          <div className="mb-4">
            <label className="block text-sm font-medium">名前</label>
            <input
              type="text"
              className="border p-2 w-full rounded"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </div>

          <div className="mb-4">
            <label className="block text-sm font-medium">電話番号</label>
            <input
              type="tel"
              className="border p-2 w-full rounded"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              required
            />
          </div>

          <button
            type="submit"
            className="bg-blue-500 text-white p-2 rounded w-full"
          >
            予約する
          </button>
        </form>
      ) : (
        <div className="text-center text-green-500 font-bold text-lg">
          <p>予約が完了しました！</p>
          <p>あなたの受付番号: <span className="text-2xl">{reservationNumber}</span></p>
        </div>
      )}
    </div>
  );
}
