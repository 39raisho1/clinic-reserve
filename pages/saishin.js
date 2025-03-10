import React, { useState, useEffect } from "react";
import { db } from "../firebaseConfig";
import { collection, addDoc, getDocs, query, where, serverTimestamp } from "firebase/firestore";
import Link from "next/link";

export default function SaishinPage() {
  const [formData, setFormData] = useState({ name: "", cardNumber: "" });
  const [receptionNumber, setReceptionNumber] = useState(null);
  const [callingPatients, setCallingPatients] = useState([]);
  const [loading, setLoading] = useState(true);

  const handleChange = (e) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      const snapshot = await getDocs(collection(db, "reservations"));
      const newReceptionNumber = snapshot.empty ? 1 : (snapshot.size + 1);
      const todayDate = new Date().toISOString().split("T")[0]; // YYYY-MM-DD
      console.log(`📡 予約の日付 (date): ${todayDate}`);
      console.log(`📡 デバッグ: name = ${formData.name}, phone = ${formData.phone}`);
  
      await addDoc(collection(db, "reservations"), {
        type: "再診",
        name: formData.name,
        phone: formData.phone || "不明",
        cardNumber: formData.cardNumber || "",
        receptionNumber: newReceptionNumber,
        date: todayDate,
        status: "未受付",
        createdAt: serverTimestamp(),
      });
  
      setReceptionNumber(newReceptionNumber);
      setFormData({ name: "", phone: "", cardNumber: "" });
  
      fetchCallingPatients();
    } catch (error) {
      console.error("Firestore 書き込みエラー:", error);
      alert("予約に失敗しました。もう一度試してください。");
    }
  };
  

  // 🔥 Firestore から「呼び出し中の患者情報」を取得（番号順に並べる）
  const fetchCallingPatients = async () => {
    console.log("📡 Firestore から呼び出し中の患者情報を取得");

    const callQuery = query(
      collection(db, "reservations"),
      where("status", "==", "呼び出し中") // 🔥 `orderBy()` を使わず `sort()` で昇順に並べる
    );

    try {
      const snapshot = await getDocs(callQuery);
      let callList = snapshot.docs.map(doc => ({
        id: doc.id,
        receptionNumber: doc.data().receptionNumber ?? "未設定"
      }));

      // 🔥 `receptionNumber` の昇順に並べ替え
      callList.sort((a, b) => a.receptionNumber - b.receptionNumber);

      if (callList.length > 0) {
        setCallingPatients(callList);
      } else {
        setCallingPatients([]);
      }
    } catch (error) {
      console.error("Firestore からのデータ取得に失敗:", error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col items-center justify-center p-4 w-full max-w-lg mx-auto">
      <img src="/logo.png" alt="けんおう皮フ科クリニック" className="w-40 h-40 mb-6" />

      <h2 className="text-3xl font-bold text-center">けんおう皮フ科クリニック</h2>
      <h3 className="text-2xl font-semibold text-center">再診予約</h3>

      {receptionNumber ? (
        <div className="text-center">
          <p className="text-lg font-bold">予約が完了しました！</p>
          <p className="text-6xl font-extrabold text-green-500 mt-4">{receptionNumber}</p>
          <p className="text-sm text-gray-600 mt-2">
            受付番号を忘れないよう、スクリーンショットを撮るかメモをお取りください。
          </p>

          {/* 🔹 予約トップページに戻るボタン（青） */}
          <div className="mt-6">
            <Link href="/">
              <div className="px-8 py-4 bg-blue-500 text-white text-center text-2xl font-bold rounded-lg hover:bg-blue-700 shadow-lg cursor-pointer">
                予約トップに戻る
              </div>
            </Link>
          </div>

          {/* 🔥 予約完了画面の一番下に「呼び出し中の患者情報」を表示（番号昇順） */}
          <div className="text-center text-lg font-semibold mt-12">
            <p className="text-gray-700 text-2xl">現在お呼び出し中の方</p>

            {loading ? (
              <p className="text-gray-500 mt-4 text-xl">データを取得中...</p>
            ) : callingPatients.length > 0 ? (
              <div className="bg-gradient-to-r from-blue-600 to-blue-400 p-6 rounded-2xl shadow-xl text-white text-2xl font-bold mt-4 w-full max-w-lg">
                <div className="grid grid-cols-2 md:grid-cols-3 gap-6 justify-center">
                  {callingPatients.map((patient) => (
                    <div key={patient.id} className="bg-white text-blue-600 px-8 py-4 rounded-xl shadow-lg text-6xl font-bold flex items-center justify-center">
                      {patient.receptionNumber}
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <p className="text-gray-500 mt-4 text-xl">現在呼び出し中の方はいません</p>
            )}
          </div>
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
