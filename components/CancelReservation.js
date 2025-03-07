import React, { useState } from "react";
import { db } from "../firebaseConfig";
import { collection, query, where, getDocs, updateDoc, doc } from "firebase/firestore";

const CancelReservation = () => {
  const [receptionNumber, setReceptionNumber] = useState("");
  const [message, setMessage] = useState("");

  const handleCancel = async (e) => {
    e.preventDefault();
    if (!receptionNumber) {
      setMessage("受付番号を入力してください。");
      return;
    }

    try {
      const q = query(collection(db, "reservations"), where("receptionNumber", "==", parseInt(receptionNumber)));
      const snapshot = await getDocs(q);

      if (snapshot.empty) {
        setMessage("該当する予約が見つかりません。");
        return;
      }

      const reservationDoc = snapshot.docs[0];
      await updateDoc(doc(db, "reservations", reservationDoc.id), { status: "キャンセル済み" });

      setMessage(`予約（受付番号: ${receptionNumber}）をキャンセルしました。`);
      setReceptionNumber("");
    } catch (error) {
      console.error("予約のキャンセルに失敗しました:", error);
      setMessage("キャンセル処理に失敗しました。もう一度お試しください。");
    }
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-screen p-4 w-full max-w-lg mx-auto">
      <h2 className="text-3xl font-bold text-center">予約キャンセル</h2>
      {message && <p className="text-center text-red-600 font-bold">{message}</p>}
      <form className="flex flex-col gap-4 w-full max-w-md" onSubmit={handleCancel}>
        <input
          type="number"
          placeholder="受付番号を入力"
          name="receptionNumber"
          value={receptionNumber}
          onChange={(e) => setReceptionNumber(e.target.value)}
          className="border p-3 rounded-md w-full"
          required
        />
        <button type="submit" className="w-full py-3 text-white bg-red-500 rounded-lg hover:opacity-80 text-lg">
          予約をキャンセルする
        </button>
      </form>
    </div>
  );
};

export default CancelReservation;
