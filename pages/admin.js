import React, { useEffect, useState, useMemo } from "react";
import { db } from "../firebaseConfig";
import { 
  collection, onSnapshot, query, orderBy, updateDoc, doc, deleteDoc, addDoc, getDocs, getDoc, serverTimestamp, writeBatch 
} from "firebase/firestore";
import Papa from "papaparse";


// 🔥 Firestore にログを記録する関数
const addLog = async (action, details) => {
  try {
    await addDoc(collection(db, "logs"), {
      action,
      timestamp: serverTimestamp(),
      user: "admin", // 🔥 今は仮で "admin"、将来はログイン機能を入れるなら変更
      details,
    });
    console.log(`✅ Firestore にログ記録: ${action}`);
  } catch (error) {
    console.error("❌ Firestore のログ追加エラー:", error);
  }
};

export default function AdminPage() {
  const [reservations, setReservations] = useState([]);
  const [sortConfig, setSortConfig] = useState({ key: "receptionNumber", direction: "asc" });
  const [selectedReservations, setSelectedReservations] = useState([]);
  const [logs, setLogs] = useState([]); // 🔥 Firestore のログを管理
  
  const [isMinimized, setIsMinimized] = useState(false);

// 自動更新ボタンのオンオフ
  const [isAutoLoad, setIsAutoLoad] = useState(true); // 🔥 Firestore の自動更新のオン/オフ状態

  const [isReservationOpen, setIsReservationOpen] = useState(true); // 🔥 予約受付の ON/OFF 状態
  const [maxReservations, setMaxReservations] = useState(10); // 🔥 予約上限の状態

// 🔥 予約受付の状態を取得する useEffect（追加）
useEffect(() => {
  const fetchReservationStatus = async () => {
    try {
      const settingsRef = doc(db, "settings", "clinic");
      const snapshot = await getDoc(settingsRef);
      if (snapshot.exists()) {
        setIsReservationOpen(snapshot.data().isReservationOpen);
        console.log(`📡 Firestore から取得: isReservationOpen = ${snapshot.data().isReservationOpen}`);
      } else {
        console.warn("⚠️ Firestore に `clinic` ドキュメントがありません！");
      }
    } catch (error) {
      console.error("❌ Firestore のデータ取得エラー:", error);
    }
  };

  fetchReservationStatus();

  // 🔥 Firestore の `isReservationOpen` をリアルタイム監視（`onSnapshot()` を使う場合）
  const unsubscribe = onSnapshot(doc(db, "settings", "clinic"), (docSnapshot) => {
    if (docSnapshot.exists()) {
      setIsReservationOpen(docSnapshot.data().isReservationOpen);
      console.log(`📡 Firestore (リアルタイム更新): isReservationOpen = ${docSnapshot.data().isReservationOpen}`);
    }
  });

  return () => unsubscribe(); // 🔥 コンポーネントがアンマウントされたら Firestore の監視を解除
}, []);

useEffect(() => {
  const settingsRef = doc(db, "settings", "clinic");

  // 🔥 Firestore の `maxReservationsPerDay` をリアルタイムで取得
  const unsubscribe = onSnapshot(settingsRef, (docSnapshot) => {
    if (docSnapshot.exists()) {
      setMaxReservations(docSnapshot.data().maxReservationsPerDay || 10);
      console.log(`📡 Firestore 更新: maxReservationsPerDay = ${docSnapshot.data().maxReservationsPerDay}`);
    }
  });

  return () => unsubscribe(); // 🔥 Firestore の監視を解除
}, []);


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
            : "未受付", // 🔥 `null` や `""` を `"未受付"` に変換
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
  
    return () => {
      console.log("📡 Firestore 監視を解除");
      unsubscribe();
    };
  }, []); // 🔥 `useEffect()` は 1 回だけ実行
  
  useEffect(() => {
    console.log("📡 Firestore 監視を開始（ログ）...");
    const q = query(collection(db, "logs"), orderBy("timestamp", "desc"));
  
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const logData = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data(),
        timestamp: doc.data().timestamp?.toDate().toLocaleString("ja-JP") || "不明",
      }));
      setLogs(logData);
    });
  
    return () => {
      console.log("📡 Firestore 監視を解除（ログ）");
      unsubscribe();
    };
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
      console.log(`✅ ステータス変更: ${id} → ${newStatus}`);
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
            "未受付": 1,
            "受付済": 2,
            "呼び出し中": 3,
            "診察中": 4,
            "診察終了": 5,
            "会計済み": 6,
            "キャンセル済み": 7
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
  
  const toggleReservation = async () => {
    try {
        const settingsRef = doc(db, "settings", "clinic");
        const snapshot = await getDoc(settingsRef);

        if (!snapshot.exists()) {
            console.error("❌ `clinic` ドキュメントが Firestore に存在しません！");
            return;
        }

        const newStatus = !isReservationOpen;
        console.log(`🔄 Firestore 更新: isReservationOpen を ${newStatus} に変更`);

        await updateDoc(settingsRef, { isReservationOpen: newStatus });

        // 🔥 Firestore にログを記録
        await addLog(
            newStatus ? "予約受付を再開" : "予約受付を停止",
            `管理画面で予約受付を${newStatus ? "再開" : "停止"}しました`
        );

        setIsReservationOpen(newStatus); // 🔥 UI の状態を更新
        console.log(`✅ Firestore 更新成功！現在の isReservationOpen: ${newStatus}`);
    } catch (error) {
        console.error("❌ Firestore へのデータ更新エラー:", error);
    }
};

