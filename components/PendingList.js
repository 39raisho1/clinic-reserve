// components/PendingList.js
import React, { useEffect, useState } from "react";
import { db } from "../firebaseConfig";
import {
  collection,
  onSnapshot,
  query,
  where,
} from "firebase/firestore";
import { Timestamp } from "firebase/firestore";
import { nowJST } from "../utils/timeJST";

const PENDING_STATUSES = ["未受付"]; // 来院前の状態

export default function PendingList() {
  const [numbers, setNumbers] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const now = nowJST();
    const dayStart = new Date(now);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(now);
    dayEnd.setHours(24, 0, 0, 0);

    // createdAt だけで「今日」を絞る
    const qRef = query(
      collection(db, "reservations"),
      where("createdAt", ">=", Timestamp.fromDate(dayStart)),
      where("createdAt", "<", Timestamp.fromDate(dayEnd)),
      where("status", "in", PENDING_STATUSES)
    );

    const unsub = onSnapshot(
      qRef,
      (snap) => {
        const list = snap.docs
          .map((d) => Number(d.data().receptionNumber) || 0)
          // VIPや変な番号は弾いておく（必要に応じて調整）
          .filter((n) => n > 0 && n <= 1000)
          .sort((a, b) => a - b);

        setNumbers(list);
        setLoading(false);
      },
      (err) => {
        console.error("未受付一覧取得エラー:", err);
        setLoading(false);
      }
    );

    return () => unsub();
  }, []);

  if (loading) {
    return (
      <div className="w-full max-w-xl mt-4 p-3 rounded-2xl bg-gray-100 shadow">
        <p className="text-center text-gray-600 text-sm">
          受付前の番号一覧を読み込み中です…
        </p>
      </div>
    );
  }

  if (numbers.length === 0) {
    return (
      <div className="w-full max-w-xl mt-4 p-3 rounded-2xl bg-white shadow">
        <p className="text-center text-gray-600 text-sm">
          現在、呼び出し中の方はいません。
        </p>
      </div>
    );
  }

  return (
    <div className="w-full max-w-xl mt-4 p-4 rounded-2xl bg-white shadow border border-gray-200">
      <h2 className="text-2xl font-bold mb-2 text-center">
        呼び出し中の方
      </h2>
      <p className="text-xs text-center text-gray-500 mb-2">
        ※呼び出し中ですので診療時間になりましたら受付にお越しください。</p>
      <p className="text-xs text-center text-gray-500 mb-2">(午前：9：30～、午後：15：00～)</p>
      <div className="flex flex-wrap gap-2 justify-center">
        {numbers.map((no) => (
          <span
            key={no}
            className="min-w-[3rem] px-6 py-6 rounded-full bg-blue-50 text-blue-700
                       text-6xl font-semibold text-center border border-blue-200"
          >
            {no}
          </span>
        ))}
      </div>
    </div>
  );
}
