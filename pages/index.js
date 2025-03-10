import React, { useState, useEffect } from "react";
import Link from "next/link";
import { db } from "../firebaseConfig";
import { collection, query, where, getDocs, doc, getDoc, onSnapshot } from "firebase/firestore";

export default function Home() {
  const [callingPatients, setCallingPatients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [isReservationOpen, setIsReservationOpen] = useState(true); // 🔥 予約受付の状態
  const [isFull, setIsFull] = useState(false); // 🔥 予約上限チェック
  const [maxReservations, setMaxReservations] = useState(10); // 🔥 予約上限を保存
  
  // 🔥 Firestore から「予約受付の状態」を取得
  useEffect(() => {
    const fetchReservationStatus = async () => {
      const settingsRef = doc(db, "settings", "clinic");
      const snapshot = await getDoc(settingsRef);
      if (snapshot.exists()) {
        setIsReservationOpen(snapshot.data().isReservationOpen);
      }
    };
    fetchReservationStatus();
  }, []);

  // 🔥 Firestore の「予約患者上限数」を取得
  useEffect(() => {
    const settingsRef = doc(db, "settings", "clinic");
  
    const unsubscribe = onSnapshot(settingsRef, (docSnapshot) => {
      if (docSnapshot.exists()) {
        const newMaxReservations = docSnapshot.data().maxReservationsPerDay || 10;
        setMaxReservations(newMaxReservations);
        console.log(`📡 Firestore 更新: maxReservationsPerDay = ${newMaxReservations}`); // 🔥 取得した値を確認
      } else {
        console.warn("⚠️ Firestore に `maxReservationsPerDay` のデータがありません！");
      }
    });
  
    return () => unsubscribe();
  }, []);
  // デバッグ
  useEffect(() => {
    console.log(`✅ デバッグ: maxReservations = ${maxReservations}`);
  }, [maxReservations]);
  

  // 🔥 Firestore の「予約患者上限数」をチェック
  useEffect(() => {
    const checkReservationLimit = async () => {
      try {
        const today = new Date().toISOString().split("T")[0]; // YYYY-MM-DD
        const q = query(collection(db, "reservations"), where("date", "==", today));
        const snapshotReservations = await getDocs(q);
        const todayReservations = snapshotReservations.size;
  
        console.log(`📡 予約数チェック: ${todayReservations} / ${maxReservations}`);
        
        const isFullStatus = todayReservations >= maxReservations;
        setIsFull(isFullStatus);
        console.log(`✅ isFull の値更新: ${isFullStatus}`);
        
      } catch (error) {
        console.error("❌ Firestore からのデータ取得エラー:", error);
      }
    };
  
    checkReservationLimit();
  }, [maxReservations]); // 🔥 `maxReservations` が変わるたびにチェック
  
  // デバッグ
  useEffect(() => {
    console.log(`✅ デバッグ用: isFull = ${isFull}, maxReservations = ${maxReservations}`);
  }, [isFull, maxReservations]);

  // 🔥 Firestore から「呼び出し中の患者情報」を取得
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

  useEffect(() => {
    fetchCallingPatients(); // 🔥 初回のみデータを取得（リアルタイムではない）
  }, []);

  return (
    <div className="flex flex-col items-center justify-center min-h-screen p-4">
      {/* 🔹 クリニックのロゴを追加 */}
      <img src="/logo.png" alt="けんおう皮フ科クリニック" className="w-40 h-40 mb-6" />

      <h1 className="text-4xl font-bold text-center mb-4">けんおう皮フ科クリニック 予約ページ</h1>

      {/* 🔥 呼び出し中の患者表示エリア */}
      <div className="text-center text-lg font-semibold mt-4">
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
      
      {/* 🔥 予約満員時のメッセージ表示 */}
      {isFull && (
  <p className="text-xl text-red-600 font-bold">⛔ 本日の予約は満員です。</p>
)}

      {/* 🔥 予約停止時のメッセージ表示 */}
      {!isReservationOpen && (
        <p className="text-xl text-red-600 font-bold mt-6">⛔ 現在、予約受付を停止しています。</p>
      )}

      <div className="flex flex-col gap-8 w-full max-w-md mt-6">
        {/* 🔹 予約ボタン（予約受付がONのときのみ表示） */}
        {isReservationOpen && (
          <>
            <Link href="/shoshin">
              <div className="px-8 py-6 bg-blue-500 text-white text-center text-2xl font-bold rounded-lg hover:bg-blue-700 shadow-lg cursor-pointer">
                初診予約はこちら
              </div>
            </Link>
            <Link href="/saishin">
              <div className="px-8 py-6 bg-green-500 text-white text-center text-2xl font-bold rounded-lg hover:bg-green-700 shadow-lg cursor-pointer">
                再診予約はこちら
              </div>
            </Link>
          </>
        )}

        {/* 🔹 予約確認 & キャンセルは常に表示 */}
        <Link href="/confirm">
          <div className="px-8 py-6 bg-red-500 text-white text-center text-2xl font-bold rounded-lg hover:bg-red-700 shadow-lg cursor-pointer">
            予約の確認・キャンセル
          </div>
        </Link>
      </div>
    </div>
  );
}
