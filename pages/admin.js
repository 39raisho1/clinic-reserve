import { useEffect, useState } from "react";
import { db } from "../firebase";
import { collection, onSnapshot, deleteDoc, doc, updateDoc, setDoc } from "firebase/firestore";

export default function Admin() {
  const [reservations, setReservations] = useState([]);
  const [confirmDelete, setConfirmDelete] = useState(true);
  const [sortKey, setSortKey] = useState("reservationNumber");
  const [selectedReservations, setSelectedReservations] = useState(new Set());

  useEffect(() => {
    const unsubscribe = onSnapshot(collection(db, "reservations"), (snapshot) => {
      let data = snapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
        reservationNumber: Number(doc.data().reservationNumber) || 0,
        timestamp: doc.data().timestamp?.toDate() || new Date(0),
        birthdate: doc.data().birthdate ? new Date(doc.data().birthdate) : new Date(0)
      }));

      if (sortKey === "reservationNumber") {
        data.sort((a, b) => a.reservationNumber - b.reservationNumber);
      } else if (sortKey === "name") {
        data.sort((a, b) => a.name.localeCompare(b.name));
      } else if (sortKey === "timestamp") {
        data.sort((a, b) => a.timestamp - b.timestamp);
      } else if (sortKey === "birthdate") {
        data.sort((a, b) => a.birthdate - b.birthdate);
      }

      setReservations(data);
    });

    return () => unsubscribe();
  }, [sortKey]);

  const handleStatusChange = async (id, newStatus) => {
    try {
      await updateDoc(doc(db, "reservations", id), { status: newStatus });
    } catch (error) {
      console.error("❌ ステータスの更新に失敗しました", error);
    }
  };

  const handleDelete = async (id) => {
    if (confirmDelete && !confirm("本当にこの予約を削除しますか？")) {
      return;
    }
    try {
      await deleteDoc(doc(db, "reservations", id));
    } catch (error) {
      console.error("❌ 削除に失敗しました", error);
    }
  };

  const handleBulkDelete = async () => {
    if (confirmDelete && !confirm("選択した予約をまとめて削除しますか？")) {
      return;
    }
    try {
      for (let id of selectedReservations) {
        await deleteDoc(doc(db, "reservations", id));
      }
      setSelectedReservations(new Set());
    } catch (error) {
      console.error("❌ 一括削除に失敗しました", error);
    }
  };

  const toggleSelection = (id) => {
    setSelectedReservations((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(id)) {
        newSet.delete(id);
      } else {
        newSet.add(id);
      }
      return newSet;
    });
  };

  const getStatusColor = (status) => {
    switch (status) {
      case "受付済み":
        return "bg-blue-200 text-blue-800";
      case "診察待ち":
        return "bg-yellow-200 text-yellow-800";
      case "呼び出し中":
        return "bg-red-200 text-red-800";
      case "診察中":
        return "bg-green-200 text-green-800";
      case "会計待ち":
        return "bg-purple-200 text-purple-800";
      case "診察終了":
        return "bg-gray-300 text-gray-800";
      default:
        return "bg-white text-black";
    }
  };

  return (
    <div className="max-w-4xl mx-auto p-6 bg-white shadow-md rounded-lg">
      <h1 className="text-2xl font-bold mb-4">予約リスト</h1>
      <button
        className="bg-red-600 text-white px-4 py-2 rounded mb-4 hover:bg-red-700"
        onClick={handleBulkDelete}
        disabled={selectedReservations.size === 0}
      >
        選択した予約をまとめて削除
      </button>
      <table className="w-full border-collapse border border-gray-300">
        <thead>
          <tr className="bg-gray-200">
            <th className="border border-gray-300 p-2">選択</th>
            <th className="border border-gray-300 p-2">受付番号</th>
            <th className="border border-gray-300 p-2">名前</th>
            <th className="border border-gray-300 p-2">生年月日</th>
            <th className="border border-gray-300 p-2">受付時間</th>
            <th className="border border-gray-300 p-2">受付状態</th>
            <th className="border border-gray-300 p-2">操作</th>
          </tr>
        </thead>
        <tbody>
          {reservations.map((reservation) => (
            <tr key={reservation.id} className={`border border-gray-300 ${getStatusColor(reservation.status)}`}>
              <td className="border border-gray-300 p-2">
                <input
                  type="checkbox"
                  checked={selectedReservations.has(reservation.id)}
                  onChange={() => toggleSelection(reservation.id)}
                />
              </td>
              <td className="border border-gray-300 p-2">{reservation.reservationNumber}</td>
              <td className="border border-gray-300 p-2">{reservation.name}</td>
              <td className="border border-gray-300 p-2">{reservation.birthdate.toLocaleDateString()}</td>
              <td className="border border-gray-300 p-2">{reservation.timestamp.toLocaleString()}</td>
              <td className="border border-gray-300 p-2">
                <select
                  className="border p-2 rounded"
                  value={reservation.status}
                  onChange={(e) => handleStatusChange(reservation.id, e.target.value)}
                >
                  <option value="受付済み">受付済み</option>
                  <option value="診察待ち">診察待ち</option>
                  <option value="呼び出し中">呼び出し中</option>
                  <option value="診察中">診察中</option>
                  <option value="会計待ち">会計待ち</option>
                  <option value="診察終了">診察終了</option>
                </select>
              </td>
              <td className="border border-gray-300 p-2">
                <button
                  className="bg-red-500 text-white px-2 py-1 rounded hover:bg-red-600"
                  onClick={() => handleDelete(reservation.id)}
                >
                  削除
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
