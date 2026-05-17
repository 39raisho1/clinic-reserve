// components/CrowdStatus.js
import React, { useEffect, useMemo, useState } from "react";
import { db } from "../firebaseConfig";
import {
  collection,
  query,
  where,
  onSnapshot,
  Timestamp,
  orderBy,
} from "firebase/firestore";
import { nowJST } from "../utils/timeJST";

// ステータス定義
const STATUS_RESERVED = "予約済";
const STATUS_PENDING = "未受付";
const STATUS_ACCEPTED = "受付済";
const STATUS_OUT = "外出中";
const STATUS_CALLING = "呼び出し中";

// 待合室キャパ
const ROOM_CAPACITY = 30;

export default function CrowdStatus() {
  const [loading, setLoading] = useState(true);

  // カウント
  const [reservedCount, setReservedCount] = useState(0); // 予約済
  const [pendingCount, setPendingCount] = useState(0);   // 未受付
  const [acceptedCount, setAcceptedCount] = useState(0); // 受付済
  const [outCount, setOutCount] = useState(0);           // 外出中
  const [callingCount, setCallingCount] = useState(0);   // 呼び出し中

  // 今日の予約を購読してステータス別に集計
  useEffect(() => {
    const now = nowJST();
    const dayStart = new Date(now);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(now);
    dayEnd.setHours(24, 0, 0, 0);

    const todayQuery = query(
      collection(db, "reservations"),
      where("createdAt", ">=", Timestamp.fromDate(dayStart)),
      where("createdAt", "<", Timestamp.fromDate(dayEnd)),
      orderBy("createdAt", "asc")
    );

    const unsub = onSnapshot(
      todayQuery,
      (snap) => {
        let reserved = 0;
        let pending = 0;
        let accepted = 0;
        let out = 0;
        let calling = 0;

        snap.forEach((docSnap) => {
          const data = docSnap.data() || {};
          const status = (data.status || "").trim();

          if (status === STATUS_RESERVED) {
            reserved++;
          } else if (status === STATUS_PENDING) {
            pending++;
          } else if (status === STATUS_ACCEPTED) {
            accepted++;
          } else if (status === STATUS_OUT) {
            out++;
          } else if (status === STATUS_CALLING) {
            calling++;
          }
        });

        setReservedCount(reserved);
        setPendingCount(pending);
        setAcceptedCount(accepted);
        setOutCount(out);
        setCallingCount(calling);
        setLoading(false);
      },
      (err) => {
        console.error("混雑状況購読エラー:", err);
        setLoading(false);
      }
    );

    return () => unsub();
  }, []);

  // 待ち人数 = 予約済 + 未受付 + 受付済 + 外出中 + 呼び出し中
  const waitingTotal = useMemo(
    () => reservedCount + pendingCount + acceptedCount + outCount + callingCount,
    [reservedCount, pendingCount, acceptedCount, outCount, callingCount]
  );

  // 混雑レベル判定（受付済 + 呼び出し中） / 30
  const crowdLevel = useMemo(() => {
    const inRoom = acceptedCount + callingCount; // 実際に院内にいる可能性が高い人数
    const ratio = ROOM_CAPACITY > 0 ? inRoom / ROOM_CAPACITY : 0;

    if (ratio <= 0.5) {
      return { label: "かなり空いています", color: "bg-green-500" };
    } else if (ratio <= 0.7) {
      return { label: "やや混雑しています", color: "bg-yellow-400" };
    } else if (ratio < 0.9) {
      return { label: "混雑しています", color: "bg-orange-500" };
    } else {
      return { label: "非常に混雑しています（満席レベル）", color: "bg-red-600" };
    }
  }, [acceptedCount, callingCount]);

  const ratioPercent = useMemo(() => {
    const inRoom = acceptedCount + callingCount;
    if (ROOM_CAPACITY <= 0) return 0;
    const r = Math.min(inRoom / ROOM_CAPACITY, 1) * 100;
    return Math.round(r);
  }, [acceptedCount, callingCount]);

  if (loading) {
    return (
      <div className="w-full max-w-xl mt-6 p-4 rounded-2xl bg-gray-100 shadow-md">
        <p className="text-center text-gray-600 text-lg">
          混雑状況を取得中です...
        </p>
      </div>
    );
  }

  return (
    <div className="w-full max-w-xl mt-6 p-6 rounded-2xl bg-white shadow-xl border border-gray-200">
      <h2 className="text-2xl font-bold mb-4 text-center">現在の院内混雑状況</h2>

      {/* 混雑レベルバッジ */}
      <div className="flex items-center justify-center mb-4">
        <div
          className={`px-4 py-2 rounded-full text-white text-lg font-semibold ${crowdLevel.color}`}
        >
          {crowdLevel.label}
        </div>
      </div>

      {/* 待合室の埋まり具合ゲージ（受付済 + 呼び出し中）/30 */}
      <div className="mb-6">
        <div className="flex justify-between text-sm text-gray-600 mb-1">
          <span>空いている</span>
          <span>混んでいる</span>
        </div>
        <div className="w-full h-3 bg-gray-200 rounded-full overflow-hidden">
          <div
            className="h-full rounded-full bg-blue-500 transition-all duration-300"
            style={{ width: `${ratioPercent}%` }}
          ></div>
        </div>
      </div>

      {/* 待ち人数（単一指標） */}
      <div className="grid grid-cols-1 gap-4 text-center">
        <div className="p-4 rounded-xl bg-blue-50">
          <p className="text-xl text-gray-600 mb-1">待ち人数</p>
          <p className="text-6xl font-bold text-blue-600">{waitingTotal}</p>
          <p className="text-xs text-gray-500 mt-1">
            診察内容によって診察の順番が前後する可能性があります。ご了承ください。
          </p>
        </div>
      </div>
    </div>
  );
}
