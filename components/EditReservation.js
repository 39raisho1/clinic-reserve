import React, { useState } from "react";
import { db } from "../firebaseConfig";
import { collection, query, where, getDocs, updateDoc, doc } from "firebase/firestore";

const EditReservation = () => {
  const [receptionNumber, setReceptionNumber] = useState("");
  const [reservation, setReservation] = useState(null);
  const [message, setMessage] = useState("");
  const [newData, setNewData] = useState({
    name: "",
    birthdate: "",
    phone: "",
    cardNumber: "",
  });

  const handleSearch = async (e) => {
    e.preventDefault();
    setMessage("");

    try {
      const q = query(collection(db, "reservations"), where("receptionNumber", "==", parseInt(receptionNumber)));
      const snapshot = await getDocs(q);

      if (snapshot.empty) {
        setMessage("該当する予約が見つかりません。");
        return;
      }

      const reservationDoc = snapshot.docs[0];
      const reservationData = reservationDoc.data();

      setReservation({ id: reservationDoc.id, ...reservationData });
      setNewData({
        name: reservationData.name || "",
        birthdate: reservationData.birthdate || "",
        phone: reservationData.phone || "",
        cardNumber: reservationData.cardNumber || "",
      });
    } catch (error) {
      console.error("予約の取得に失敗しました:", error);
      setMessage("予約情報の取得に失敗しました。もう一度お試しください。");
    }
  };

  const handleUpdate = async (e) => {
    e.preventDefault();
    if (!reservation) return;
  
    // 更新データを格納するオブジェクト
    const updatedData = {};
    if (newData.name) updatedData.name = newData.name;
    if (newData.birthdate) updatedData.birthdate = newData.birthdate;
    if (reservation.type === "初診" && newData.phone) updatedData.phone = newData.phone;
    if (reservation.type === "再診" && newData.cardNumber) updatedData.cardNumber = newData.cardNumber;
  
    try {
      await updateDoc(doc(db, "reservations", reservation.id), updatedData);
      setMessage(`予約（受付番号: ${receptionNumber}）を更新しました。`);
      setReservation(null);
      setReceptionNumber("");
    } catch (error) {
      console.error("予約の更新に失敗しました:", error);
      setMessage("予約の更新に失敗しました。もう一度お試しください。");
    }
  };
  

  return (
    <div className="flex flex-col items-center justify-center min-h-screen p-4 w-full max-w-lg mx-auto">
      <h2 className="text-3xl font-bold text-center">予約変更</h2>
      {message && <p className={`text-center ${message.includes("失敗") ? "text-red-600" : "text-green-600"} font-bold`}>{message}</p>}

      {!reservation ? (
        <form className="flex flex-col gap-4 w-full max-w-md" onSubmit={handleSearch}>
          <input
            type="number"
            placeholder="受付番号"
            value={receptionNumber}
            onChange={(e) => setReceptionNumber(e.target.value)}
            className="border p-3 rounded-md w-full"
            required
          />
          <button type="submit" className="w-full py-3 text-white bg-blue-500 rounded-lg hover:opacity-80 text-lg">
            予約を検索
          </button>
        </form>
      ) : (
        <form className="flex flex-col gap-4 w-full max-w-md" onSubmit={handleUpdate}>
          <input
            type="text"
            placeholder="名前（カタカナ）"
            value={newData.name}
            onChange={(e) => setNewData({ ...newData, name: e.target.value })}
            className="border p-3 rounded-md w-full"
            required
          />
          <input
            type="date"
            placeholder="生年月日"
            value={newData.birthdate}
            onChange={(e) => setNewData({ ...newData, birthdate: e.target.value })}
            className="border p-3 rounded-md w-full"
            required
          />
          {reservation.type === "初診" && (
            <input
              type="tel"
              placeholder="電話番号"
              value={newData.phone}
              onChange={(e) => setNewData({ ...newData, phone: e.target.value })}
              className="border p-3 rounded-md w-full"
              required
            />
          )}
          {reservation.type === "再診" && (
            <input
              type="text"
              placeholder="診察券番号"
              value={newData.cardNumber}
              onChange={(e) => setNewData({ ...newData, cardNumber: e.target.value })}
              className="border p-3 rounded-md w-full"
              required
            />
          )}
          <button type="submit" className="w-full py-3 text-white bg-green-500 rounded-lg hover:opacity-80 text-lg">
            予約を更新
          </button>
        </form>
      )}
    </div>
  );
};

export default EditReservation;
