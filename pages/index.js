import React, { useState, useEffect } from "react";
import Link from "next/link";
import { db } from "../firebaseConfig";
import { collection, query, where, doc,getDocs,onSnapshot } from "firebase/firestore";

export default function Home() {
  const [callingPatients, setCallingPatients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [isReservationOpen, setIsReservationOpen] = useState(true); // 🔥 予約受付の状態
  const [isFull, setIsFull] = useState(false); // 🔥 予約上限チェック
  const [maxReservations, setMaxReservations] = useState(null);
  

  // 🔥 Firestore の「予約患者上限数」を取得
// ① 設定ドキュメント（isReservationOpen と maxReservations）を購読
useEffect(() => {
  const settingsRef = doc(db, "settings", "clinic");
  const unsub = onSnapshot(settingsRef, snap => {
    if (!snap.exists()) return;
    const { isReservationOpen, maxReservationsPerDay } = snap.data();
    setIsReservationOpen(isReservationOpen);
    setMaxReservations(maxReservationsPerDay ?? 10);
  });
  return () => unsub();
}, []);


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

      
 {/* 🔥 受付停止 or 満員のメッセージ */}
 {(!loading && (isFull || !isReservationOpen)) && (
   <p className="text-xl text-red-600 font-bold mt-6">
     ⛔ 現在、予約受付を停止しています。
     {isFull && " 本日の予約上限に達しました。"}
   </p>
 )}

      <div className="flex flex-col gap-8 w-full max-w-md mt-6">
        {/* 🔹 予約ボタン（予約受付がONのときのみ表示） */}
        {isReservationOpen && (
          <>
            <Link href="/shoshin">
              <div className="px-8 py-6 bg-blue-500 text-white text-center text-2xl font-bold rounded-lg hover:bg-blue-700 shadow-lg cursor-pointer">
                初めての方
              </div>
            </Link>
            <Link href="/saishin">
              <div className="px-8 py-6 bg-green-500 text-white text-center text-2xl font-bold rounded-lg hover:bg-green-700 shadow-lg cursor-pointer">
                以前受診されたことのある方
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
<br></br>
当院の診察は当日のみの順番予約制となります。<br></br>
診察順番予約は予約可能時間内のみ順番で予約をお取りすることができます。<br></br>
<br></br>
 <br></br>

月、木、金、土、日(月に1～2回)<br></br>
午前 8時30分～12時30分<br></br>

午後 14時30分～18時00分<br></br>
 <br></br>
診療時間外にはご予約をお取りできません。<br></br>
当日午前または午後の予約人数が上限に達しますと、予約受付が停止いたします。<br></br>
予約人数が上限に達し、予約停止後でも、診療時間内に直接ご来院いただければ診察いたします。<br></br>
    </div>
  );
}
