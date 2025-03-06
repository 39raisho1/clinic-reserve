import { useState } from "react";
import { db } from "../firebase";
import { collection, addDoc, getDocs, serverTimestamp } from "firebase/firestore";

export default function Home() {
  const [name, setName] = useState("");
  const [birthdate, setBirthdate] = useState("");
  const [success, setSuccess] = useState(false);
  const [reservationNumber, setReservationNumber] = useState(null);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!name || !birthdate) {
      alert("名前（カタカナ）と生年月日を入力してください！");
      return;
    }

    try {
      const querySnapshot = await getDocs(collection(db, "reservations"));
      const newReservationNumber = querySnapshot.size + 1;

      await addDoc(collection(db, "reservations"), {
        name: name,
        birthdate: birthdate,
        reservationNumber: newReservationNumber,
        status: "受付済み",
        timestamp: serverTimestamp(),
      });

      setReservationNumber(newReservationNumber);
      setSuccess(true);
    } catch (error) {
      console.error("予約の保存に失敗しました", error);
      alert("予約の保存に失敗しました。もう一度試してください。");
    }
  };

  return (
    <div className="max-w-lg mx-auto p-6 bg-white shadow-md rounded-lg">
      <h1 className="text-xl font-bold mb-4 text-center whitespace-nowrap">
        けんおう皮フ科クリニック予約サイト
      </h1>

      {!success ? (
        <form onSubmit={handleSubmit}>
          <div className="mb-4">
            <label className="block text-sm font-medium">名前（カタカナ）</label>
            <input
              type="text"
              className="border p-2 w-full rounded"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="ヤマダ タロウ"
              required
            />
          </div>

          <div className="mb-4">
            <label className="block text-sm font-medium">生年月日</label>
            <input
              type="date"
              className="border p-2 w-full rounded"
              value={birthdate}
              onChange={(e) => setBirthdate(e.target.value)}
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
