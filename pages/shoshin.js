import React, { useState, useEffect } from "react";
import { db } from "../firebaseConfig";
import { collection, addDoc, getDocs, query, where, serverTimestamp, doc, getDoc, orderBy } from "firebase/firestore";
import BirthdateInput from "../components/BirthdateInput"; // 🔥 生年月日入力コンポーネント
import Link from "next/link";

export default function ShoshinPage() {
  const [formData, setFormData] = useState({ name: "", birthdate: "", phone: "" });
  const [receptionNumber, setReceptionNumber] = useState(null);
  const [callingPatients, setCallingPatients] = useState([]);
  const [loading, setLoading] = useState(true);

  const handleChange = (e) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
  
    // 🔥 `type` を明示的に定義
    const type = "初診"; // 🔥 `shoshin.js` では `初診` と固定
    const todayDate = new Date().toISOString().split("T")[0]; // YYYY-MM-DD
  
    try {
      console.log("📡 Firestore に予約データを追加...");
      const q = query(collection(db, "reservations"), orderBy("receptionNumber", "desc"));
      const snapshot = await getDocs(q);
      const newReceptionNumber = snapshot.empty ? 1 : (snapshot.docs[0].data()?.receptionNumber || 0) + 1;
  
      console.log(`📡 予約の日付 (date): ${todayDate}`);
  
      await addDoc(collection(db, "reservations"), {
        type,
        name: formData.name,
        birthdate: formData.birthdate,
        phone: formData.phone,
        cardNumber: formData.cardNumber || "",
        receptionNumber: newReceptionNumber,
        date: todayDate, // 🔥 予約の日付を `YYYY-MM-DD` 形式で保存
        status: "未受付",
        createdAt: serverTimestamp(),
      });
  
      console.log(`✅ 予約完了！受付番号: ${newReceptionNumber} (date: ${todayDate})`);
      setReceptionNumber(newReceptionNumber);
      setFormData({ name: "", birthdate: "", phone: "", cardNumber: "" });
    } catch (error) {
      console.error("❌ Firestore へのデータ追加エラー:", error);
      alert("予約に失敗しました。もう一度試してください。");
    }
  };
  

  // 🔥 Firestore から「呼び出し中の患者情報」を取得（番号順に並べる）
  const fetchCallingPatients = async () => {
    console.log("📡 Firestore から呼び出し中の患者情報を取得");

    const callQuery = query(
      collection(db, "reservations"),
      where("status", "==", "呼び出し中")
    );

    try {
      const snapshot = await getDocs(callQuery);
      let callList = snapshot.docs.map(doc => ({
        id: doc.id,
        receptionNumber: doc.data().receptionNumber ?? "未設定"
      }));

      // 🔥 `receptionNumber` の昇順に並べ替え
      callList.sort((a, b) => a.receptionNumber - b.receptionNumber);

      console.log("📡 Firestore から取得したデータ（並べ替え後）:", callList); // 🔥 デバッグ用

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
      <h3 className="text-2xl font-semibold text-center">初診予約</h3>

      {receptionNumber ? (
        <div className="text-center">
          <p className="text-lg font-bold">予約が完了しました！</p>
          <p className="text-6xl font-extrabold text-blue-500 mt-4">{receptionNumber}</p>
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
          <BirthdateInput onChange={(value) => setFormData({ ...formData, birthdate: value })} />
          <input type="tel" placeholder="電話番号" name="phone" value={formData.phone} onChange={handleChange} required className="border p-4 rounded-md w-full text-lg" />
          <button type="submit" className="px-8 py-6 bg-blue-500 text-white text-2xl font-bold rounded-lg hover:bg-blue-700 shadow-lg">予約する</button>
        </form>
      )}
    </div>
  );
}
