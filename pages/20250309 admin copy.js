import React, { useEffect, useState, useMemo } from "react";
import { db } from "../firebaseConfig";
import { 
  collection, onSnapshot, query, orderBy, updateDoc, doc, deleteDoc, addDoc, getDocs 
} from "firebase/firestore";
import Papa from "papaparse";

export default function AdminPage() {
  const [reservations, setReservations] = useState([]);
  const [sortConfig, setSortConfig] = useState({ key: "receptionNumber", direction: "asc" });
  const [selectedReservations, setSelectedReservations] = useState([]);

  const [isMinimized, setIsMinimized] = useState(false);

// 自動更新ボタンのオンオフ
  const [isAutoLoad, setIsAutoLoad] = useState(true); // 🔥 Firestore の自動更新のオン/オフ状態

  useEffect(() => {
    console.log("📡 Firestore 監視を開始...");
    const q = query(collection(db, "reservations"), orderBy("receptionNumber", "asc"));
  
    const unsubscribe = onSnapshot(q, (snapshot) => {
      console.log(`📡 Firestore から ${snapshot.docs.length} 件のデータを取得`);
  
      if (snapshot.docs.length > 0) {
        let data = snapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data(),
          createdAt: doc.data().createdAt ? doc.data().createdAt.toDate() : new Date(),
        }));
  
        console.log("📡 Firestoreから取得したデータ:", data);
        setReservations(data);
  
        // 🔥 受付状態のカウントをリアルタイム更新
        const counts = {
          "未受付": data.filter(r => r.status === "未受付").length,
          "受付済": data.filter(r => r.status === "受付済").length,
          "呼び出し中": data.filter(r => r.status === "呼び出し中").length,
          "診察中": data.filter(r => r.status === "診察中").length,
          "診察終了": data.filter(r => r.status === "診察終了").length,
          "会計済み": data.filter(r => r.status === "会計済み").length,
          "キャンセル済み": data.filter(r => r.status === "キャンセル済み").length,
        };
        setStatusCounts(counts);
        setTotalReservations(data.length); // 🔥 合計予約数を更新
      } else {
        console.warn("⚠️ Firestore にデータがありません。");
        setReservations([]);
        setStatusCounts({});
        setTotalReservations(0);
      }
    });
  
    return () => unsubscribe();
  }, []);
  
  
  const getStatusColor = (status) => {
    switch (status) {
      case "受付済": return "bg-blue-300";
      case "診察中": return "bg-yellow-300";
      case "診察終了": return "bg-green-300";
      case "呼び出し中": return "bg-red-300";
      case "キャンセル済み": return "bg-gray-300";
      default: return "";
    }
  };
  const getTypeColor = (type) => {
    switch (type) {
      case "初診": return "bg-blue-500"; // 初診予約ページと同じ青
      case "再診": return "bg-green-500"; // 再診予約ページと同じ緑
      default: return "";
    }
  };
  

  
  const handleStatusChange = async (id, newStatus) => {
    try {
      await updateDoc(doc(db, "reservations", id), { status: newStatus });
      setReservations(prevReservations =>
        prevReservations.map(reservation =>
          reservation.id === id ? { ...reservation, status: newStatus } : reservation
        )
      );
    } catch (error) {
      console.error("❌ ステータスの更新に失敗:", error);
    }
  };
  
  const handleSort = (key) => {
    let direction = sortConfig.key === key && sortConfig.direction === "asc" ? "desc" : "asc";
    setSortConfig({ key, direction });
  
    setReservations(prevReservations =>
      [...prevReservations].sort((a, b) => {
        const aValue = (a[key] ?? "未受付").toString().trim(); // 🔥 `null` や `undefined` の場合 "未受付" をセット
        const bValue = (b[key] ?? "未受付").toString().trim();
  
        if (key === "receptionNumber") {
          return direction === "asc" ? Number(aValue) - Number(bValue) : Number(bValue) - Number(aValue);
        }
  
        if (key === "type") {
          const typeOrder = { "初診": 1, "再診": 2, "不明": 3 };
          return direction === "asc"
            ? (typeOrder[aValue] ?? 3) - (typeOrder[bValue] ?? 3)
            : (typeOrder[bValue] ?? 3) - (typeOrder[aValue] ?? 3);
        }
  
        if (key === "status") {
          const statusOrder = {
            "受付済": 1,
            "呼び出し中": 2,
            "診察中": 3,
            "診察終了": 4,
            "会計済み": 5,
            "キャンセル済み": 6,
            "未受付": 7 // 🔥 未受付の優先順位を最後にする
          };
          return direction === "asc"
            ? (statusOrder[aValue] ?? 7) - (statusOrder[bValue] ?? 7)
            : (statusOrder[bValue] ?? 7) - (statusOrder[aValue] ?? 7);
        }
  
        return direction === "asc"
          ? aValue.localeCompare(bValue, "ja")
          : bValue.localeCompare(aValue, "ja");
      })
    );
  };
  
  
  const [statusCounts, setStatusCounts] = useState({}); // 🔥 受付状態のカウント
