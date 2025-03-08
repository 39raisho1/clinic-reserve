import React, { useState } from "react";
import { db } from "../firebaseConfig";
import { collection, addDoc, getDocs } from "firebase/firestore";

// 生年月日入力コンポーネント
const BirthdateInput = ({ onChange }) => {
  const [birthdate, setBirthdate] = useState("");

  const formatDate = (input) => {
    input = input.replace(/[０-９]/g, (s) => String.fromCharCode(s.charCodeAt(0) - 65248)); // 全角を半角に変換
    let numbersOnly = input.replace(/\D/g, ""); // 数字以外を削除
    if (numbersOnly.length > 8) numbersOnly = numbersOnly.slice(0, 8);

    let formatted = numbersOnly;
    if (numbersOnly.length >= 4) formatted = numbersOnly.slice(0, 4) + "/";
    if (numbersOnly.length >= 6) formatted += numbersOnly.slice(4, 6) + "/";
    if (numbersOnly.length >= 8) formatted += numbersOnly.slice(6, 8);

    setBirthdate(formatted);
    onChange(formatted);
  };

  const validateDate = (dateStr) => {
    const match = dateStr.match(/^(\d{4})\/(\d{2})\/(\d{2})$/);
    if (!match) return false;
    const [_, year, month, day] = match.map(Number);
    const inputDate = new Date(year, month - 1, day);
    if (inputDate.getFullYear() !== year || inputDate.getMonth() + 1 !== month || inputDate.getDate() !== day) return false;
    return inputDate <= new Date();
  };

  return (
    <input
      type="text"
      inputMode="numeric"
      placeholder="YYYY/MM/DD"
      value={birthdate}
      onChange={(e) => formatDate(e.target.value)}
      onBlur={() => {
        if (!validateDate(birthdate)) {
          alert("無効な日付です。正しい生年月日を入力してください。");
          setBirthdate("");
        }
      }}
      maxLength={10}
      className="border p-3 rounded-md w-full"
    />
  );
};

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
      const snapshot = await getDocs(collection(db, "reservations"));
      const orderIndex = snapshot.empty ? 1 : snapshot.size + 1;
  
      await addDoc(collection(db, "reservations"), {
        type: "初診",
        name: formData.name,
        birthdate: formData.birthdate, // 🔥 生年月日を保存
        phone: formData.phone,
        receptionNumber: orderIndex,
        orderIndex,
        createdAt: new Date(),
      });
  
      setMessage(`予約完了！受付番号: ${orderIndex}`);
      setFormData({ name: "", birthdate: "", phone: "" }); // フォームリセット
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
        
        {/* 生年月日入力をカスタムコンポーネントに変更 */}
        <BirthdateInput onChange={(value) => setFormData({ ...formData, birthdate: value })} />
        
        <input type="tel" placeholder="電話番号" name="phone" value={formData.phone} onChange={handleChange} required className="border p-3 rounded-md w-full" />
        <button type="submit" className="px-6 py-3 bg-blue-500 text-white rounded-lg hover:bg-blue-700">予約する</button>
      </form>
    </div>
  );
};

// 再診予約フォーム（変更なし）
const SaishinReservation = () => {
  const [formData, setFormData] = useState({ name: "", cardNumber: "" });
  const [message, setMessage] = useState("");

  const handleChange = (e) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      const snapshot = await getDocs(collection(db, "reservations"));
      const orderIndex = snapshot.empty ? 1 : snapshot.size + 1;
  
      await addDoc(collection(db, "reservations"), {
        type: "再診",
        name: formData.name,
        cardNumber: formData.cardNumber || "",
        receptionNumber: orderIndex,
        orderIndex,
        createdAt: new Date(),
      });
  
      setMessage(`予約完了！受付番号: ${orderIndex}`);
      setFormData({ name: "", cardNumber: "" });
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
