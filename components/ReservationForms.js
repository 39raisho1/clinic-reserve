import React, { useState } from "react";
import { db } from "../firebaseConfig";
import { collection, addDoc, getDocs, query, orderBy, serverTimestamp } from "firebase/firestore";

// 初診予約フォーム
const ShoshinReservation = () => {
  const [formData, setFormData] = useState({ name: "", birthdate: "", phone: "" });
  const [message, setMessage] = useState("");

  const handleChange = (e) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      // 🔥 Firestore の `reservations` のデータ総数を取得
      const snapshot = await getDocs(collection(db, "reservations"));
      
      // 既存データの数 +1 で `orderIndex` を決定
      const orderIndex = snapshot.empty ? 1 : snapshot.size + 1;
  
      // 🔥 Firestore に新しい予約を追加（`orderIndex` を使う）
      await addDoc(collection(db, "reservations"), {
        type: "初診",
        name: formData.name,
        phone: formData.phone,
        receptionNumber: orderIndex, // 受付番号を「最後」に設定
        orderIndex, // 🔥 並び順を管理する新フィールド
        createdAt: new Date(), // `serverTimestamp()` ではなく `new Date()` を使用
      });
  
      setMessage(`予約完了！受付番号: ${orderIndex}`);
      setFormData({ name: "", phone: "" }); // フォームをリセット
    } catch (error) {
      console.error("Firestore 書き込みエラー:", error);
      setMessage("予約に失敗しました。");
    }
  };

  return (
    <div className="flex flex-col items-center justify-center p-4 w-full max-w-lg mx-auto">
      <h2 className="text-3xl font-bold text-center mb-4">初診予約</h2>
      {message && <p className="text-center text-green-600">{message}</p>}
      <form className="flex flex-col gap-4 w-full max-w-md" onSubmit={handleSubmit}>
        <input type="text" placeholder="名前（カタカナ）" name="name" value={formData.name} onChange={handleChange} required className="border p-3 rounded-md w-full" />
        <input type="date" placeholder="生年月日" name="birthdate" value={formData.birthdate} onChange={handleChange} required className="border p-3 rounded-md w-full" />
        <input type="tel" placeholder="電話番号" name="phone" value={formData.phone} onChange={handleChange} required className="border p-3 rounded-md w-full" />
        <button type="submit" className="px-6 py-3 bg-blue-500 text-white rounded-lg hover:bg-blue-700">予約する</button>
      </form>
    </div>
  );
};

// 再診予約フォーム
const SaishinReservation = () => {
  const [formData, setFormData] = useState({ name: "", cardNumber: "" });
  const [message, setMessage] = useState("");

  const handleChange = (e) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      // Firestore の `reservations` のデータ総数を取得（orderBy を使わず、データ数で `orderIndex` を決定）
      const snapshot = await getDocs(collection(db, "reservations"));
      const orderIndex = snapshot.empty ? 1 : snapshot.size + 1; // 既存データの数 +1 で並び順を決定
  
      // Firestore に新しい予約を追加（`createdAt` ではなく `orderIndex` を基準にする）
      await addDoc(collection(db, "reservations"), {
        type: "再診",
        name: formData.name,
        cardNumber: formData.cardNumber || "", // 診察券番号
        phone: formData.phone,
        receptionNumber: orderIndex, // 受付番号を「最後」に設定
        orderIndex, // Firestore の取得順を強制するための並び順フィールド
        createdAt: new Date(), // `serverTimestamp()` ではなく `new Date()` を使用
      });
  
      setMessage(`予約完了！受付番号: ${orderIndex}`);
      setFormData({ name: "", cardNumber: "", phone: "" }); // フォームをリセット
    } catch (error) {
      console.error("Firestore 書き込みエラー:", error);
      setMessage("予約に失敗しました。");
    }
  };
  
  
  

  return (
    <div className="flex flex-col items-center justify-center p-4 w-full max-w-lg mx-auto">
      <h2 className="text-3xl font-bold text-center mb-4">再診予約</h2>
      {message && <p className="text-center text-green-600">{message}</p>}
      <form className="flex flex-col gap-4 w-full max-w-md" onSubmit={handleSubmit}>
        <input type="text" placeholder="名前（カタカナ）" name="name" value={formData.name} onChange={handleChange} required className="border p-3 rounded-md w-full" />
        <input type="text" placeholder="診察券番号（空欄可）" name="cardNumber" value={formData.cardNumber} onChange={handleChange} className="border p-3 rounded-md w-full" />
        <button type="submit" className="px-6 py-3 bg-green-500 text-white rounded-lg hover:bg-green-700">予約する</button>
      </form>
    </div>
  );
};

export { ShoshinReservation, SaishinReservation };
