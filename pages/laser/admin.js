import React, { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { db } from "../../firebaseConfig";
import {
  doc, getDoc, setDoc, deleteDoc, getDocs, writeBatch,
  collection, query, where, runTransaction, serverTimestamp,
} from "firebase/firestore";
import { nowJST, isoDateKey } from "../../utils/timeJST";

const DAY_NAMES = ["日", "月", "火", "水", "木", "金", "土"];
const TIME_SLOTS = [
  "09:30","10:00","10:30","11:00","11:30","12:00","12:30",
  "13:00","13:30","14:00","14:30","15:00","15:30","16:00","16:30","17:00","17:30",
  "18:00","18:30",
];
const CORRECT_PASSWORD = "1112";
const AUTO_REFRESH_SEC = 30;

function newId() {
  return Date.now().toString(36) + Math.random().toString(36).substr(2, 4);
}

function genToken() {
  const a = Math.random().toString(36).substr(2, 4).toUpperCase();
  const b = Math.random().toString(36).substr(2, 4).toUpperCase();
  return a + b;
}

function addMinutes(timeStr, minutes) {
  const [h, m] = timeStr.split(":").map(Number);
  const total = h * 60 + m + minutes;
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

export default function LaserAdminPage() {
  const [password, setPassword] = useState("");
  const [authorized, setAuthorized] = useState(false);

  // ─── 設定 ───
  const [settings, setSettings] = useState({
    bookingEnabled: true,
    availableDays: [1, 4, 5, 6],
    unavailableDates: [],
    treatmentTypes: [],
  });
  const [togglingBooking, setTogglingBooking] = useState(false);
  const [newUnavailDate, setNewUnavailDate] = useState("");
  const [newTypeName, setNewTypeName] = useState("");
  const [newTypeSlots, setNewTypeSlots] = useState(1);
  const [savingSettings, setSavingSettings] = useState(false);

  // メニュー編集
  const [editingTypeId, setEditingTypeId] = useState(null);
  const [editName, setEditName] = useState("");
  const [editSlots, setEditSlots] = useState(1);

  // ─── 予約データ ───
  const [filterDate, setFilterDate] = useState(isoDateKey(nowJST()));
  const filterDateRef = useRef(filterDate);
  const [dayReservations, setDayReservations] = useState([]);
  const [loadingDay, setLoadingDay] = useState(false);
  const [futureReservations, setFutureReservations] = useState([]);
  const [loadingFuture, setLoadingFuture] = useState(false);
  const [lastRefreshed, setLastRefreshed] = useState(null);

  // ─── 手動予約追加フォーム ───
  const [showAddForm, setShowAddForm] = useState(false);
  const [addDate, setAddDate] = useState(isoDateKey(nowJST()));
  const [addTime, setAddTime] = useState(TIME_SLOTS[0]);
  const [addTypeId, setAddTypeId] = useState("");
  const [addName, setAddName] = useState("");
  const [addPhone, setAddPhone] = useState("");
  const [addCardNumber, setAddCardNumber] = useState("");
  const [addingReservation, setAddingReservation] = useState(false);

  // filterDate が変わったら ref を更新
  useEffect(() => { filterDateRef.current = filterDate; }, [filterDate]);

  // ─── 認証（他の管理画面からの遷移時はスキップ）───
  useEffect(() => {
    if (typeof sessionStorage !== "undefined" && sessionStorage.getItem("adminAuth") === "1") {
      setAuthorized(true);
    }
  }, []);

  const handleLogin = () => {
    if (password === CORRECT_PASSWORD) {
      sessionStorage.setItem("adminAuth", "1");
      setAuthorized(true);
    } else {
      alert("パスワードが違います。");
    }
  };

  // ─── データ読み込み ───
  const loadSettings = async () => {
    const snap = await getDoc(doc(db, "laserSettings", "clinic"));
    if (snap.exists()) {
      const data = snap.data();
      // bookingEnabled が未定義の旧データでは true として扱う
      setSettings({ bookingEnabled: data.bookingEnabled !== false, ...data });
    }
  };

  const toggleBookingEnabled = async () => {
    const next = !(settings.bookingEnabled !== false);
    const label = next ? "予約受付を再開" : "予約受付を停止";
    if (!confirm(`${label}しますか？`)) return;
    setTogglingBooking(true);
    const updated = { ...settings, bookingEnabled: next };
    await setDoc(doc(db, "laserSettings", "clinic"), updated);
    setSettings(updated);
    setTogglingBooking(false);
  };

  const mergeReservations = (regularDocs, flexDocs) => {
    const regular = regularDocs
      .map((d) => ({ id: d.id, ...d.data(), source: "regular" }))
      .filter((r) => !r.blocked);
    const flex = flexDocs.map((d) => ({ id: d.id, ...d.data(), source: "flex" }));
    return [...regular, ...flex].sort((a, b) => a.timeSlot.localeCompare(b.timeSlot));
  };

  const loadDayReservations = async (date) => {
    setLoadingDay(true);
    const [s1, s2] = await Promise.all([
      getDocs(query(collection(db, "laserReservations"), where("dateISO", "==", date))),
      getDocs(query(collection(db, "laserFlexReservations"), where("dateISO", "==", date))),
    ]);
    setDayReservations(mergeReservations(s1.docs, s2.docs));
    setLoadingDay(false);
    setLastRefreshed(new Date());
  };

  const loadFutureReservations = async () => {
    setLoadingFuture(true);
    const todayISO = isoDateKey(nowJST());
    const [s1, s2] = await Promise.all([
      getDocs(collection(db, "laserReservations")),
      getDocs(collection(db, "laserFlexReservations")),
    ]);
    const regular = s1.docs
      .map((d) => ({ id: d.id, ...d.data(), source: "regular" }))
      .filter((r) => !r.blocked && r.dateISO >= todayISO);
    const flex = s2.docs
      .map((d) => ({ id: d.id, ...d.data(), source: "flex" }))
      .filter((r) => r.dateISO >= todayISO);
    setFutureReservations(
      [...regular, ...flex].sort((a, b) =>
        a.dateISO !== b.dateISO ? a.dateISO.localeCompare(b.dateISO) : a.timeSlot.localeCompare(b.timeSlot)
      )
    );
    setLoadingFuture(false);
  };

  // ─── 初回ロード ───
  useEffect(() => {
    if (!authorized) return;
    loadSettings();
    loadDayReservations(filterDate);
    loadFutureReservations();
  }, [authorized]);

  // ─── 日付変更時 ───
  useEffect(() => {
    if (!authorized) return;
    loadDayReservations(filterDate);
  }, [filterDate]);

  // ─── 自動更新（30秒ごと）───
  useEffect(() => {
    if (!authorized) return;
    const id = setInterval(() => {
      loadDayReservations(filterDateRef.current);
      loadFutureReservations();
    }, AUTO_REFRESH_SEC * 1000);
    return () => clearInterval(id);
  }, [authorized]);

  // ─── 設定操作 ───
  const saveSettings = async () => {
    setSavingSettings(true);
    await setDoc(doc(db, "laserSettings", "clinic"), settings);
    setSavingSettings(false);
    alert("設定を保存しました。");
  };

  const toggleDay = (day) =>
    setSettings((prev) => ({
      ...prev,
      availableDays: prev.availableDays.includes(day)
        ? prev.availableDays.filter((d) => d !== day)
        : [...prev.availableDays, day].sort((a, b) => a - b),
    }));

  const addUnavailDate = () => {
    if (!newUnavailDate) return;
    if ((settings.unavailableDates || []).includes(newUnavailDate)) { alert("すでに登録されています。"); return; }
    setSettings((prev) => ({
      ...prev,
      unavailableDates: [...(prev.unavailableDates || []), newUnavailDate].sort(),
    }));
    setNewUnavailDate("");
  };

  const removeUnavailDate = (d) =>
    setSettings((prev) => ({ ...prev, unavailableDates: (prev.unavailableDates || []).filter((x) => x !== d) }));

  // ─── メニュー操作 ───
  const addTreatmentType = () => {
    if (!newTypeName.trim()) return alert("メニュー名を入力してください。");
    const slots = parseInt(newTypeSlots);
    if (isNaN(slots) || slots < 0) return alert("枠数は0以上の整数で入力してください。");
    setSettings((prev) => ({
      ...prev,
      treatmentTypes: [...(prev.treatmentTypes || []), { id: newId(), name: newTypeName.trim(), slots }],
    }));
    setNewTypeName("");
    setNewTypeSlots(1);
  };

  const removeTreatmentType = (id) =>
    setSettings((prev) => ({ ...prev, treatmentTypes: (prev.treatmentTypes || []).filter((t) => t.id !== id) }));

  const moveTypeUp = (index) => {
    if (index === 0) return;
    setSettings((prev) => {
      const types = [...prev.treatmentTypes];
      [types[index - 1], types[index]] = [types[index], types[index - 1]];
      return { ...prev, treatmentTypes: types };
    });
  };

  const moveTypeDown = (index) => {
    setSettings((prev) => {
      const types = [...prev.treatmentTypes];
      if (index === types.length - 1) return prev;
      [types[index], types[index + 1]] = [types[index + 1], types[index]];
      return { ...prev, treatmentTypes: types };
    });
  };

  const startEdit = (t) => {
    setEditingTypeId(t.id);
    setEditName(t.name);
    setEditSlots(t.slots);
  };

  const saveEdit = () => {
    if (!editName.trim()) return alert("メニュー名を入力してください。");
    const slots = parseInt(editSlots);
    if (isNaN(slots) || slots < 0) return alert("枠数は0以上の整数で入力してください。");
    setSettings((prev) => ({
      ...prev,
      treatmentTypes: prev.treatmentTypes.map((t) =>
        t.id === editingTypeId ? { ...t, name: editName.trim(), slots } : t
      ),
    }));
    setEditingTypeId(null);
  };

  // ─── 手動予約追加 ───
  const resetAddForm = () => {
    setAddTypeId("");
    setAddName("");
    setAddPhone("");
    setAddCardNumber("");
  };

  const submitAddReservation = async () => {
    if (addingReservation) return;
    const type = (settings.treatmentTypes || []).find((t) => t.id === addTypeId);
    if (!type) return alert("施術メニューを選択してください。");
    const trimName = addName.trim();
    const trimPhone = addPhone.trim();
    if (!trimName) return alert("お名前を入力してください。");
    if (!/^\d{10,11}$/.test(trimPhone))
      return alert("電話番号は10〜11桁の半角数字で入力してください（ハイフンなし）。");

    const slotsNeeded = type.slots;
    const startIndex = TIME_SLOTS.indexOf(addTime);
    if (startIndex < 0) return alert("時間が不正です。");

    setAddingReservation(true);
    const token = genToken();
    const isFlex = slotsNeeded === 0;
    const endTime = isFlex ? null : addMinutes(addTime, slotsNeeded * 30);

    try {
      if (isFlex) {
        const slotRef = doc(db, "laserReservations", `${addDate}_${addTime}`);
        const slotSnap = await getDoc(slotRef);
        if (slotSnap.exists()) {
          const data = slotSnap.data();
          if (data.blocked || (data.slotsUsed || 0) >= 2) throw new Error("BLOCKED");
        }
        await setDoc(doc(db, "laserFlexReservations", token), {
          dateISO: addDate, timeSlot: addTime, treatmentType: type.name, slotsUsed: 0,
          name: trimName, phone: trimPhone, cardNumber: addCardNumber.trim(),
          cancelToken: token, createdAt: serverTimestamp(),
        });
      } else {
        if (startIndex + slotsNeeded > TIME_SLOTS.length) throw new Error("OUT_OF_RANGE");
        await runTransaction(db, async (tx) => {
          for (let i = 0; i < slotsNeeded; i++) {
            const slotTime = TIME_SLOTS[startIndex + i];
            const ref = doc(db, "laserReservations", `${addDate}_${slotTime}`);
            const snap = await tx.get(ref);
            if (snap.exists()) throw new Error("TAKEN");
          }
          tx.set(doc(db, "laserReservations", `${addDate}_${addTime}`), {
            dateISO: addDate, timeSlot: addTime, endTime, treatmentType: type.name,
            slotsUsed: slotsNeeded, name: trimName, phone: trimPhone,
            cardNumber: addCardNumber.trim(), cancelToken: token, createdAt: serverTimestamp(),
          });
          for (let i = 1; i < slotsNeeded; i++) {
            const slotTime = TIME_SLOTS[startIndex + i];
            tx.set(doc(db, "laserReservations", `${addDate}_${slotTime}`), {
              dateISO: addDate, timeSlot: slotTime, blocked: true,
              parentId: `${addDate}_${addTime}`,
            });
          }
        });
      }
      alert(`予約を登録しました。\nキャンセル番号: ${token}`);
      resetAddForm();
      setFilterDate(addDate);
      await loadDayReservations(addDate);
      await loadFutureReservations();
    } catch (err) {
      if (err.message === "TAKEN") alert("選択した時間帯はすでに予約があります。");
      else if (err.message === "BLOCKED") alert("選択した時間は他の施術中のため予約できません。");
      else if (err.message === "OUT_OF_RANGE") alert("選択した時間では施術時間内に終了できません。");
      else alert("予約の登録に失敗しました: " + err.message);
    } finally {
      setAddingReservation(false);
    }
  };

  // ─── 予約削除 ───
  const deleteReservation = async (r) => {
    const label = `${r.name} 様（${r.timeSlot}）`;
    if (!confirm(`${label}の予約を削除しますか？`)) return;
    if (r.source === "flex") {
      await deleteDoc(doc(db, "laserFlexReservations", r.id));
    } else {
      const slotsUsed = r.slotsUsed || 1;
      const startIndex = TIME_SLOTS.indexOf(r.timeSlot);
      const batch = writeBatch(db);
      for (let i = 0; i < slotsUsed; i++) {
        const slotTime = TIME_SLOTS[startIndex + i];
        if (slotTime) batch.delete(doc(db, "laserReservations", `${r.dateISO}_${slotTime}`));
      }
      await batch.commit();
    }
    await loadDayReservations(filterDateRef.current);
    await loadFutureReservations();
  };

  // ─── 認証UI ───
  if (!authorized) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen p-4">
        <img src="/logo.png" alt="けんおう皮フ科クリニック" className="w-24 h-24 mb-4" />
        <h1 className="text-3xl font-bold mb-6">レーザー脱毛 管理画面</h1>
        <input type="password" value={password}
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") handleLogin(); }}
          className="border rounded p-3 text-xl mb-4 w-full max-w-xs text-center"
          placeholder="パスワード" autoFocus />
        <button onClick={handleLogin}
          className="px-8 py-3 bg-blue-500 text-white text-xl font-bold rounded hover:bg-blue-700">
          ログイン
        </button>
      </div>
    );
  }

  // ─── 予約テーブル ───
  const ReservationTable = ({ rows, showDate = false }) =>
    rows.length === 0 ? (
      <p className="text-gray-400">予約はありません。</p>
    ) : (
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="bg-gray-100">
              {showDate && <th className="border p-2 text-left">日付</th>}
              <th className="border p-2 text-left">時間</th>
              <th className="border p-2 text-left">施術メニュー</th>
              <th className="border p-2 text-left">名前</th>
              <th className="border p-2 text-left">電話番号</th>
              <th className="border p-2 text-left">診察券番号</th>
              <th className="border p-2 text-center">操作</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id + r.source} className={`hover:bg-gray-50 ${r.source === "flex" ? "bg-purple-50" : ""}`}>
                {showDate && <td className="border p-2">{r.dateISO}</td>}
                <td className="border p-2 font-bold whitespace-nowrap">
                  {r.timeSlot}{r.endTime ? ` 〜 ${r.endTime}` : ""}
                  {r.source === "flex" && <span className="ml-1 text-xs text-purple-500 font-normal">（同時）</span>}
                </td>
                <td className="border p-2">{r.treatmentType}</td>
                <td className="border p-2">{r.name}</td>
                <td className="border p-2">{r.phone}</td>
                <td className="border p-2">{r.cardNumber || "—"}</td>
                <td className="border p-2 text-center">
                  <button onClick={() => deleteReservation(r)}
                    className="px-3 py-1 bg-red-500 text-white rounded text-sm font-bold hover:bg-red-700">
                    削除
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );

  const refreshedStr = lastRefreshed
    ? `${String(lastRefreshed.getHours()).padStart(2,"0")}:${String(lastRefreshed.getMinutes()).padStart(2,"0")}:${String(lastRefreshed.getSeconds()).padStart(2,"0")}`
    : "—";

  const SaveButton = () => (
    <button onClick={saveSettings} disabled={savingSettings}
      className={`px-8 py-3 text-white font-bold rounded text-lg ${
        savingSettings ? "bg-blue-300 cursor-not-allowed" : "bg-blue-500 hover:bg-blue-700"
      }`}>
      {savingSettings ? "保存中..." : "設定を保存"}
    </button>
  );

  return (
    <>
      <div className="relative w-full flex items-center justify-center px-6 py-3">
        <img
          src="/nishiki.png"
          alt="ニシキ"
          className="h-14 w-auto sm:h-16 md:h-20 object-contain"
        />
        <Link href="/admin" className="absolute right-6 text-blue-600 font-bold text-lg underline">
          ← 通常予約管理
        </Link>
      </div>

      <div className="p-4 max-w-5xl mx-auto">
        <div className="flex items-center justify-between mb-6 flex-wrap gap-2">
          <h1 className="text-2xl font-bold">レーザー脱毛 管理画面</h1>
          <Link href="/laser" className="text-green-500 underline text-lg">患者用予約ページ →</Link>
        </div>

      {/* 予約受付オンオフ */}
      {(() => {
        const enabled = settings.bookingEnabled !== false;
        return (
          <section className={`border-2 rounded-xl p-4 mb-6 ${
            enabled ? "bg-green-50 border-green-400" : "bg-red-50 border-red-400"
          }`}>
            <div className="flex items-center justify-between flex-wrap gap-3">
              <div>
                <p className="text-sm text-gray-600 mb-1">予約受付ステータス</p>
                <p className={`text-2xl font-bold ${enabled ? "text-green-700" : "text-red-700"}`}>
                  {enabled ? "🟢 受付中" : "🔴 停止中"}
                </p>
                <p className="text-xs text-gray-500 mt-1">
                  {enabled
                    ? "患者は通常通り予約できます。"
                    : "患者画面に「予約受付停止中」と表示され、新規予約はできません。"}
                </p>
              </div>
              <button onClick={toggleBookingEnabled} disabled={togglingBooking}
                className={`px-6 py-3 text-white font-bold rounded-xl text-lg ${
                  togglingBooking ? "bg-gray-400 cursor-not-allowed"
                    : enabled ? "bg-red-500 hover:bg-red-700"
                    : "bg-green-500 hover:bg-green-700"
                }`}>
                {togglingBooking ? "更新中..." : enabled ? "予約受付を停止" : "予約受付を再開"}
              </button>
            </div>
          </section>
        );
      })()}

      {/* ① 設定（曜日・休診日）*/}
      <section className="bg-gray-50 border rounded-xl p-4 mb-6">
        <h2 className="text-xl font-bold mb-4">⚙️ 設定</h2>

        <div className="mb-6">
          <p className="font-bold mb-2">予約可能曜日</p>
          <div className="flex gap-3 flex-wrap">
            {DAY_NAMES.map((name, i) => (
              <label key={i} className="flex items-center gap-2 cursor-pointer text-lg">
                <input type="checkbox"
                  checked={(settings.availableDays || []).includes(i)}
                  onChange={() => toggleDay(i)}
                  className="w-5 h-5" />
                {name}
              </label>
            ))}
          </div>
          <p className="text-xs text-gray-400 mt-1">※日曜は自動的に12:00までの受付になります</p>
        </div>

        <div className="mb-6">
          <p className="font-bold mb-2">特定の休診日（日付指定）</p>
          <div className="flex gap-2 mb-3 flex-wrap">
            <input type="date" value={newUnavailDate} onChange={(e) => setNewUnavailDate(e.target.value)}
              className="border rounded p-2 text-sm" />
            <button onClick={addUnavailDate}
              className="px-4 py-2 bg-red-500 text-white rounded font-bold text-sm hover:bg-red-700">追加</button>
          </div>
          <div className="flex flex-wrap gap-2">
            {(settings.unavailableDates || []).map((d) => (
              <div key={d} className="flex items-center gap-1 bg-red-100 border border-red-300 px-3 py-1 rounded text-sm">
                <span>{d}</span>
                <button onClick={() => removeUnavailDate(d)} className="text-red-600 font-bold ml-1 text-base leading-none">×</button>
              </div>
            ))}
            {(settings.unavailableDates || []).length === 0 && <span className="text-gray-400 text-sm">なし</span>}
          </div>
        </div>

        <SaveButton />
      </section>

      {/* ② 日別予約一覧 */}
      <section className="bg-white border rounded-xl p-4 mb-6">
        <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
          <h2 className="text-xl font-bold">📅 日別予約一覧</h2>
          <span className="text-xs text-gray-400">最終更新 {refreshedStr}（{AUTO_REFRESH_SEC}秒ごと自動更新）</span>
        </div>
        <p className="text-xs text-purple-600 mb-2">紫の行 = 脇など同時施術可のメニュー</p>
        <div className="flex items-center gap-2 mb-4 flex-wrap">
          <input type="date" value={filterDate} onChange={(e) => setFilterDate(e.target.value)}
            className="border rounded p-2 text-lg" />
          <button onClick={() => loadDayReservations(filterDate)}
            className="px-4 py-2 bg-gray-200 rounded font-bold hover:bg-gray-300">更新</button>
          <button onClick={() => { setAddDate(filterDate); setShowAddForm((v) => !v); }}
            className={`px-4 py-2 rounded font-bold text-white ${
              showAddForm ? "bg-gray-500 hover:bg-gray-700" : "bg-green-500 hover:bg-green-700"
            }`}>
            {showAddForm ? "フォームを閉じる" : "＋ 予約を追加"}
          </button>
        </div>

        {showAddForm && (
          <div className="bg-green-50 border-2 border-green-300 rounded-lg p-4 mb-4">
            <h3 className="font-bold mb-3 text-green-800">手動で予約を追加</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
              <div>
                <label className="block text-xs font-bold text-gray-600 mb-1">日付</label>
                <input type="date" value={addDate} onChange={(e) => setAddDate(e.target.value)}
                  className="border rounded p-2 w-full" disabled={addingReservation} />
              </div>
              <div>
                <label className="block text-xs font-bold text-gray-600 mb-1">時間</label>
                <select value={addTime} onChange={(e) => setAddTime(e.target.value)}
                  className="border rounded p-2 w-full" disabled={addingReservation}>
                  {TIME_SLOTS.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div className="md:col-span-2">
                <label className="block text-xs font-bold text-gray-600 mb-1">施術メニュー <span className="text-red-500">*</span></label>
                <select value={addTypeId} onChange={(e) => setAddTypeId(e.target.value)}
                  className="border rounded p-2 w-full" disabled={addingReservation}>
                  <option value="">— メニューを選択 —</option>
                  {(settings.treatmentTypes || []).map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}（{t.slots === 0 ? "同時可" : `${t.slots}枠 / ${t.slots * 30}分`}）
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-bold text-gray-600 mb-1">お名前 <span className="text-red-500">*</span></label>
                <input type="text" value={addName} onChange={(e) => setAddName(e.target.value)}
                  className="border rounded p-2 w-full" placeholder="例: 山田 花子" disabled={addingReservation} />
              </div>
              <div>
                <label className="block text-xs font-bold text-gray-600 mb-1">電話番号 <span className="text-red-500">*</span></label>
                <input type="tel" value={addPhone} onChange={(e) => setAddPhone(e.target.value)}
                  className="border rounded p-2 w-full" placeholder="ハイフンなし 10〜11桁" disabled={addingReservation} />
              </div>
              <div className="md:col-span-2">
                <label className="block text-xs font-bold text-gray-600 mb-1">診察券番号（任意）</label>
                <input type="text" value={addCardNumber} onChange={(e) => setAddCardNumber(e.target.value)}
                  className="border rounded p-2 w-full" placeholder="例: 123456" disabled={addingReservation} />
              </div>
            </div>
            <div className="flex gap-2">
              <button onClick={submitAddReservation} disabled={addingReservation}
                className={`px-6 py-2 text-white font-bold rounded ${
                  addingReservation ? "bg-green-300 cursor-not-allowed" : "bg-green-500 hover:bg-green-700"
                }`}>
                {addingReservation ? "登録中..." : "予約を登録"}
              </button>
              <button onClick={() => { resetAddForm(); setShowAddForm(false); }} disabled={addingReservation}
                className="px-6 py-2 bg-gray-300 font-bold rounded hover:bg-gray-400">
                キャンセル
              </button>
            </div>
          </div>
        )}

        {loadingDay ? <p className="text-gray-500">読み込み中...</p> : <ReservationTable rows={dayReservations} />}
      </section>

      {/* ③ 今後の全予約 */}
      <section className="bg-white border rounded-xl p-4 mb-6">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-xl font-bold">📋 今後の予約（全件）</h2>
          <button onClick={loadFutureReservations} className="text-sm text-blue-500 underline">更新</button>
        </div>
        <p className="text-xs text-purple-600 mb-2">紫の行 = 脇など同時施術可のメニュー</p>
        {loadingFuture ? <p className="text-gray-500">読み込み中...</p> : <ReservationTable rows={futureReservations} showDate />}
      </section>

      {/* ④ 施術メニュー管理 */}
      <section className="bg-gray-50 border rounded-xl p-4 mb-6">
        <h2 className="text-xl font-bold mb-1">🗒️ 施術メニュー</h2>
        <p className="text-xs text-gray-500 mb-4">変更後は「設定を保存」を押すまで患者画面に反映されません。</p>

        <div className="space-y-1 mb-4">
          {(settings.treatmentTypes || []).length === 0 && (
            <p className="text-gray-400 text-sm">メニューが登録されていません</p>
          )}
          {(settings.treatmentTypes || []).map((t, index) => (
            <div key={t.id}>
              {editingTypeId === t.id ? (
                <div className="flex gap-2 items-center flex-wrap bg-yellow-50 border border-yellow-300 rounded-lg p-2">
                  <input type="text" value={editName} onChange={(e) => setEditName(e.target.value)}
                    className="border rounded p-1 text-sm flex-1 min-w-40" />
                  <div className="flex items-center gap-1">
                    <label className="text-xs text-gray-500">枠数</label>
                    <input type="number" value={editSlots} onChange={(e) => setEditSlots(e.target.value)}
                      min={0} max={17} className="border rounded p-1 w-14 text-sm" />
                  </div>
                  <button onClick={saveEdit}
                    className="px-3 py-1 bg-blue-500 text-white rounded text-sm font-bold hover:bg-blue-700">保存</button>
                  <button onClick={() => setEditingTypeId(null)}
                    className="px-3 py-1 bg-gray-300 rounded text-sm font-bold hover:bg-gray-400">キャンセル</button>
                </div>
              ) : (
                <div className="flex items-center gap-1 bg-white border rounded-lg p-2">
                  <div className="flex flex-col mr-1">
                    <button onClick={() => moveTypeUp(index)} disabled={index === 0}
                      className="text-gray-400 hover:text-gray-700 disabled:opacity-20 leading-none text-xs px-1">▲</button>
                    <button onClick={() => moveTypeDown(index)}
                      disabled={index === (settings.treatmentTypes || []).length - 1}
                      className="text-gray-400 hover:text-gray-700 disabled:opacity-20 leading-none text-xs px-1">▼</button>
                  </div>
                  <span className="flex-1 text-sm">{t.name}</span>
                  <span className="text-xs text-gray-400 mr-2">
                    {t.slots === 0 ? "0枠（同時可）" : `${t.slots}枠`}
                  </span>
                  <button onClick={() => startEdit(t)}
                    className="px-2 py-1 bg-yellow-400 text-white rounded text-xs font-bold hover:bg-yellow-600 mr-1">編集</button>
                  <button onClick={() => removeTreatmentType(t.id)}
                    className="px-2 py-1 bg-red-500 text-white rounded text-xs font-bold hover:bg-red-700">削除</button>
                </div>
              )}
            </div>
          ))}
        </div>

        {/* メニュー追加 */}
        <div className="flex gap-2 flex-wrap items-end border-t pt-3 mb-4">
          <div>
            <label className="text-xs block mb-1 text-gray-600">メニュー名</label>
            <input type="text" value={newTypeName} onChange={(e) => setNewTypeName(e.target.value)}
              className="border rounded p-2 text-sm w-48" placeholder="例: 両膝 ¥6,600"
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addTreatmentType(); } }} />
          </div>
          <div>
            <label className="text-xs block mb-1 text-gray-600">枠数（0=同時可）</label>
            <input type="number" value={newTypeSlots} onChange={(e) => setNewTypeSlots(e.target.value)}
              min={0} max={17} className="border rounded p-2 w-16 text-sm" />
          </div>
          <button onClick={addTreatmentType}
            className="px-4 py-2 bg-green-500 text-white rounded font-bold text-sm hover:bg-green-700">
            追加
          </button>
        </div>

        <SaveButton />
      </section>
      </div>
    </>
  );
}
