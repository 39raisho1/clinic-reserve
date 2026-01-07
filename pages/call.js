import React, { useEffect, useState } from "react";
import { db } from "../firebaseConfig";
import { collection, onSnapshot, query, where } from "firebase/firestore";

export default function CallScreen() {
  const [currentCalls, setCurrentCalls] = useState([]);

  useEffect(() => {
    console.log("📡 Firestore 監視を開始...");

    // 🔹 Firestore の `reservations` コレクションをリアルタイム監視
    const callQuery = query(
      collection(db, "reservations"),
      where("status", "==", "呼び出し中")
    );

    const unsubscribeCall = onSnapshot(callQuery, (snapshot) => {
      let callList = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data(),
        receptionNumber: typeof doc.data().receptionNumber === "number" 
          ? doc.data().receptionNumber 
          : parseInt(doc.data().receptionNumber) || 9999 // 🔥 文字列を数値に変換
      }));

      // 🔹 受付番号の昇順にソート
      callList.sort((a, b) => a.receptionNumber - b.receptionNumber);

      console.log("📡 呼び出し中の患者一覧:", callList);
      setCurrentCalls(callList);
    });

    return () => {
      console.log("📡 Firestore 監視を解除");
      unsubscribeCall();
    };
  }, []);

  return (
    <div className="h-screen flex flex-col items-center justify-center bg-blue-500 text-white text-center">
      <h1 className="text-8xl font-bold mb-12">呼び出し中の方</h1>
      
{currentCalls.length > 0 ? (
  <>
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-12">
      {currentCalls.map((call) => (
        <div
          key={call.id}
          className="p-16 bg-white text-black rounded-2xl shadow-xl flex items-center justify-center"
        >
          <p className="text-9xl font-extrabold">{call.receptionNumber}</p>
        </div>
      ))}
    </div>
    {/* ↑ ここまでグリッド */}
    {/* ↓ グリッド全体の下に一度だけ案内文を表示 */}
    <p className="mt-12 text-8xl font-bold text-white text-center">
      中待合へどうぞ
    </p>
  </>
) : (
  <p className="text-8xl font-bold">現在呼び出し中の方はいません。</p>
)}

    </div>
  );
}
