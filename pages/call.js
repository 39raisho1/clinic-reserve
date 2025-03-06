import React, { useEffect, useState } from "react";
import { db } from "../firebase";
import { collection, onSnapshot, query, where, orderBy, limit, doc, getDoc } from "firebase/firestore";

export default function CallScreen() {
  const [currentCalls, setCurrentCalls] = useState([]);
  const [callLimit, setCallLimit] = useState(1); // デフォルトで1人

  useEffect(() => {
    console.log("📡 Firestore 監視を開始...");

    // 🔹 Firestore から「呼び出し患者数」の設定を取得
    const fetchCallLimit = async () => {
      const settingsRef = doc(db, "settings", "config");
      const settingsSnap = await getDoc(settingsRef);
      if (settingsSnap.exists()) {
        setCallLimit(settingsSnap.data().callCount || 1);
      }
    };

    fetchCallLimit();

    // 🔹 Firestore の `reservations` コレクションから「呼び出し中」の患者を取得
    const callQuery = query(
      collection(db, "reservations"),
      where("status", "==", "呼び出し中"),
      orderBy("timestamp", "asc"),
      limit(callLimit)
    );

    const unsubscribeCall = onSnapshot(callQuery, (snapshot) => {
      const callList = snapshot.docs.map(doc => doc.data());
      setCurrentCalls(callList);
    });

    return () => {
      unsubscribeCall();
    };
  }, [callLimit]);

  return (
    <div className="h-screen flex flex-col items-center justify-center bg-blue-500 text-white text-center">
      <h1 className="text-6xl font-bold mb-12">呼び出し中の方</h1>
      
      {currentCalls.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-12">
          {currentCalls.map((call, index) => (
            <div key={index} className="p-16 bg-white text-black rounded-2xl shadow-xl flex items-center justify-center">
              <p className="text-8xl font-extrabold">{call.reservationNumber}</p>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-4xl font-bold">現在呼び出し中の患者はいません。</p>
      )}
    </div>
  );
}
