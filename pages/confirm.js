import React, { useState } from "react";
import { db } from "../firebaseConfig";
import { collection, query, where, getDocs, updateDoc, doc, serverTimestamp  } from "firebase/firestore";
import Link from "next/link";

export default function ConfirmPage() {
  const [formData, setFormData] = useState({ name: "", cardNumber: "" });
  const [reservation, setReservation] = useState(null);
  const [message, setMessage] = useState("");

  // 🔹 入力変更時の処理
  const handleChange = (e) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  // 🔹 予約を検索する関数
  const handleSearch = async (e) => {
    e.preventDefault();
    setMessage("");

    try {
      let q = query(collection(db, "reservations"), where("name", "==", formData.name));

      if (formData.cardNumber.trim() !== "") {
        q = query(collection(db, "reservations"), where("name", "==", formData.name), where("cardNumber", "==", formData.cardNumber));
      }

      const snapshot = await getDocs(q);

      if (snapshot.empty) {
        setMessage("該当する予約が見つかりません。");
        return;
      }

      const reservationDoc = snapshot.docs[0];
      setReservation({ id: reservationDoc.id, ...reservationDoc.data() });
    } catch (error) {
      console.error("予約の取得に失敗しました:", error);
      setMessage("予約情報の取得に失敗しました。もう一度お試しください。");
    }
  };

  // 🔹 予約をキャンセルする関数
  const handleCancel = async () => {
    if (!reservation) return;

    const confirmCancel = window.confirm(`受付番号 ${reservation.receptionNumber} の予約をキャンセルしますか？`);
    if (!confirmCancel) return;

    try {
      await updateDoc(doc(db, "reservations", reservation.id), {
       status:           "キャンセル済",
       canceledAt:       serverTimestamp()   // （必要なければ省いてOK）
     });
await updateDoc(doc(db, "reservations", reservation.id), { status: "キャンセル済" });

      setMessage(
     <div className="flex flex-col items-center text-center space-y-4 mt-6">
       <p className="text-2xl font-bold text-red-600">予約をキャンセルしました。</p>
       <p className="text-lg text-gray-700">必要であれば、もう一度予約をお願いいたします。</p>
       <Link
   href="/"
   className="inline-block px-6 py-3 bg-blue-500 text-white rounded-lg hover:bg-blue-700"
 >
   トップページへ戻る
</Link>
     </div>
   );

      setReservation(null);
      setFormData({ name: "", cardNumber: "" });
    } catch (error) {
      console.error("予約のキャンセルに失敗しました:", error);
      setMessage("キャンセル処理に失敗しました。もう一度お試しください。");
    }
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-screen p-4 w-full max-w-lg mx-auto">
      <img src="/logo.png" alt="けんおう皮フ科クリニック" className="w-40 h-40 mb-6" />
      <h2 className="text-3xl font-bold text-center">けんおう皮フ科クリニック</h2>
      <div className="mb-4">&nbsp;</div>
      <h3 className="text-2xl font-semibold text-center">予約確認 & キャンセル</h3>

{/* キャンセル完了メッセージがあるときだけ表示 */}
     {message && (
       <div className="text-center mt-4">
         {message}
       </div>
     )}



 {/* messageがない＆reservationもないときだけ、検索フォームを表示 */}
      {!message && !reservation && (
        <form className="flex flex-col gap-4 w-full max-w-md" onSubmit={handleSearch}>
          <input
            type="text"
            placeholder="名前（カタカナ）"
            name="name"
            value={formData.name}
            onChange={handleChange}
            className="border p-3 rounded-md w-full"
            required
          />
          <input
            type="text"
            placeholder="診察券番号（わからない場合は空欄可）"
            name="cardNumber"
            value={formData.cardNumber}
            onChange={handleChange}
            className="border p-3 rounded-md w-full"
          />
          <button type="submit" className="w-full py-3 text-white bg-blue-500 rounded-lg hover:bg-blue-700 text-lg">
            予約を検索
          </button>
          
 </form>
      )}

      {/* messageがない＆reservationがあるときだけ、予約詳細＋キャンセルボタンを表示 */}
      {!message && reservation && (
        <div className="text-center">
          <p className="text-lg font-bold">予約情報</p>
          <p className="text-6xl font-extrabold text-blue-500 mt-4">{reservation.receptionNumber}</p>
          <p className="text-lg mt-2">名前: {reservation.name}</p>
          <p className="text-lg">生年月日: {reservation.birthdate || reservation.birthdateShort}</p>
          <p className="text-lg">電話番号: {reservation.phone || "なし"}</p>
          <p className="text-lg">予約種別: {reservation.type}</p>
          <p className="text-lg">状態: {reservation.status}</p>
          <button onClick={handleCancel} className="w-full py-3 mt-4 text-white bg-red-500 rounded-lg hover:bg-red-700 text-lg">
            予約をキャンセルする
          </button>
        </div>
      )}
    </div>
  );
}