const updateMaxReservations = async () => {
  try {
    const settingsRef = doc(db, "settings", "clinic");
    await updateDoc(settingsRef, { maxReservationsPerDay: maxReservations });
    console.log(`✅ Firestore 更新成功！予約上限: ${maxReservations}`);

    // 🔥 Firestore にログを記録
    await addLog("予約上限変更", `予約上限を ${maxReservations} 人に設定`);
  } catch (error) {
    console.error("❌ Firestore へのデータ更新エラー:", error);
  }
};
 
  
  const [statusCounts, setStatusCounts] = useState({}); // 🔥 受付状態のカウント
const [totalReservations, setTotalReservations] = useState(0); // 🔥 合計予約数

const handleDeleteSelected = async () => {
  if (window.confirm("選択した予約を削除しますか？")) {
    const batch = writeBatch(db);

    selectedReservations.forEach((id) => {
      const reservationRef = doc(db, "reservations", id);
      batch.delete(reservationRef);
    });

    await batch.commit();

    // 🔥 Firestore にログを記録
    await addLog("予約削除", `削除された予約 ID: ${selectedReservations.join(", ")}`);

    setSelectedReservations([]);
    console.log("✅ 選択した予約を削除しました");
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
  
  
{/* 🔥 現在の予約受付状態を表示 */}
<p className="text-lg text-center font-bold mt-4">
  現在の予約受付状態:{" "}
  <span className={isReservationOpen ? "text-green-600" : "text-red-600"}>
    {isReservationOpen ? "受付中 ✅" : "停止中 ⛔"}
  </span>
</p>

  

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
  // 🔥 予約の個別削除
const handleDelete = async (id) => {
  if (!window.confirm("本当にこの予約を削除しますか？")) {
    return;
  }

  try {
    await deleteDoc(doc(db, "reservations", id)); // Firestore から削除

    setReservations((prevReservations) =>
      prevReservations.filter((reservation) => reservation.id !== id)
    );

    alert("予約を削除しました。");
  } catch (error) {
    console.error("❌ 予約削除エラー:", error);
    alert("エラーが発生しました。削除できませんでした。");
  }
};
// 🔥 個別ログ削除
const handleDeleteLog = async (id) => {
  if (!window.confirm("本当にこのログを削除しますか？")) {
    return;
  }

  try {
    await deleteDoc(doc(db, "logs", id)); // Firestore からログ削除

    setLogs((prevLogs) =>
      prevLogs.filter((log) => log.id !== id)
    );

    alert("ログを削除しました。");
  } catch (error) {
    console.error("❌ ログ削除エラー:", error);
    alert("エラーが発生しました。削除できませんでした。");
  }
};

// 🔥 全ログ削除
const handleDeleteAllLogs = async () => {
  if (!window.confirm("⚠️ 本当にすべてのログを削除しますか？ この操作は元に戻せません！")) {
    return;
  }

  try {
    const querySnapshot = await getDocs(collection(db, "logs")); // Firestore のログ取得

    if (querySnapshot.empty) {
      alert("削除できるログがありません。");
      return;
    }

    await Promise.all(querySnapshot.docs.map(doc => deleteDoc(doc.ref))); // すべて削除

    setLogs([]); // ローカルのログ一覧もリセット
    alert("すべてのログを削除しました。");
  } catch (error) {
    console.error("❌ 全ログ削除エラー:", error);
    alert("エラーが発生しました。削除できませんでした。");
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
    <th className="border p-2">予約削除</th>
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

<td className="border p-2 text-center">
  <button onClick={() => handleDelete(reservation.id)} className="px-3 py-1 bg-red-500 text-white rounded hover:bg-red-700">
    削除
  </button>
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
{/* 🔥 予約受付 ON/OFF ボタンを表の下に配置 */}
<div className="mt-6 flex justify-center">
  <button
    onClick={toggleReservation}
    className={`px-6 py-3 text-lg font-bold text-white rounded-lg shadow-lg ${
      isReservationOpen ? "bg-red-500 hover:bg-red-700" : "bg-green-500 hover:bg-green-700"
    }`}
  >
    {isReservationOpen ? "⛔ 予約を停止する" : "✅ 予約を再開する"}
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
<div className="mt-6">
  <h2 className="text-xl font-bold text-center">予約人数の上限設定</h2>
  <div className="flex justify-center mt-2">
    <input
      type="number"
      className="border p-2 rounded-md text-lg"
      value={maxReservations}
      onChange={(e) => setMaxReservations(Number(e.target.value))}
    />
    <button
      onClick={updateMaxReservations}
      className="ml-2 px-4 py-2 bg-blue-500 text-white rounded-md hover:bg-blue-700"
    >
      設定を保存
    </button>
  </div>
</div>


{/* 🔥 予約システムのログを表示 */}
<div className="container mx-auto p-6">
  <h2 className="text-2xl font-bold mb-4">予約システムのログ</h2>

  <table className="w-full border-collapse border border-gray-300">
  <thead>
  <tr className="bg-gray-100">
    <th className="border p-2">操作内容</th>
    <th className="border p-2">日時</th>
    <th className="border p-2">詳細</th>
    <th className="border p-2">削除</th>  {/* 🔥 ここを追加！ */}
  </tr>
</thead>

<tbody>
  {logs.map((log) => (
    <tr key={log.id} className="border">
      <td className="border p-2">{log.action}</td>
      <td className="border p-2">{log.timestamp}</td>
      <td className="border p-2">{log.details}</td>
      <td className="border p-2 text-center">
        <button onClick={() => handleDeleteLog(log.id)} className="px-3 py-1 bg-red-500 text-white rounded hover:bg-red-700">
          削除
        </button>
      </td>
    </tr>
  ))}
</tbody>

  </table>
</div>

<div className="mb-4">
  <button onClick={handleDeleteAllLogs} className="px-4 py-2 bg-red-700 text-white rounded-md hover:bg-red-900">
    🚨 すべてのログを削除
  </button>
</div>

    </div>
  );
}