const [totalReservations, setTotalReservations] = useState(0); // 🔥 合計予約数

useEffect(() => {
  console.log("📡 Firestore 監視を開始...");
  const q = query(collection(db, "reservations"), orderBy("receptionNumber", "asc"));

  const unsubscribe = onSnapshot(q, (snapshot) => {
    console.log(`📡 Firestore から ${snapshot.docs.length} 件のデータを取得`);

    if (snapshot.docs.length > 0) {
      let data = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data(),
        status: doc.data().status && doc.data().status.trim() !== "" 
          ? doc.data().status 
          : "未受付", // 🔥 Firestore のデータに `null` や `""` があれば `"未受付"` に変換
        createdAt: doc.data().createdAt ? doc.data().createdAt.toDate() : new Date(),
      }));

      console.log("📡 Firestoreから取得したデータ:", data);
      setReservations(data);

      // 🔥 受付状態のカウントをリアルタイム更新
      const counts = {
        "未受付": data.filter(r => r.status === "未受付").length,
        "受付済": data.filter(r => r.status === "受付済").length,
        "呼び出し中": data.filter(r => r.status === "呼び出し中").length,
        "診察中": data.filter(r => r.status === "診察中").length,
        "診察終了": data.filter(r => r.status === "診察終了").length,
        "会計済み": data.filter(r => r.status === "会計済み").length,
        "キャンセル済み": data.filter(r => r.status === "キャンセル済み").length,
      };
      setStatusCounts(counts);
      setTotalReservations(data.length); // 🔥 合計予約数を更新
    } else {
      console.warn("⚠️ Firestore にデータがありません。");
      setReservations([]);
      setStatusCounts({});
      setTotalReservations(0);
    }
  });

  return () => unsubscribe();
}, []);




  const handleDeleteSelected = async () => {
    if (window.confirm("選択した予約を削除しますか？")) {
      for (let id of selectedReservations) {
        await deleteDoc(doc(db, "reservations", id));
      }
      setSelectedReservations([]);
    }
  };

  
  const handleExport = () => {
    const csvData = reservations.map(reservation => ({
      受付番号: reservation.receptionNumber,
      受付時刻: reservation.createdAt,
      初診_再診: reservation.type,
      診察券番号: reservation.cardNumber || "なし",
      名前: reservation.name,
      生年月日: reservation.birthdate || "なし",
      電話番号: reservation.phone || "なし",
      受付状態: reservation.status,
    }));
  
    let csv = Papa.unparse(csvData);
  
    // UTF-8 BOMを追加して文字化け防止
    csv = "\uFEFF" + csv;
  
    // 日本時間 (JST) でファイル名を作成
    const now = new Date();
    const jstNow = new Intl.DateTimeFormat("ja-JP", { 
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
      hour12: false, timeZone: "Asia/Tokyo" 
    }).format(now).replace(/\//g, "-").replace(/:/g, "-").replace(/ /g, "_");
  
    const fileName = `予約データ_${jstNow}.csv`;
  
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };
  
  const handleDeleteAll = async () => {
    if (!window.confirm("⚠️ 本当にすべての予約データを削除しますか？ この操作は元に戻せません！")) {
      return;
    }
  
    try {
      // Firestore の全データ取得
      const querySnapshot = await getDocs(collection(db, "reservations"));
  
      if (querySnapshot.empty) {
        alert("削除できる予約データがありません。");
        return;
      }
  
      // すべての予約データを削除
      await Promise.all(querySnapshot.docs.map(doc => deleteDoc(doc.ref)));
  
      setReservations([]); // ローカルのステートもリセット
  
      alert("すべての予約データを削除しました。");
    } catch (error) {
      console.error("❌ 全データ削除エラー:", error);
      alert("エラーが発生しました。削除に失敗しました。");
    }
  };
  
  
  

  const handleImport = (event) => {
    const file = event.target.files[0];
    if (!file) return;
    Papa.parse(file, {
      complete: async (result) => {
        const importedData = result.data;
        for (let row of importedData) {
          if (!row.受付番号 || !row.名前) continue;
          await addDoc(collection(db, "reservations"), {
            receptionNumber: parseInt(row.受付番号),
            createdAt: row.受付時刻 ? new Date(row.受付時刻) : new Date(),
            type: row.初診_再診 || "不明",
            cardNumber: row.診察券番号 || "",
            name: row.名前,
            birthdate: row.生年月日 || "",
            phone: row.電話番号 || "",
            status: row.状態 || "未受付",
          });
        }
        alert("インポートが完了しました！");
      },
      header: true,
      skipEmptyLines: true,
    });
  };

  // 🔽 ここに `handleAddNewReservation` を追加
  const handleAddNewReservation = async (newReservationData) => {
    try {
      const snapshot = await getDocs(collection(db, "reservations"));
      const receptionNumber = snapshot.empty ? 1 : snapshot.docs.length + 1;
  
      // 🔥 `status` を `null` や `""` ではなく、常に `"未受付"` に設定
      const status = newReservationData.status && newReservationData.status.trim() !== "" 
        ? newReservationData.status 
        : "未受付";
  
      await addDoc(collection(db, "reservations"), {
        receptionNumber: receptionNumber,
        createdAt: new Date(),
        status: status,
        ...newReservationData
      });
  
      console.log(`✅ 予約追加: ${newReservationData.name}（受付番号 ${receptionNumber}）`);
  
    } catch (error) {
      console.error("❌ 予約の追加に失敗しました:", error);
    }
  };
  
  return (
    <div className="container mx-auto p-6">
      <h1 className="text-3xl font-bold text-center mb-6">けんおう皮フ科クリニック 予約管理</h1>
      

      <table className="w-full border-collapse border border-gray-300">
        <thead>
  <tr className="bg-gray-100">
  <th className="border p-2 cursor-pointer" onClick={() => handleSort("status")}>受付状態 ▲▼</th>
  <th className="border p-2 cursor-pointer" onClick={() => handleSort("receptionNumber")}>受付番号 ▲▼</th>
    <th className="border p-2">受付時刻</th>
    <th className="border p-2 cursor-pointer" onClick={() => handleSort("type")}>初診/再診 ▲▼</th>
    <th className="border p-2">診察券番号</th>
    <th className="border p-2">名前</th>
    <th className="border p-2">生年月日</th>
    <th className="border p-2">電話番号</th>
    <th className="border p-2">選択</th>
  </tr>
</thead>

        <tbody>
          {reservations.map((reservation) => (
            <tr key={reservation.id} className="border">
              <td className={`border p-2 text-center ${getStatusColor(reservation.status)}`}>
  <select value={reservation.status} onChange={(e) => handleStatusChange(reservation.id, e.target.value)} className="border rounded-md p-1">
    {["未受付", "受付済","呼び出し中", "診察中", "診察終了",  "キャンセル済み"].map((status, index) => (
      <option key={index} value={status}>{status}</option>
    ))}
  </select>
</td>


              <td className="border p-2 text-center">{reservation.receptionNumber}</td>
              <td className="border p-2 text-center">
  {reservation.createdAt instanceof Date
    ? new Intl.DateTimeFormat("ja-JP", {
        hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false
      }).format(reservation.createdAt) // ⏰ 「時:分:秒」のみ表示
    : "未登録"}
</td>

              <td className={`border p-2 text-center ${getTypeColor(reservation.type)}`}>{reservation.type}</td>
              <td className="border p-2 text-center">{reservation.cardNumber || "なし"}</td>
              <td className="border p-2">{reservation.name}</td>
              <td className="border p-2 text-center">{reservation.birthdate || "なし"}</td>
              <td className="border p-2 text-center">{reservation.phone || "なし"}</td>
              <td className="border p-2 text-center">
                <input type="checkbox" checked={selectedReservations.includes(reservation.id)} onChange={(e) => {
                  setSelectedReservations(e.target.checked
                    ? [...selectedReservations, reservation.id]
                    : selectedReservations.filter(id => id !== reservation.id));
                }} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>


      <div className="mb-4 flex gap-4">
  <button onClick={handleExport} className="px-4 py-2 bg-blue-500 text-white rounded-md hover:bg-blue-700">
    予約データをエクスポート 📥
  </button>
  <input type="file" accept=".csv" onChange={handleImport} className="px-4 py-2 border rounded-md" />
  <button onClick={handleDeleteSelected} className="px-4 py-2 bg-red-500 text-white rounded-md hover:bg-red-700">
    選択した予約を削除
  </button>
  <button onClick={handleDeleteAll} className="px-4 py-2 bg-red-700 text-white rounded-md hover:bg-red-900">
    🚨 全予約を削除
  </button>
  <button
  onClick={() => setIsAutoLoad(prev => !prev)}
  className={`px-4 py-2 rounded-md text-white ${
    isAutoLoad ? "bg-green-500 hover:bg-green-700" : "bg-gray-500 hover:bg-gray-700"
  }`}
>
  {isAutoLoad ? "⏸ 自動更新オフ" : "▶ 自動更新オン"}
</button>

</div>

      <div className={`fixed bottom-4 right-4 bg-white shadow-lg border border-gray-300 rounded-lg transition-all ${isMinimized ? "p-2 text-xs w-24 h-12 flex items-center justify-center" : "p-4 text-sm"}`}>
  {/* 🔽 ボタンを大きくする */}
  <button 
    onClick={() => setIsMinimized(!isMinimized)} 
    className="absolute top-2 right-2 w-12 h-12 flex items-center justify-center bg-gray-300 hover:bg-gray-500 text-4xl font-bold rounded-full"
  >
    {isMinimized ? "＋" : "−"}
  </button>

  {!isMinimized && (
    <>
      <h2 className="text-lg font-bold mb-2">受付状態</h2>
      <ul>
        {Object.entries(statusCounts).map(([status, count]) => (
          <li key={status} className="flex justify-between">
            <span>{status}:</span> <span className="font-bold">{count}</span>
          </li>
        ))}
      </ul>
      <hr className="my-2" />
      <p className="text-sm font-bold">合計: {totalReservations} 件</p>
    </>
  )}
</div>




    </div>
  );
}