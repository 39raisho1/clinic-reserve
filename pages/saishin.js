import React, { useState } from "react";
import { db } from "../firebaseConfig";
import { collection, addDoc, getDocs, query, orderBy, serverTimestamp } from "firebase/firestore";

export default function SaishinPage() {
  const [formData, setFormData] = useState({ name: "", cardNumber: "" });
  const [receptionNumber, setReceptionNumber] = useState(null);

  const handleChange = (e) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      const q = query(collection(db, "reservations"), orderBy("receptionNumber", "desc"));
      const snapshot = await getDocs(q);
      const newReceptionNumber = snapshot.empty ? 1 : snapshot.docs[0].data().receptionNumber + 1;

      await addDoc(collection(db, "reservations"), {
        type: "再診",
        name: formData.name,
        cardNumber: formData.cardNumber || "",
        receptionNumber: newReceptionNumber,
        createdAt: serverTimestamp(),
      });

      setReceptionNumber(newReceptionNumber);
      setFormData({ name: "", cardNumber: "" });
    } catch (error) {
      console.error("Firestore 書き込みエラー:", error);
    }
  };

  return (
    <div className="flex flex-col items-center justify-center p-4 w-full max-w-lg mx-auto">
      <img src="/logo.png" alt="けんおう皮フ科クリニック" className="w-40 h-40 mb-6" />

      <h2 className="text-3xl font-bold text-center">けんおう皮フ科クリニック</h2>
      <div className="mb-4">&nbsp;</div> {/* 🔹 改行を追加 */}
      <h3 className="text-2xl font-semibold text-center">再診予約</h3>

      {receptionNumber ? (
        <div className="text-center">
          <p className="text-lg font-bold">予約が完了しました！</p>
          <p className="text-6xl font-extrabold text-green-500 mt-4">{receptionNumber}</p>
          <p className="text-sm text-gray-600 mt-2">
            受付番号を忘れないよう、スクリーンショットを撮るかメモをお取りください。
          </p>
        </div>
      ) : (
        <form className="flex flex-col gap-6 w-full max-w-md" onSubmit={handleSubmit}>
          <input type="text" placeholder="名前（カタカナ）" name="name" value={formData.name} onChange={handleChange} required className="border p-4 rounded-md w-full text-lg" />
          <input type="text" placeholder="診察券番号（空欄可）" name="cardNumber" value={formData.cardNumber} onChange={handleChange} className="border p-4 rounded-md w-full text-lg" />
          <button type="submit" className="px-8 py-6 bg-green-500 text-white text-2xl font-bold rounded-lg hover:bg-green-700 shadow-lg">予約する</button>
        </form>
      )}
    </div>
  );
}
