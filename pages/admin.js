import React, { useEffect, useState, useRef} from "react";
import { db } from "../firebaseConfig";
import {
  collection, doc, getDoc, onSnapshot, updateDoc, addDoc, serverTimestamp,query,orderBy,deleteDoc,getDocs,writeBatch
} from "firebase/firestore";
import Papa from "papaparse";

const addLog = async (action, details) => {
  await addDoc(collection(db, "logs"), {
    action,
    details,
    user: "admin",
    timestamp: serverTimestamp()
  });
  console.log("✅ ログ記録:", action);
};


export default function AdminPage() {
  useEffect(() => {
  // ① 監視対象の参照を作成
  const settingsRef = doc(db, "settings", "clinic");

  // ② リアルタイム購読を開始
  const unsubscribe = onSnapshot(settingsRef, snapshot => {
    // ドキュメントが存在しない可能性もあるので安全策
    if (!snapshot.exists()) return;
    const data = snapshot.data();

    // ③ 受け取ったデータを state にセット
    setReservationHours(data.reservationHours || {});
    setIsReservationOpen(data.isReservationOpen);
    setLastAutoToggle(data.lastAutoToggle?.toDate() || null);
    setMaxReservationsMorning(data.maxReservationsMorning ?? 50);
    setMaxReservationsAfternoon(data.maxReservationsAfternoon ?? 50);
    setAutoToggleEnabled(data.autoToggleEnabled ?? true);
  }, err => {
    console.error("🚨 settings購読エラー:", err);
  });

  // ④ コンポーネントが消えるとき（画面が切り替わるとき）に購読を解除
  return () => unsubscribe();
}, []);

  // ──────── ① 既存の state 宣言 ────────
  const [reservationHours,       setReservationHours]    = useState({});
  const [reservations,          setReservations]        = useState([]);
  const [sortConfig,            setSortConfig]          = useState({ key: "receptionNumber", direction: "asc" });
  const [selectedReservations,  setSelectedReservations]= useState([]);
  const [logs,                  setLogs]                = useState([]);
  const [isMinimized,           setIsMinimized]         = useState(false);
  const [isReservationOpen,     setIsReservationOpen]   = useState(true);
 const [maxReservationsMorning, setMaxReservationsMorning]   = useState(50);
const [maxReservationsAfternoon, setMaxReservationsAfternoon] = useState(50);
  // ──────── ①-1 タイマーID保持用 ref ────────
  const intervalRef = useRef(null);
  // ──────── ② タイマー制御用の state ────────
  const [lastAutoToggle,        setLastAutoToggle]      = useState(null);
  const [autoToggleEnabled,     setAutoToggleEnabled]   = useState(true);

const [newReservation, setNewReservation] = useState({
  name:        "",
  type:        "初診",
  cardNumber:  "",
  birthdate:   "",
  phone:       ""
});

const skipSortRef = useRef(false);


// 追加フォーム直前にバリデーション関数を定義
const validateNewReservation = () => {
  const { name, birthdate, phone } = newReservation;

  // 名前の必須チェック
  if (!name.trim()) {
    alert("名前を入力してください。");
    return false;
  }

  // 生年月日：8桁の半角数字チェック
  if (!/^\d{8}$/.test(birthdate)) {
    alert("生年月日は8桁の半角数字（YYYYMMDD）で入力してください。");
    return false;
  }

  // 電話番号：10～11桁の半角数字チェック
  if (!/^\d{10,11}$/.test(phone)) {
    alert("電話番号は10〜11桁の半角数字で入力してください。");
    return false;
  }

  return true;
};

  // 自動切替 OFF なら何もしない
useEffect(() => {
  // autoToggleEnabled が false なら何もしない
  if (!autoToggleEnabled) return;

  // 毎分チェックするなら intervalRef を使うか…
  const checkLimit = () => {
    const now = new Date();
 // 現在が 14:30 より前かどうか
 const cutoff = new Date(now);
 cutoff.setHours(14, 30, 0, 0);
 const isMorning = now < cutoff;
    const activeCount = reservations
      .filter(r => r.status !== "キャンセル済")
      .filter(r => {
        const t = r.createdAt;
        const minutes = t.getHours() * 60 + t.getMinutes();
        return isMorning
          ? minutes < 14 * 60 + 30
          : minutes >= 14 * 60 + 30;
      }).length;

    const limit = isMorning ? maxReservationsMorning : maxReservationsAfternoon;
    if (activeCount >= limit && isReservationOpen) {
      const settingsRef = doc(db, "settings", "clinic");
      updateDoc(settingsRef, {
        isReservationOpen: false,
        lastAutoToggle:    serverTimestamp()
      }).then(() => {
        addLog(
          "自動：停止（上限）",
          `${isMorning ? "午前" : "午後"}予約数${activeCount}件が上限${limit}件に到達したため停止`
        );
      });
    }
  };

  // 1分に1回チェック
  const id = setInterval(checkLimit, 60 * 1000);
  // 登場時にもすぐ一度チェック
  checkLimit();

  return () => clearInterval(id);
}, [
  reservations,
  maxReservationsMorning,
  maxReservationsAfternoon,
  isReservationOpen,
  autoToggleEnabled
]);


  // ────────────────────────────────────────────

 
useEffect(() => {
  const q = collection(db, "reservations");
  const unsubscribe = onSnapshot(
    q,
    snapshot => {
      // 1) 生データマッピング
      const data = snapshot.docs.map(doc => {
        const d = doc.data();
        return {
          id:         doc.id,
          ...d,
          status:     d.status?.trim() || "未受付",
          createdAt:  d.createdAt ? d.createdAt.toDate() : new Date(),
          acceptedAt: d.acceptedAt ? d.acceptedAt.toDate() : null,
          comment:    d.comment || ""
        };
      });

      // snapshot 直後
const { key, direction } = sortConfig;
if (key) {
  data.sort((a, b) => {
    // acceptedAt の例
    if (key === "acceptedAt") {
      const ta = a.acceptedAt?.getTime() || 0;
      const tb = b.acceptedAt?.getTime() || 0;
      return direction === "asc" ? ta - tb : tb - ta;
    }
    // receptionNumber の例
    if (key === "receptionNumber") {
      return direction === "asc"
        ? a.receptionNumber - b.receptionNumber
        : b.receptionNumber - a.receptionNumber;
    }
    // 汎用文字列ソート
    const va = String(a[key] || "");
    const vb = String(b[key] || "");
    return direction === "asc"
      ? va.localeCompare(vb, "ja-JP")
      : vb.localeCompare(va, "ja-JP");
  });
}

      // 2) ソートはせず state に保存
      setReservations(data);
      setStatusCounts({
  "未受付":      data.filter(r => r.status === "未受付").length,
  "受付済":      data.filter(r => r.status === "受付済").length,
  "呼び出し中":  data.filter(r => r.status === "呼び出し中").length,
  "診療中/処置中":data.filter(r => r.status === "診療中/処置中").length,
  "診察終了":    data.filter(r => r.status === "診察終了").length,
  "会計済":      data.filter(r => r.status === "会計済").length,
  "キャンセル済":data.filter(r => r.status === "キャンセル済").length,
      });
      setTotalReservations(data.length);
    },
    err => {
      console.error("🚨 予約データ購読エラー:", err);
    }
  );  // ← ここで onSnapshot(...) を閉じる

  return () => {
    unsubscribe();
  };
}, []);  // ← 依存配列は空に

const getStatusColor = (status) => {
    switch (status) {
      case "受付済": return "bg-blue-300";
      case "診療中/処置中": return "bg-yellow-300";
      case "診察終了": return "bg-green-300";
      case "会計済": return "bg-purple-300";
      case "呼び出し中": return "bg-red-300";
      case "キャンセル済": return "bg-gray-300";
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
  const ref = doc(db, "reservations", id);
  try {
      // 次の snapshot 更新ではソートをスキップ
   skipSortRef.current = true;
    if (newStatus === "受付済") {
      // 受付済にしたときにサーバータイムスタンプを acceptedAt にセット
      await updateDoc(ref, {
        status:     newStatus,
        acceptedAt: serverTimestamp()
      });
    } else {
      await updateDoc(ref, { status: newStatus });
    }
    console.log(`✅ ステータス変更: ${id} → ${newStatus}`);
  } catch (error) {
    console.error("❌ ステータスの更新に失敗:", error);
  }
};

const STATUS_LIST = [
  "未受付",
  "受付済",
  "呼び出し中",
  "診療中/処置中",
  "診察終了",
  "会計済",
  "キャンセル済"
];

const handleSort = (key) => {
  const direction = (sortConfig.key === key && sortConfig.direction === "asc") ? "desc" : "asc";
  setSortConfig({ key, direction });

  setReservations(prev =>
    [...prev].sort((a, b) => {
       // ① 必ず最初に「受付完了時刻」を評価
      if (key === "status") {
        const order = { "未受付":0,"受付済":1,"呼び出し中":2,"診療中/処置中":3,"診察終了":4,"会計済":5,"キャンセル済":6 };
        const ai = order[a.status] ?? 0;
        const bi = order[b.status] ?? 0;
        return direction === "asc" ? ai - bi : bi - ai;
      }
       
      if (key === "acceptedAt") {
        const ta = a.acceptedAt ? a.acceptedAt.getTime() : 0;
        const tb = b.acceptedAt ? b.acceptedAt.getTime() : 0;
        return direction === "asc" ? ta - tb : tb - ta;
      }
// 1) 受付番号は数値としてソート
     if (key === "receptionNumber") {
       return direction === "asc"
         ? a.receptionNumber - b.receptionNumber
         : b.receptionNumber - a.receptionNumber;
     }

      // ② 次にステータス

      // ③ 以下既存ロジック...

      if (key === "type") {
        const torder = { "初診":1, "再診":2, "不明":3 };
        const ai = torder[a.type] ?? 3;
        const bi = torder[b.type] ?? 3;
        return direction === "asc" ? ai - bi : bi - ai;
      }
      // ④ 文字列比較
      const va = (a[key] || "").toString();
      const vb = (b[key] || "").toString();
      return direction === "asc" 
        ? va.localeCompare(vb, "ja-JP") 
        : vb.localeCompare(va, "ja-JP");
    })
  );
};

      // コメント機能
const handleCommentChange = async (id, newComment) => {
  try {
    const ref = doc(db, "reservations", id);
    await updateDoc(ref, { comment: newComment });
    console.log(`✅ コメント更新: ${id} → ${newComment}`);
  } catch (error) {
    console.error("❌ コメント更新エラー:", error);
  }
};

  const toggleReservation = async () => {
  const settingsRef = doc(db, "settings", "clinic");
  // 新しい受付状態を計算
  const newStatus = !isReservationOpen;

  try {
    // Firestore を一発で更新
    await updateDoc(settingsRef, {
      isReservationOpen: newStatus,
      autoToggleEnabled: false,
      lastAutoToggle: serverTimestamp()
    });
    // ローカル state も即時更新
    setIsReservationOpen(newStatus);
    setAutoToggleEnabled(false);
    console.log(`✅ 手動切替: isReservationOpen=${newStatus}, autoToggleEnabled=false`);
      // ログ記録
   await addLog(
     newStatus ? "手動：再開" : "手動：停止",
     `手動トグルで受付${newStatus ? "再開" : "停止"}`
   );
  } catch (e) {
    console.error("❌ toggleReservation エラー:", e);
  }
};

const updateMaxReservations = async () => {
  const ref = doc(db, "settings", "clinic");
  await updateDoc(ref, {
    maxReservationsMorning,
    maxReservationsAfternoon
  });
  await addLog(
    "予約上限変更",
    `午前上限=${maxReservationsMorning}, 午後上限=${maxReservationsAfternoon}`
  );
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
      予約取得時刻: reservation.createdAt,
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
            createdAt: row.予約取得時刻 ? new Date(row.予約取得時刻) : new Date(),
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

const handleAddNewReservation = async (newReservationData) => {
  console.log("[AddReservation] 呼び出し:", newReservationData);
  // 既存の6の倍数だけを取って Set に
  const existingNumbers = new Set(
    reservations
      .map(r => Number(r.receptionNumber) || 0)
      .filter(n => n > 0 && n % 6 === 0)
  );

  // 空いている最小の6の倍数を探す
  let receptionNumber = 6;
  while (existingNumbers.has(receptionNumber)) {
    receptionNumber += 6;
  }
  console.log("[AddReservation] 割り当て番号:", receptionNumber);

  try {
    await addDoc(collection(db, "reservations"), {
      receptionNumber,
      createdAt: new Date(),
      status: "未受付",
      ...newReservationData
    });
    console.log("✅ Firestore に追加成功");
  } catch (e) {
    console.error("❌ 追加失敗:", e);
    alert("予約の追加に失敗しました: " + e.message);
    return;
  }

  // フォームをクリア
  setNewReservation({ name:"", type:"初診", cardNumber:"", birthdate:"", phone:"" });
};


 // ──── 🔥 Firestore からログを購読 ────
 useEffect(() => {
   // タイムスタンプ順に並べ替え
   const logsQuery = query(
     collection(db, "logs"),
     orderBy("timestamp", "desc")
   );
   const unsubscribe = onSnapshot(logsQuery, snapshot => {
     const data = snapshot.docs.map(doc => {
       const d = doc.data();
       return {
         id: doc.id,
         action:    d.action,
         details:   d.details,
         // Firestore Timestamp → JS Date へ変換
         timestamp: d.timestamp?.toDate() ?? null,
         user:      d.user
       };
     });
     setLogs(data);
   }, err => {
     console.error("🚨 ログ取得エラー:", err);
   });

   return () => unsubscribe();
 }, []);
 // ──────────────────────
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
     


      <table className="w-full border-collapse border border-gray-300">
        <thead>
  <tr className="bg-gray-100">
 
    <th className="border p-2 cursor-pointer w-12" onClick={() => handleSort("receptionNumber")}>受付番号 ▲▼</th>
    <th className="border p-2 w-16">予約取得時刻</th>
    <th className="border p-2 cursor-pointer w-12" onClick={() => handleSort("status")}>受付状態 ▲▼</th>
    <th className="border p-2 cursor-pointer w-16" onClick={() => handleSort("acceptedAt")}>受付完了時刻 ▲▼</th>
    <th className="border p-2 cursor-pointer w-14" onClick={() => handleSort("type")}>初診/再診 ▲▼</th>
    <th className="border p-2 w-16">診察券番号</th>
    <th className="border p-2 w-36">名前</th>
    <th className="border p-2 w-16">生年月日</th>
    <th className="border p-2 w-60">コメント</th>
    <th className="border p-2 w-16">電話番号</th>
    <th className="border p-2 w-8">予約削除</th>
  </tr>
</thead>

        <tbody>
          {reservations.map((reservation) => (
            <tr key={reservation.id} className="border">
                            <td className="border p-2 text-center">{reservation.receptionNumber}</td>
              <td className="border p-2 text-center">
  {reservation.createdAt instanceof Date
    ? new Intl.DateTimeFormat("ja-JP", {
        hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false
      }).format(reservation.createdAt) // ⏰ 「時:分:秒」のみ表示
    : "未登録"}
</td>

              <td className={`border p-2 text-center ${getStatusColor(reservation.status)}`}>
<select
  value={reservation.status}
  onChange={e => handleStatusChange(reservation.id, e.target.value)}
  className="border rounded-md p-1"
>
  {STATUS_LIST.map((s) => (
    <option key={s} value={s}>{s}</option>
  ))}
</select>
</td>

 <td className="border p-2 text-center">
        {reservation.acceptedAt
          ? new Intl.DateTimeFormat("ja-JP", {
              hour:   "2-digit",
              minute: "2-digit",
              second: "2-digit",
              hour12: false
            }).format(reservation.acceptedAt)
          : ""}
     </td>
     <td className={`border p-2 text-center ${getTypeColor(reservation.type)}`}>{reservation.type}</td>
     <td className="border p-2 text-center">{reservation.cardNumber || "なし"}</td>
     <td className="border p-2">{reservation.name}</td>
     <td className="border p-2 text-center">{reservation.birthdate || "なし"}</td>
     <td className="border p-2">
       <input
         type="text"
         value={reservation.comment}
         onChange={e => {
           const v = e.target.value;
           setReservations(rs =>
             rs.map(r => r.id === reservation.id ? { ...r, comment: v } : r)
           );
         }}
         onBlur={e => handleCommentChange(reservation.id, e.target.value)}
         className="w-full border rounded p-1"
       />
     </td>

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

<div className="mb-6 p-4 border rounded bg-gray-50">
  <h2 className="text-xl font-bold mb-2">新規予約を追加</h2>
  <div className="grid grid-cols-1 md:grid-cols-6 gap-2 items-end">
    {/* 名前 */}
    <div className="col-span-2">
      <label className="block text-sm">名前</label>
      <input
        type="text"
        value={newReservation.name}
        onChange={e => setNewReservation({...newReservation, name: e.target.value})}
        className="w-full border p-2 rounded"
      />
    </div>
    {/* 初診/再診 */}
    <div>
      <label className="block text-sm">初診/再診</label>
      <select
        value={newReservation.type}
        onChange={e => setNewReservation({...newReservation, type: e.target.value})}
        className="w-full border p-2 rounded"
      >
        <option value="初診">初診</option>
        <option value="再診">再診</option>
      </select>
    </div>
    {/* 診察券番号 */}
       <div>
      <label className="block text-sm">診察券番号</label>
      <input
        type="tel"
        value={newReservation.cardNumber}
        onChange={e => setNewReservation(prev => ({ ...prev, cardNumber: e.target.value }))}
        onBlur={() => {
          if (/\D/.test(newReservation.cardNumber)) {
            alert("診察券番号は数字のみで入力してください！");
          }
        }}
        placeholder="半角数字のみ"
        className="w-full border p-2 rounded"
      />
    </div>
    {/* 生年月日 */}
<div>
  <label className="block text-sm">生年月日（YYYYMMDD）</label>
 <input
   type="text"
   value={newReservation.birthdate}
   onChange={e => {
     // 全角数字→半角に正規化、数字以外除去、8文字以内
     const v = e.target.value
       .normalize('NFKC')
       .replace(/[^0-9]/g, '')
       .slice(0, 8);
     setNewReservation({ ...newReservation, birthdate: v });
   }}
   placeholder="例: 19840523"
   maxLength={8}
   className="w-full border p-2 rounded"
  />
</div>
    {/* 電話番号 */}
    <div>
      <label className="block text-sm">電話番号</label>
      <input
        type="tel"
        value={newReservation.phone}
        onChange={e => setNewReservation({...newReservation, phone: e.target.value})}
        placeholder="例: 0256647712"
        className="w-full border p-2 rounded"
      />
    </div>
    {/* 追加ボタン */}
    <div>
       <button
  onClick={async () => {
    if (!validateNewReservation()) return;
    await handleAddNewReservation(newReservation);
  }}
        className="w-full bg-green-500 hover:bg-green-700 text-white p-2 rounded"
      >
        予約を追加
      </button>
    </div>
  </div>
</div>


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


</div>

  {/* ⏱ 最終自動切替時刻 */}
<div className="text-center my-2 text-sm text-gray-600">
  ⏱ 最終自動切替:{" "}
  {lastAutoToggle
    ? lastAutoToggle.toLocaleString("ja-JP", { hour12: false })
    : "まだ実行されていません"}
</div>
  
{/* 🔥 現在の予約受付状態を表示 */}
<p className="text-lg text-center font-bold mt-4">
  現在の予約受付状態:{" "}
  <span className={isReservationOpen ? "text-green-600" : "text-red-600"}>
    {isReservationOpen ? "受付中 ✅" : "停止中 ⛔"}
  </span>
</p>     

{/* 🔥 予約受付 ON/OFF ボタンを表の下に配置 */}
<div className="mt-4 flex items-center justify-center">
  {/* 予約停止／再開ボタン */}
  <button
    onClick={toggleReservation}
    className={`px-6 py-3 text-lg font-bold text-white rounded-lg shadow-lg ${
      isReservationOpen ? "bg-red-500 hover:bg-red-700" : "bg-green-500 hover:bg-green-700"
    }`}
  >
    {isReservationOpen ? "⛔ 予約を停止する" : "✅ 予約を再開する"}
  </button>
   {/* 予約タイマーの状態を表示 */}
  <span className={`ml-6 text-lg font-semibold ${
    autoToggleEnabled ? "text-green-600" : "text-red-600"
  }`}>
    予約タイマー：{autoToggleEnabled ? "動作中" : "停止中"}
  </span>

</div>

<div className="mt-6 p-4 border rounded">
  <h2 className="text-xl font-bold text-center">予約人数の上限設定</h2>
  <div className="flex justify-center gap-4 mt-2">
    <div>
      <label>午前（0:00–14:30）上限：</label>
      <input
        type="number"
        className="border p-2 rounded-md w-24"
        value={maxReservationsMorning}
        onChange={e => setMaxReservationsMorning(Number(e.target.value))}
      />
    </div>
    <div>
      <label>午後（14:30–24:00）上限：</label>
      <input
        type="number"
        className="border p-2 rounded-md w-24"
        value={maxReservationsAfternoon}
        onChange={e => setMaxReservationsAfternoon(Number(e.target.value))}
      />
    </div>
    <button
      onClick={updateMaxReservations}
      className="ml-4 px-4 py-2 bg-blue-500 text-white rounded-md hover:bg-blue-700"
    >
      設定を保存
    </button>
  </div>
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
     <td className="border p-2">
       {log.timestamp
         ? log.timestamp.toLocaleString("ja-JP", { hour12: false })
         : ""}
     </td>
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

      <div className="mt-6 p-4 border rounded">
  <h2 className="text-xl font-bold mb-2">⏰ 自動切替スケジュール設定</h2>
  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
    {["monday","tuesday","wednesday","thursday","friday","saturday","sunday"].map(day => {
      const slot = reservationHours[day] || {};
      return (
        <div key={day} className="p-2 border rounded">
          <div className="capitalize font-bold">{day}</div>
          <label>午前: </label>
          <input
            type="time"
            value={slot.morning?.start || ""}
            onChange={e => setReservationHours({
              ...reservationHours,
              [day]: {
                ...slot,
                morning: { ...(slot.morning || {}), start: e.target.value }
              }
            })}
            className="border p-1 rounded"
          />～
          <input
            type="time"
            value={slot.morning?.end || ""}
            onChange={e => setReservationHours({
              ...reservationHours,
              [day]: {
                ...slot,
                morning: { ...(slot.morning || {}), end: e.target.value }
              }
            })}
            className="border p-1 rounded"
          />
          <br/>
          <label>午後: </label>
          <input
            type="time"
            value={slot.afternoon?.start || ""}
            onChange={e => setReservationHours({
              ...reservationHours,
              [day]: {
                ...slot,
                afternoon: { ...(slot.afternoon || {}), start: e.target.value }
              }
            })}
            className="border p-1 rounded"
          />～
          <input
            type="time"
            value={slot.afternoon?.end || ""}
            onChange={e => setReservationHours({
              ...reservationHours,
              [day]: {
                ...slot,
                afternoon: { ...(slot.afternoon || {}), end: e.target.value }
              }
            })}
            className="border p-1 rounded"
          />
        </div>
      );
    })}
  </div>
  <button
    onClick={async () => {
      await updateDoc(doc(db, "settings", "clinic"), { reservationHours });
      await addLog("スケジュール更新", JSON.stringify(reservationHours));
      alert("スケジュールを保存しました");
    }}
    className="mt-4 px-4 py-2 bg-blue-600 text-white rounded"
  >
    保存する
  </button>

{/* 元の isAutoLoad ボタンはこの行から… */}
{/* onClick={() => setIsAutoLoad(prev => !prev)} などは削除 */}

<button
  onClick={async () => {
    const newVal = !autoToggleEnabled;
    // Firestore の autoToggleEnabled を更新
    await updateDoc(doc(db, "settings", "clinic"), { autoToggleEnabled: newVal });
    // ローカル state も更新
    setAutoToggleEnabled(newVal);
    // オプションでログに残す
    await addLog(
      newVal ? "自動切替をオン" : "自動切替をオフ",
      `autoToggleEnabled=${newVal}`
    );
  }}
  className={`px-4 py-2 rounded-md text-white ${
    autoToggleEnabled ? "bg-green-500 hover:bg-green-700" : "bg-gray-500 hover:bg-gray-700"
  }`}
>
  {autoToggleEnabled ? "⏸ タイマーオフ" : "▶ タイマーオン"}
</button>
{/* …ボタンここまで */}

{/* ── ここから手動トリガーボタンを追加 ── */}
<button
  onClick={async () => {
    try {
      const res = await fetch("https://<リージョン>-<プロジェクトID>.cloudfunctions.net/manualToggleReservation");
      const text = await res.text();
      alert(text);
    } catch (e) {
      console.error(e);
      alert("手動トリガー実行に失敗しました");
    }
  }}
  className="ml-2 px-4 py-2 bg-indigo-500 text-white rounded hover:bg-indigo-700"
>
  🔄 手動で切替実行
</button>
{/* ── ここまで ── */}

</div>

    </div>
  );
}