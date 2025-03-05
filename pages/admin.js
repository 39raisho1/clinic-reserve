import { useEffect, useState } from "react";
import { db } from "../firebase"; // Firebaseをインポート
import { collection, onSnapshot, deleteDoc, doc } from "firebase/firestore";

export default function Admin() {
  const [reservations, setReservations] = useState([]);
  const [sortKey, setSortKey] = useState("reservationNumber"); // ソートキー（デフォルトは予約番号順）
  const [searchQuery, setSearchQuery] = useState(""); // 検索用

  useEffect(() => {
    const unsubscribe = onSnapshot(collection(db, "reservations"), (snapshot) => {
      let data = snapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
      }));

      // 🔹 並び替え
      if (sortKey === "reservationNumber") {
        data.sort((a, b) => a.reservationNumber - b.reservationNumber);
      } else if (sortKey === "name") {
        data.sort((a, b) => a.name.localeCompare(b.name));
      }

      // 🔹 検索フィルタリング
      if (searchQuery) {
        data = data.filter((item) =>
          item.name.includes(searchQuery) || item.phone.includes(searchQuery)
        );
      }

      setReservations(data);
    });

    return () => unsubscribe();
  }, [sortKey, searchQuery]);

  // 🔹 予約を削除する関数
  const handleDelete = async (id) => {
    if (confirm("本当にこの予約を削除しますか？")) {
      try {
        await deleteDoc(doc(db, "reservations", id));
      } catch (error) {
        console.error("予約の削除に失敗しました", error);
      }
    }
  };

  return (
    <div className="max-w-lg mx-auto p-6 bg-white shadow-md rounded-lg">
      <h1 className="text-2xl font-bold mb-4">予約リスト</h1>

      {/* 🔹 並び替えボタン */}
      <div className="mb-4">
        <label className="block text-sm font-medium">並び替え:</label>
        <select
          className="border p-2 w-full rounded"
          value={sortKey}
          onChange={(e) => setSortKey(e.target.value)}
        >
          <option value="reservationNumber">予約番号順</option>
          <option value="name">名前順</option>
        </select>
      </div>

      {/* 🔹 検索フィールド */}
      <div className="mb-4">
        <label className="block text-sm font-medium">検索:</label>
        <input
          type="text"
          className="border p-2 w-full rounded"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="名前または電話番号で検索"
        />
      </div>

      {reservations.length > 0 ? (
        <ul>
          {reservations.map((reservation) => (
            <li key={reservation.id} className="border p-2 rounded mb-2 flex justify-between items-center">
              <div>
                <p><strong>受付番号:</strong> {reservation.reservationNumber}</p>
                <p><strong>名前:</strong> {reservation.name}</p>
                <p><strong>電話番号:</strong> {reservation.phone}</p>
                <p><strong>予約時間:</strong> {reservation.timestamp?.toDate().toLocaleString()}</p>
              </div>
              <button
                className="bg-red-500 text-white px-3 py-1 rounded"
                onClick={() => handleDelete(reservation.id)}
              >
                削除
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-gray-500">予約データがありません。</p>
      )}
    </div>
  );
}
