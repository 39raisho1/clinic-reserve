// pages/saishin.js

import React, { useState, useEffect, useMemo } from "react";
import { db } from "../firebaseConfig";
import {
  collection,
  doc,
  onSnapshot,
  query,
  where,
  getDocs,
  Timestamp,
} from "firebase/firestore";
import Link from "next/link";
import BirthdateInput from "../components/BirthdateInput";
import { createReservation } from "../src/services/reservationService";
import { nowJST } from "../utils/timeJST";

const readBool = (v, fallback) => (v === true ? true : v === false ? false : fallback);
const toNum = (v, fb = 0) => (Number.isFinite(Number(v)) ? Number(v) : fb);

const getDayRangeJST = (now) => {
  const s = new Date(now);
  s.setHours(0, 0, 0, 0);
  const e = new Date(now);
  e.setHours(24, 0, 0, 0);
  return { s, e };
};

export default function SaishinPage() {
  const [formData, setFormData] = useState({
    name: "",
    cardNumber: "",
    birthdate: "",
  });

  const [receptionNumber, setReceptionNumber] = useState(null);
  const [callingPatients, setCallingPatients] = useState([]);
  const [loading, setLoading] = useState(true);

  // settings / force open
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [isReservationOpen, setIsReservationOpen] = useState(true);
  const [maxPerDay, setMaxPerDay] = useState(0);
  const [forceOpenUntil, setForceOpenUntil] = useState(null);
  const [forceOpenActive, setForceOpenActive] = useState(false);

  // today count（reservations 実体）
  const [countLoaded, setCountLoaded] = useState(false);
  const [todayCount, setTodayCount] = useState(0);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  // ── 設定購読（index.jsと同じ思想で後方互換）
  useEffect(() => {
    const settingsRef = doc(db, "settings", "clinic");
    return onSnapshot(settingsRef, (snap) => {
      if (!snap.exists()) return;
      const d = snap.data() || {};

      setIsReservationOpen(readBool(d.isReservationOpen, true));

      setMaxPerDay(toNum(d.maxReservationsDay, 0) || toNum(d.maxReservationsPerDay, 0));

      const until = d.forceOpenUntil?.toDate?.() ?? null;
      setForceOpenUntil(until);
      setForceOpenActive(until ? nowJST() < until : false);

      setSettingsLoaded(true);
    });
  }, []);

  // ── forceOpenActive の期限監視（30秒）
  useEffect(() => {
    if (!forceOpenUntil) {
      setForceOpenActive(false);
      return;
    }
    const tick = () => setForceOpenActive(nowJST() < forceOpenUntil);
    tick();
    const id = setInterval(tick, 30 * 1000);
    return () => clearInterval(id);
  }, [forceOpenUntil]);

  // ── 当日件数：reservations の createdAt 範囲で購読（dailyCountersは使わない）
  useEffect(() => {
    const now = nowJST();
    const { s, e } = getDayRangeJST(now);

    const qToday = query(
      collection(db, "reservations"),
      where("createdAt", ">=", Timestamp.fromDate(s)),
      where("createdAt", "<", Timestamp.fromDate(e))
    );

    return onSnapshot(
      qToday,
      (snap) => {
        const n = snap.docs.filter((d) => (d.data()?.status || "").trim() !== "キャンセル済").length;
        setTodayCount(n);
        setCountLoaded(true);
      },
      (err) => {
        console.error("todayCount購読エラー:", err);
        setCountLoaded(true); // エラーでも「安全に閉じる」ために loaded 扱い
      }
    );
  }, []);

  // ── 満杯判定（メモ化）
  const isFull = useMemo(() => {
    return !forceOpenActive && maxPerDay > 0 && todayCount >= maxPerDay;
  }, [forceOpenActive, maxPerDay, todayCount]);

  // ★ 超重要：ロード完了まで “常にブロック” （一瞬のスキが原因）
  const blocked = useMemo(() => {
    if (!settingsLoaded || !countLoaded) return true;
    if (forceOpenActive) return false;
    if (!isReservationOpen) return true;
    return isFull;
  }, [settingsLoaded, countLoaded, forceOpenActive, isReservationOpen, isFull]);

  // 呼び出し中一覧取得（当日分）
  const fetchCallingPatients = async () => {
    setLoading(true);

    const now = nowJST();
    const { s: dayStart, e: dayEnd } = getDayRangeJST(now);

    const qCalling = query(
      collection(db, "reservations"),
      where("status", "==", "呼び出し中"),
      where("createdAt", ">=", Timestamp.fromDate(dayStart)),
      where("createdAt", "<", Timestamp.fromDate(dayEnd))
    );

    const snap = await getDocs(qCalling);

    setCallingPatients(
      snap.docs
        .map((d) => ({ id: d.id, receptionNumber: d.data().receptionNumber }))
        .sort((a, b) => a.receptionNumber - b.receptionNumber)
    );

    setLoading(false);
  };

  useEffect(() => {
    fetchCallingPatients();
  }, []);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (isSubmitting) return;

    setErrorMessage("");

    // ロード前は絶対に通さない（ここが再発防止の核心）
    if (!settingsLoaded || !countLoaded) {
      setErrorMessage("読み込み中です。少し待ってからもう一度お試しください。");
      return;
    }

    // バリデーション
    const kana = formData.name?.trim() || "";
    if (!/^[\u30A0-\u30FF\u30FC\s]+$/.test(kana)) {
      setErrorMessage("お名前はカタカナで入力してください。");
      return;
    }
    if (formData.cardNumber && !/^\d+$/.test(formData.cardNumber)) {
      setErrorMessage("診察券番号は半角数字で入力してください（空欄可）。");
      return;
    }
    const bd = (formData.birthdate || "").trim();
    if (!/^\d{8}$/.test(bd)) {
      setErrorMessage("生年月日は8桁の半角数字（YYYYMMDD）で入力してください。");
      return;
    }

    if (blocked) {
      alert("申し訳ありません。現在、予約受付を停止しています。");
      return;
    }

    setIsSubmitting(true);

    try {
      const { receptionNumber: nextNo } = await createReservation({
        type: "再診",
        name: formData.name,
        birthdate: bd,
        cardNumber: formData.cardNumber || "",
        status: "未受付",
      });

      setReceptionNumber(nextNo);
      setFormData({ name: "", cardNumber: "", birthdate: "" });
      await fetchCallingPatients();
    } catch (err) {
  console.error(err);
  setErrorMessage(err?.message || "予約に失敗しました。もう一度お試しください。");
} finally {
  setIsSubmitting(false);
}
  };

  const showBlockedBanner = (!forceOpenActive && (blocked || isFull || !isReservationOpen)) && settingsLoaded && countLoaded;

  return (
    <div className="flex flex-col items-center justify-center p-4 w-full max-w-lg mx-auto">
      <img src="/logo.png" alt="けんおう皮フ科クリニック" className="w-40 h-40 mb-6" />

      <h2 className="text-3xl font-bold">けんおう皮フ科クリニック</h2>
      <h3 className="text-2xl font-semibold mb-6">再診予約</h3>

      {(!settingsLoaded || !countLoaded) && (
        <div className="text-gray-600 font-bold mb-4">読み込み中…</div>
      )}

      {showBlockedBanner && (
        <div className="text-red-600 font-bold mb-4">
          ⛔ 本日の予約上限に達しました。受付を締め切りました。
        <p className="text-lg font-bold">※web予約人数が上限に達しても、予約受付時間内</p>
        <p className="text-lg font-bold">(午前は9時30分～12時30分、午後は15時～18時(土曜は9時30分～15時まで))に直接ご来院いただければ診察いたします。</p>
        </div>
      )}

      {receptionNumber ? (
        <div className="text-center">
          <p className="text-lg font-bold">予約が完了しました！</p>
          <p className="text-6xl font-extrabold text-green-500 my-4">{receptionNumber}</p>

          <div className="w-full flex justify-center">
            <img src="/yoro.png" alt="チンおう" className="w-40 h-40 mb-6" />
          </div>

          <p className="text-2xl text-red-600 font-bold mt-4">
            ※受付番号を表示した画面をスクショして受付にお見せください。<br />
          </p>

          <Link href="/" className="mt-6 inline-block px-8 py-4 bg-blue-500 text-white text-2xl font-bold rounded-lg hover:bg-blue-700">
            トップに戻る
          </Link>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="w-full max-w-md flex flex-col gap-6">
          <input
            type="text"
            name="name"
            value={formData.name}
            onChange={handleChange}
            placeholder="お名前をカタカナで（例：ケンオウ ハナコ）"
            required
            className="border p-4 rounded-md text-lg"
          />

          <BirthdateInput
            name="birthdate"
            value={formData.birthdate}
            onChange={(v) => setFormData((p) => ({ ...p, birthdate: v }))}
          />

          <input
            type="text"
            name="cardNumber"
            value={formData.cardNumber}
            onChange={handleChange}
            placeholder="診察券番号（空欄可）"
            className="border p-4 rounded-md text-lg"
          />

          {errorMessage && <p className="text-red-600 text-sm">{errorMessage}</p>}

          <button
            type="submit"
            disabled={blocked || isSubmitting}
            className={`px-8 py-6 bg-green-500 text-white text-2xl font-bold rounded-lg ${
              blocked || isSubmitting ? "opacity-50 cursor-not-allowed" : "hover:bg-green-700"
            }`}
          >
            {isSubmitting ? "送信中…" : "予約する"}
          </button>
        </form>
      )}
    </div>
  );
}
