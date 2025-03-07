import React, { useState } from "react";
import { db } from "../firebaseConfig";
import { collection, addDoc, getDocs, query, orderBy, serverTimestamp } from "firebase/firestore";

// 共通の入力フィールド
const InputField = ({ type, placeholder, name, value, onChange, required }) => {
  return (
    <input
      type={type}
      placeholder={placeholder}
      name={name}
      value={value}
      onChange={onChange}
      className="border p-3 rounded-md w-full"
      required={required}
    />
  );
};

// 送信ボタン
const SubmitButton = ({ label, color }) => {
  return (
    <button type="submit" className={`w-full py-3 text-white ${color} rounded-lg hover:opacity-80 text-lg`}>
      {label}
    </button>
  );
};

// 受付番号の生成
const generateReceptionNumber = async () => {
  try {
    const q = query(collection(db, "reservations"), orderBy("receptionNumber", "desc"));
    const snapshot = await getDocs(q);
    return snapshot.empty ? 1 : snapshot.docs[0].data().receptionNumber + 1;
  } catch (error) {
    console.error("受付番号の取得に失敗しました:", error);
    return null;
  }
};

// 🔹 **初診予約フォーム**
const ShoshinReservation = () => {
  const [formData, setFormData] = useState({ name: "", birthdate: "", phone: "" });
  const [message, setMessage] = useState("");

  const handleChange = (e) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const receptionNumber = await generateReceptionNumber();

    if (receptionNumber === null) {
      setMessage("予約システムに問題が発生しました。時間をおいて再度お試しください。");
      return;
    }

    try {
      await addDoc(collection(db, "reservations"), {
        type: "初診",
        name: formData.name,
        birthdate: formData.birthdate,
        phone: formData.phone,
        cardNumber: "",
        receptionNumber: receptionNumber,
        createdAt: serverTimestamp(),
      });
      setMessage(`予約が完了しました！ 受付番号: ${receptionNumber}`);
      setFormData({ name: "", birthdate: "", phone: "" });
    } catch (error) {
      console.error("Firestore 書き込みエラー:", error);
      setMessage("予約に失敗しました。もう一度お試しください。");
    }
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-screen p-4 w-full max-w-lg mx-auto">
      <img src="/logo.png" alt="けんおう皮フ科クリニック" className="w-24 h-24 mb-4" />
      <h2 className="text-3xl font-bold text-center">けんおう皮フ科クリニック</h2>
      <div className="mb-4">&nbsp;</div> {/* 🔹 追加した改行 */}
      <h3 className="text-2xl font-semibold text-center">初診予約</h3>
      {message && <p className="text-center text-green-600 font-bold">{message}</p>}
      <form className="flex flex-col gap-4 w-full max-w-md" onSubmit={handleSubmit}>
        <InputField type="text" placeholder="名前（カタカナ）" name="name" value={formData.name} onChange={handleChange} required />
        <InputField type="date" placeholder="生年月日" name="birthdate" value={formData.birthdate} onChange={handleChange} required />
        <InputField type="tel" placeholder="電話番号" name="phone" value={formData.phone} onChange={handleChange} required />
        <SubmitButton label="予約する" color="bg-blue-500" />
      </form>
    </div>
  );
};

// 🔹 **再診予約フォーム**
const SaishinReservation = () => {
  const [formData, setFormData] = useState({ name: "", cardNumber: "" });
  const [message, setMessage] = useState("");

  const handleChange = (e) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const receptionNumber = await generateReceptionNumber();

    if (receptionNumber === null) {
      setMessage("予約システムに問題が発生しました。時間をおいて再度お試しください。");
      return;
    }

    try {
      await addDoc(collection(db, "reservations"), {
        type: "再診",
        name: formData.name,
        cardNumber: formData.cardNumber || "",
        receptionNumber: receptionNumber,
        createdAt: serverTimestamp(),
      });
      setMessage(`予約が完了しました！ 受付番号: ${receptionNumber}`);
      setFormData({ name: "", cardNumber: "" });
    } catch (error) {
      console.error("Firestore 書き込みエラー:", error);
      setMessage("予約に失敗しました。もう一度お試しください。");
    }
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-screen p-4 w-full max-w-lg mx-auto">
      <img src="/logo.png" alt="けんおう皮フ科クリニック" className="w-24 h-24 mb-4" />
      <h2 className="text-3xl font-bold text-center">けんおう皮フ科クリニック</h2>
      <div className="mb-4">&nbsp;</div> {/* 🔹 追加した改行 */}
      <h3 className="text-2xl font-semibold text-center">再診予約</h3>
      {message && <p className="text-center text-green-600 font-bold">{message}</p>}
      <form className="flex flex-col gap-4 w-full max-w-md" onSubmit={handleSubmit}>
        <InputField type="text" placeholder="名前（カタカナ）" name="name" value={formData.name} onChange={handleChange} required />
        <InputField type="text" placeholder="診察券番号（わからない場合は空欄可）" name="cardNumber" value={formData.cardNumber} onChange={handleChange} />
        <SubmitButton label="予約する" color="bg-green-500" />
      </form>
    </div>
  );
};

// 🔹 ここでエクスポート
export { ShoshinReservation, SaishinReservation };
