import React, { useEffect, useState } from "react";
import { db } from "../firebaseConfig";
import { collection, onSnapshot, query, orderBy, updateDoc, doc, deleteDoc } from "firebase/firestore";

const AdminPage = () => {
  const [reservations, setReservations] = useState([]);
  const [sortConfig, setSortConfig] = useState({ key: "receptionNumber", direction: "asc" });
  const [selectedReservations, setSelectedReservations] = useState([]);

  useEffect(() => {
    console.log("📡 Firestore 監視を開始...");

    const q = query(collection(db, "reservations"), orderBy("createdAt", "desc"));
    
    const unsubscribe = onSnapshot(q, (snapshot) => {
      let data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      console.log("📡 Firestoreからデータ取得:", data);

      setReservations(sortData(data, sortConfig.key, sortConfig.direction));
    });

    return () => unsubscribe();
  }, []);

  // 🔹 データをソートする関数
  const sortData = (data, key, direction) => {
    return [...data].sort((a, b) => {
      const aValue = a[key] ?? "";
      const bValue = b[key] ?? "";
      return direction === "asc"
        ? aValue > bValue ? 1 : -1
        : aValue < bValue ? 1 : -1;
    });
  };

  // 🔹 ソート処理
  const handleSort = (key) => {
    let direction = "asc";
    if (sortConfig.key === key && sortConfig.direction === "asc") {
      direction = "desc";
    }

    setSortConfig({ key, direction });

    setReservations((prevReservations) => sortData(prevReservations, key, direction));
  };

  // 🔹 状態に応じたセルの色
  const getStatusColor = (status) => {
    switch (status) {
      case "受付済":
        return "bg-blue-300";
      case "診察中":
        return "bg-yellow-300";
      case "呼び出し中":
        return "bg-red-300";
      case "キャンセル済み":
        return "bg-gray-300";
      default:
        return "";
    }
  };

  // 🔹 初診・再診の色付け
  const getTypeColor = (type) => {
    switch (type) {
      case "初診":
        return "bg-blue-200";
      case "再診":
        return "bg-green-200";
      default:
        return "";
    }
  };

  // 🔹 ステータス変更処理
  const handleStatusChange = async (id, newStatus) => {
    try {
      await updateDoc(doc(db, "reservations", id), { status: newStatus });
      console.log(`✅ 予約 ${id} のステータスを「${newStatus}」に変更`);

      setReservations((prevReservations) => {
        const updatedReservations = prevReservations.map((res) =>
          res.id === id ? { ...res, status: newStatus } : res
        );
        return sortData(updatedReservations, sortConfig.key, sortConfig.direction);
      });
    } catch (error) {
      console.error("❌ ステータスの更新に失敗:", error);
    }
  };

  // 🔹 予約の選択処理
  const handleSelectReservation = (id) => {
    setSelectedReservations((prevSelected) =>
      prevSelected.includes(id)
        ? prevSelected.filter(reservationId => reservationId !== id)
        : [...prevSelected, id]
    );
  };

  // 🔹 選択した予約を削除
  const handleDeleteSelected = async () => {
    if (selectedReservations.length === 0) {
      alert("削除する予約を選択してください！");
      return;
    }

    const confirmDelete = window.confirm(`選択した ${selectedReservations.length} 件の予約を削除しますか？`);
    if (!confirmDelete) return;

    try {
      await Promise.all(selectedReservations.map(id => deleteDoc(doc(db, "reservations", id))));
      console.log(`🗑️ ${selectedReservations.length} 件の予約を削除しました`);
      setSelectedReservations([]);
    } catch (error) {
      console.error("❌ 予約の削除に失敗:", error);
      alert("予約の削除に失敗しました。");
    }
  };

  return (
    <div className="container mx-auto p-6">
      <h1 className="text-3xl font-bold text-center mb-6">予約管理画面（削除ボタン復活）</h1>

      {/* 🔹 削除ボタン */}
      <div className="mb-4">
        <button
          onClick={handleDeleteSelected}
          className="px-4 py-2 bg-red-500 text-white rounded-md hover:bg-red-700"
        >
          選択した予約を削除 🗑️
        </button>
      </div>

      <table className="w-full border-collapse border border-gray-300">
        <thead>
          <tr className="bg-gray-100">
            <th className="border p-2">✔</th>
            <th className="border p-2">受付番号</th>
            <th className="border p-2">受付時刻</th>
            <th className="border p-2">初診/再診</th>
            <th className="border p-2">診察券番号</th>
            <th className="border p-2">名前</th>
            <th className="border p-2">生年月日</th>
            <th className="border p-2">電話番号</th>
            <th className="border p-2">状態</th>
          </tr>
        </thead>
        <tbody>
          {reservations.map((reservation) => (
            <tr key={reservation.id} className="border">
              <td className="border p-2 text-center">
                <input
                  type="checkbox"
                  checked={selectedReservations.includes(reservation.id)}
                  onChange={() => handleSelectReservation(reservation.id)}
                />
              </td>
              <td className="border p-2 text-center">{reservation.receptionNumber}</td>
              <td className="border p-2 text-center">
                {reservation.createdAt ? new Date(reservation.createdAt.toDate()).toLocaleString() : "未登録"}
              </td>
              <td className={`border p-2 text-center ${getTypeColor(reservation.type)}`}>
                {reservation.type}
              </td>
              <td className="border p-2 text-center">{reservation.cardNumber || "なし"}</td>
              <td className="border p-2">{reservation.name}</td>
              <td className="border p-2 text-center">{reservation.birthdate || reservation.birthdateShort || "なし"}</td>
              <td className="border p-2 text-center">{reservation.phone || "なし"}</td>
              <td className={`border p-2 text-center ${getStatusColor(reservation.status)}`}>
                <select value={reservation.status || "未受付"} onChange={(e) => handleStatusChange(reservation.id, e.target.value)} className="border p-1">
                  <option value="未受付">未受付</option>
                  <option value="受付済">受付済</option>
                  <option value="呼び出し中">呼び出し中</option>
                  <option value="診察中">診察中</option>
                  <option value="診察終了">診察終了</option>
                  <option value="キャンセル済み">キャンセル済み</option>
                </select>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

export default AdminPage;
