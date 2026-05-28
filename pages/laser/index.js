import React, { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/router";
import { db } from "../../firebaseConfig";
import { doc, getDoc, getDocs, collection, query, where } from "firebase/firestore";
import { nowJST, isoDateKey } from "../../utils/timeJST";

const TIME_SLOTS = [
  "09:30","10:00","10:30","11:00","11:30","12:00","12:30",
  "13:00","13:30","14:00","14:30","15:00","15:30","16:00","16:30","17:00","17:30",
  "18:00","18:30",
];
const DAY_NAMES = ["日","月","火","水","木","金","土"];
// 日曜: 施術が12:00までに終了すること。11:30(index 4)が最後の有効開始スロット
const SUNDAY_CUTOFF = 4;

export default function LaserIndexPage() {
  const router = useRouter();
  const [settings, setSettings] = useState({ bookingEnabled: true, availableDays: [], unavailableDates: [], treatmentTypes: [] });
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [selectedType, setSelectedType] = useState(null);
  const [selectedDate, setSelectedDate] = useState(null);
  // booked = laserReservations に何らかのdocがあるスロット（通常予約チェック用）
  // flexBlocked = 0枠予約NGスロット（継続枠 + 全身など複数枠施術の開始枠）
  const [slotStatus, setSlotStatus] = useState({ booked: new Set(), flexBlocked: new Set() });
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [calendarMonth, setCalendarMonth] = useState(() => {
    const now = nowJST();
    return { year: now.getFullYear(), month: now.getMonth() };
  });

  useEffect(() => {
    (async () => {
      const snap = await getDoc(doc(db, "laserSettings", "clinic"));
      if (snap.exists()) setSettings(snap.data());
      setSettingsLoaded(true);
    })();
  }, []);

  useEffect(() => {
    if (!selectedDate) return;
    setLoadingSlots(true);
    (async () => {
      const snap = await getDocs(
        query(collection(db, "laserReservations"), where("dateISO", "==", selectedDate))
      );
      const all = snap.docs.map((d) => d.data());
      const booked = new Set(all.map((d) => d.timeSlot));
      // 0枠（脇）予約NG: 継続枠（blocked）+ 複数枠施術（slotsUsed>=2、例: 全身）の開始枠
      const flexBlocked = new Set(
        all
          .filter((d) => d.blocked || (d.slotsUsed || 0) >= 2)
          .map((d) => d.timeSlot)
      );
      setSlotStatus({ booked, flexBlocked });
      setLoadingSlots(false);
    })();
  }, [selectedDate]);

  const now = nowJST();
  const todayISO = isoDateKey(now);
  const maxDate = new Date(now);
  maxDate.setMonth(maxDate.getMonth() + 2);
  const maxISO = isoDateKey(maxDate);

  const isDateAvailable = (dateISO) => {
    if (!settingsLoaded || !selectedType) return false;
    if (dateISO < todayISO || dateISO > maxISO) return false;
    const dow = new Date(dateISO + "T00:00:00").getDay();
    if (!(settings.availableDays || []).includes(dow)) return false;
    if ((settings.unavailableDates || []).includes(dateISO)) return false;
    return true;
  };

  const isValidStart = (slotIndex, dateISO) => {
    const n = selectedType?.slots ?? 1;
    const { booked, flexBlocked } = slotStatus;

    // 日曜12時制限: 0枠は1枠相当として扱う
    if (new Date(dateISO + "T00:00:00").getDay() === 0) {
      const effectiveN = n === 0 ? 1 : n;
      const lastAllowed = SUNDAY_CUTOFF - (effectiveN - 1);
      if (slotIndex > lastAllowed) return false;
    }

    if (n === 0) {
      // 0枠（脇）: 継続枠と複数枠施術中（全身など）は予約不可
      return !flexBlocked.has(TIME_SLOTS[slotIndex]);
    } else {
      // N枠: N連続スロットがすべて空きであること
      for (let i = 0; i < n; i++) {
        if (slotIndex + i >= TIME_SLOTS.length) return false;
        if (booked.has(TIME_SLOTS[slotIndex + i])) return false;
      }
      return true;
    }
  };

  const buildCalendar = () => {
    const { year, month } = calendarMonth;
    const firstDay = new Date(year, month, 1).getDay();
    const days = new Date(year, month + 1, 0).getDate();
    const cells = Array(firstDay).fill(null);
    for (let d = 1; d <= days; d++) {
      cells.push(`${year}-${String(month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`);
    }
    return cells;
  };

  const treatmentTypes = settings.treatmentTypes || [];

  return (
    <div className="flex flex-col items-center p-4 min-h-screen">
      <img src="/logo.png" alt="けんおう皮フ科クリニック" className="w-32 h-32 mb-4" />
      <h1 className="text-3xl font-bold mb-1 text-center">レーザー脱毛 予約</h1>
      <Link href="/" className="text-blue-500 underline mb-6">← 皮膚科（通常予約）へ</Link>

      {settingsLoaded && settings.bookingEnabled === false ? (
        <div className="w-full max-w-md bg-red-50 border-2 border-red-400 rounded-xl p-6 text-center">
          <p className="text-2xl font-bold text-red-700 mb-2">予約受付を停止しています</p>
          <p className="text-gray-700">
            現在、レーザー脱毛のオンライン予約は受け付けておりません。<br />
            お電話または直接ご来院にてお問い合わせください。
          </p>
          <div className="mt-6">
            <Link href="/laser/cancel" className="text-red-500 underline">予約のキャンセルはこちら</Link>
          </div>
        </div>
      ) : (
      <>
      <div className="w-full max-w-md bg-yellow-50 border-2 border-yellow-400 rounded-xl p-4 mb-6 text-center">
        <p className="text-base font-bold text-yellow-800">
          女性の顔脱毛は電話か来院してご予約ください
        </p>
      </div>

      {/* ① 施術メニュー選択 */}
      <div className="w-full max-w-md mb-6">
        <h2 className="text-lg font-bold mb-3">① 施術メニューを選択</h2>
        {!settingsLoaded ? (
          <p className="text-gray-400">読み込み中...</p>
        ) : treatmentTypes.length === 0 ? (
          <p className="text-red-500 text-sm">施術メニューが設定されていません。管理者にお問い合わせください。</p>
        ) : (
          <div className="flex flex-col gap-2">
            {treatmentTypes.map((t) => (
              <button
                key={t.id}
                onClick={() => { setSelectedType(t); setSelectedDate(null); setSlotStatus({ booked: new Set(), flexBlocked: new Set() }); }}
                className={`px-4 py-3 rounded-xl font-bold text-left text-lg border-2 transition-colors ${
                  selectedType?.id === t.id
                    ? "bg-green-500 text-white border-green-500"
                    : "bg-white text-gray-700 border-gray-300 hover:border-green-400"
                }`}
              >
                {t.name}
                {t.slots === 0 && (
                  <span className="text-xs font-normal ml-2 opacity-70">（他の方と同じ時間帯に施術可）</span>
                )}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* ② 日付選択 */}
      {selectedType && (
        <div className="w-full max-w-md mb-6">
          <h2 className="text-lg font-bold mb-3">② 日付を選択</h2>
          <div className="bg-white shadow rounded-xl p-4">
            <div className="flex items-center justify-between mb-3">
              <button
                onClick={() => setCalendarMonth((p) => p.month === 0 ? { year: p.year - 1, month: 11 } : { ...p, month: p.month - 1 })}
                className="text-2xl px-3 py-1 rounded hover:bg-gray-100"
              >‹</button>
              <span className="text-xl font-bold">{calendarMonth.year}年 {calendarMonth.month + 1}月</span>
              <button
                onClick={() => setCalendarMonth((p) => p.month === 11 ? { year: p.year + 1, month: 0 } : { ...p, month: p.month + 1 })}
                className="text-2xl px-3 py-1 rounded hover:bg-gray-100"
              >›</button>
            </div>
            <div className="grid grid-cols-7 gap-1 text-center mb-2">
              {DAY_NAMES.map((d) => <div key={d} className="text-sm font-bold text-gray-500">{d}</div>)}
            </div>
            <div className="grid grid-cols-7 gap-1 text-center">
              {buildCalendar().map((dateISO, i) => {
                if (!dateISO) return <div key={i} />;
                const avail = isDateAvailable(dateISO);
                const sel = selectedDate === dateISO;
                return (
                  <button key={dateISO} disabled={!avail}
                    onClick={() => { setSelectedDate(dateISO); setSlotStatus({ booked: new Set(), flexBlocked: new Set() }); }}
                    className={`py-2 rounded font-bold text-sm transition-colors ${
                      sel ? "bg-green-500 text-white" :
                      avail ? "bg-white border border-green-400 text-green-700 hover:bg-green-50" :
                      "bg-gray-100 text-gray-300 cursor-not-allowed"
                    }`}
                  >
                    {parseInt(dateISO.split("-")[2])}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* ③ 時間選択 */}
      {selectedDate && selectedType && (
        <div className="w-full max-w-md">
          <h2 className="text-lg font-bold mb-2">③ 開始時間を選択</h2>
          {selectedType.slots === 0 ? (
            <p className="text-sm text-gray-500 mb-3">
              他の予約と同じ時間帯でも予約できます。×の時間帯は予約できません。
            </p>
          ) : (
            <p className="text-sm text-gray-500 mb-3">
              {selectedType.name}の予約可能な開始時間
            </p>
          )}
          {loadingSlots ? (
            <p className="text-gray-500 text-center">読み込み中...</p>
          ) : (
            <div className="grid grid-cols-3 gap-3">
              {TIME_SLOTS.map((slot, idx) => {
                const valid = isValidStart(idx, selectedDate);
                return (
                  <button
                    key={slot}
                    disabled={!valid}
                    onClick={() =>
                      router.push(
                        `/laser/book?date=${selectedDate}&time=${encodeURIComponent(slot)}&typeName=${encodeURIComponent(selectedType.name)}&typeSlots=${selectedType.slots}`
                      )
                    }
                    className={`py-4 rounded-xl font-bold text-lg shadow transition-colors ${
                      valid
                        ? "bg-green-500 text-white hover:bg-green-700"
                        : "bg-gray-200 text-gray-400 cursor-not-allowed"
                    }`}
                  >
                    {slot}
                    {!valid && <span className="text-xs block font-normal">×</span>}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      <div className="mt-10 mb-4">
        <Link href="/laser/cancel" className="text-red-500 underline text-lg">予約のキャンセルはこちら</Link>
      </div>
      </>
      )}
    </div>
  );
}
