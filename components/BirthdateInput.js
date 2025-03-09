import React, { useState, useEffect, useRef } from "react";

const BirthdateInput = ({ onChange }) => {
  const currentYear = new Date().getFullYear();
  const startYear = 1900;
  const defaultYear = 1980; // 🔥 1980年をプルダウンの中央に設定
  const years = Array.from({ length: currentYear - startYear + 1 }, (_, i) => startYear + i);
  const months = Array.from({ length: 12 }, (_, i) => i + 1);

  const [year, setYear] = useState("");
  const [month, setMonth] = useState("");
  const [day, setDay] = useState("");
  const [birthdate, setBirthdate] = useState("");
  const [error, setError] = useState("");
  const dayRef = useRef(null);

  // 🔥 年・月を選択すると、日付のリストを更新
  const getDaysInMonth = (y, m) => {
    if (!y || !m) return [];
    return Array.from({ length: new Date(y, m, 0).getDate() }, (_, i) => i + 1);
  };
  const days = getDaysInMonth(year, month);

  // 🔥 選択すると `YYYYMMDD` に変換
  const updateBirthdate = (y, m, d) => {
    if (!y || !m || !d) return;

    const formattedDate = `${y}${String(m).padStart(2, "0")}${String(d).padStart(2, "0")}`;
    setBirthdate(formattedDate);
    setYear(y);
    setMonth(m);
    setDay(d);
    onChange && onChange(formattedDate);
  };

  // 🔥 ドロップダウンの変更処理
  const handleDropdownChange = (type, value) => {
    let newYear = year;
    let newMonth = month;
    let newDay = day;

    if (type === "year") newYear = value === "" ? "" : parseInt(value, 10);
    if (type === "month") newMonth = value === "" ? "" : parseInt(value, 10);
    if (type === "day") newDay = value === "" ? "" : parseInt(value, 10);

    if (newYear && newMonth) {
      const maxDay = getDaysInMonth(newYear, newMonth).length;
      if (newDay > maxDay) newDay = maxDay; // 🔥 無効な日付を修正
    }

    if (newYear && newMonth && newDay) {
      if (validateDate(newYear, newMonth, newDay)) {
        updateBirthdate(newYear, newMonth, newDay);
        setError("");
      }
    } else {
      setBirthdate("");
      setYear(newYear);
      setMonth(newMonth);
      setDay(newDay);
    }
  };

  // 🔥 1980年をプルダウンの中央に表示
  const yearRef = useRef(null);
  useEffect(() => {
    if (yearRef.current) {
      yearRef.current.value = defaultYear;
      setYear(defaultYear);
    }
  }, []);

  // 🔥 日のプルダウンを年・月の変更に合わせて更新
  useEffect(() => {
    if (dayRef.current && days.length > 0) {
      dayRef.current.value = "";
    }
  }, [year, month]);

  const validateDate = (y, m, d) => {
    if (!y || !m || !d) return false;
    if (y < startYear || y > currentYear) {
      setError(`年は${startYear}年〜現在の範囲内で選択してください`);
      return false;
    }
    if (m < 1 || m > 12) {
      setError("月は01〜12の範囲で選択してください");
      return false;
    }
    const daysInMonth = getDaysInMonth(y, m).length;
    if (d < 1 || d > daysInMonth) {
      setError(`日付は01〜${daysInMonth}の範囲で選択してください`);
      return false;
    }
    const inputDate = new Date(y, m - 1, d);
    const today = new Date();
    if (inputDate > today) {
      setError("未来の日付は選択できません");
      return false;
    }
    setError("");
    return true;
  };

  return (
    <div className="w-full">
      <div className="flex gap-4 mt-2">
        <select
          ref={yearRef}
          value={year}
          onChange={(e) => handleDropdownChange("year", e.target.value)}
          className="border p-2 rounded-md"
        >
          <option value="">年</option>
          {years.map((y) => (
            <option key={y} value={y}>
              {y}年
            </option>
          ))}
        </select>

        <select
          value={month}
          onChange={(e) => handleDropdownChange("month", e.target.value)}
          className="border p-2 rounded-md"
        >
          <option value="">月</option>
          {months.map((m) => (
            <option key={m} value={m}>
              {m}月
            </option>
          ))}
        </select>

        <select
          ref={dayRef}
          value={day}
          onChange={(e) => handleDropdownChange("day", e.target.value)}
          className="border p-2 rounded-md"
        >
          <option value="">日</option>
          {days.map((d) => (
            <option key={d} value={d}>
              {d}日
            </option>
          ))}
        </select>
      </div>

      {birthdate && <p className="mt-2 text-gray-700">選択された日付: {birthdate}</p>}
      {error && <p className="text-red-500 text-sm mt-1">{error}</p>}
    </div>
  );
};

export default BirthdateInput;
