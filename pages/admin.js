import React, {
  useEffect,
  useMemo,
  useRef,
  useState,
  useCallback,
} from "react";
import { db } from "../firebaseConfig";
import {
  collection,
  doc,
  getDocs,
  addDoc,
  query,
  where,
  runTransaction,
  serverTimestamp,
  onSnapshot,
  updateDoc,
  writeBatch,
  deleteDoc,
  orderBy,
  Timestamp,
} from "firebase/firestore";
import Papa from "papaparse";
import ManualReservationForm from "../components/ManualReservationForm";
import { nowJST, isoDateKey, jstDayRange } from "../utils/timeJST.js";

// ──────────────────────────────────────────
// ログ記録
const addLog = async (action, details, device = "") => {
  await addDoc(collection(db, "logs"), {
    action,
    details,
    user: "admin",
    device,
    timestamp: serverTimestamp(),
  });
  console.log("✅ ログ記録:", action, details);
};

// 並び順（ステータス / 種別）
const STATUS_ORDER = {
  予約済: 0,
  未受付: 1,
  受付済: 2,
  外出中: 3,
  呼び出し中: 4,
  "診療中/処置中": 5,
  診察終了: 6,
  会計済: 7,
  キャンセル済: 8,
};

const TYPE_ORDER = { 初診: 1, 再診: 2, 不明: 3 };

const STATUS_LIST = [
  "予約済",
  "未受付",
  "受付済",
  "外出中",
  "呼び出し中",
  "診療中/処置中",
  "診察終了",
  "会計済",
  "キャンセル済",
];

const toPositiveIntOr = (v, fallback) => {
  const n = typeof v === "string" ? Number(v.trim()) : Number(v);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

// ★ boolean厳格化（"false" みたいなゴミでも誤判定しない）
const readBool = (v, fallback) => {
  if (v === true) return true;
  if (v === false) return false;
  return fallback;
};


// ★ JST日付キー（YYYYMMDD）
const pad2 = (n) => String(n).padStart(2, "0");

// ※あなたの貼り付けはテンプレリテラルのバッククォートが脱落してたので復元
const toDateKeyJST = (d) =>
  `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;

// ★ 当日レンジ（0:00〜24:00）
const getDayRange = (now) => {
  const s = new Date(now);
  s.setHours(0, 0, 0, 0);

  const e = new Date(now);
  e.setHours(24, 0, 0, 0);

  return { start: s, end: e };
};

export default function AdminPage() {
  // ─── 認証 ───
  const [password, setPassword] = useState("");
  const [authorized, setAuthorized] = useState(false);
  const correct = "1112";

  // ─── settings ───
  const [reservationHours, setReservationHours] = useState({});
  const [isReservationOpen, setIsReservationOpen] = useState(true);

  // ★ 1日上限（午前/午後は廃止）
  const [maxReservationsDay, setMaxReservationsDay] = useState(100);

  const [autoPromoteTop20, setAutoPromoteTop20] = useState(false);

  // ★ 予約開始タイマー ON/OFF（JST 8:30 / 14:30）
  const [timerOpen830, setTimerOpen830] = useState(false);
  const [timerOpen1430, setTimerOpen1430] = useState(false);

  // 端末名
  const [deviceName, setDeviceName] = useState("");
  const [deviceNameInput, setDeviceNameInput] = useState("");

  // 強制オープン
  const [forceOpenUntil, setForceOpenUntil] = useState(null); // Date | null
  const [forceOpenActive, setForceOpenActive] = useState(false);

  // ─── reservations/logs ───
  const [reservationsRaw, setReservationsRaw] = useState([]);
  const [logs, setLogs] = useState([]);
  const [selectedReservations, setSelectedReservations] = useState([]);
  const [showCanceled, setShowCanceled] = useState(true);

  // ─── sort ───
  const [sortConfig, setSortConfig] = useState({
    key: "receptionNumber",
    direction: "asc",
  });

  // ─── UI ───
  const [isMinimized, setIsMinimized] = useState(false);

  // ──────────────────────────────────────────
  // settings 購読（★1本に統合 / 1日上限に統一）
  useEffect(() => {
    const settingsRef = doc(db, "settings", "clinic");

    const unsub = onSnapshot(settingsRef, (snap) => {
      if (!snap.exists()) return;

      const data = snap.data() || {};
      setReservationHours(data.reservationHours || {});
      setIsReservationOpen(readBool(data.isReservationOpen, true));

      setMaxReservationsDay(toPositiveIntOr(data.maxReservationsDay, 100));

      setAutoPromoteTop20(readBool(data.autoPromoteTop20, false));
      setTimerOpen830(readBool(data.timerOpen830, false));
      setTimerOpen1430(readBool(data.timerOpen1430, false));

      const until = data.forceOpenUntil?.toDate?.() ?? null;
      setForceOpenUntil(until);
      setForceOpenActive(until ? nowJST() < until : false);
    });

    return () => unsub();
  }, []);

  // ──────────────────────────────────────────
  // 30秒ごとに forceOpenActive 更新（半日レンジは廃止）
  useEffect(() => {
    const tick = async () => {
      const now = nowJST();

      if (forceOpenUntil) {
        const active = now < forceOpenUntil;
        setForceOpenActive(active);

        if (!active) {
          // 期限切れ掃除（任意）
          try {
            await updateDoc(doc(db, "settings", "clinic"), {
              forceOpenUntil: null,
            });
          } catch (_) {}
        }
      } else {
        setForceOpenActive(false);
      }
    };

    tick();
    const id = setInterval(tick, 30 * 1000);
    return () => clearInterval(id);
  }, [forceOpenUntil]);

  // ──────────────────────────────────────────
  // reservations 購読（★1本。ここでは「素のデータ」だけ持つ）
  useEffect(() => {
    const qRef = collection(db, "reservations");

    const unsub = onSnapshot(
      qRef,
      (snapshot) => {
        const data = snapshot.docs.map((docSnap) => {
          const d = docSnap.data() || {};
          return {
            id: docSnap.id,
            ...d,
            status: (d.status || "予約済").trim(),
            createdAt: d.createdAt?.toDate?.() ?? nowJST(),
            acceptedAt: d.acceptedAt?.toDate?.() ?? null,
            canceledAt: d.canceledAt?.toDate?.() ?? null,
            comment: d.comment || "",
            dateKey: d.dateKey || null,
            vip: d.vip === true,
          };
        });

        setReservationsRaw(data);
      },
      (err) => console.error("🚨 予約データ購読エラー:", err)
    );

    return () => unsub();
  }, []);

  // ──────────────────────────────────────────
  // 並び替え（useMemoで一発。setReservationsで二重にソートしない）
  const reservations = useMemo(() => {
    const data = [...reservationsRaw];
    const { key, direction } = sortConfig;
    if (!key) return data;

    data.sort((a, b) => {
      const dir = direction === "asc" ? 1 : -1;

      if (key === "acceptedAt") {
        const ta = a.acceptedAt ? a.acceptedAt.getTime() : 0;
        const tb = b.acceptedAt ? b.acceptedAt.getTime() : 0;
        return (ta - tb) * dir;
      }

      if (key === "createdAt") {
        const ta = a.createdAt ? a.createdAt.getTime() : 0;
        const tb = b.createdAt ? b.createdAt.getTime() : 0;
        return (ta - tb) * dir;
      }

      if (key === "canceledAt") {
        const ta = a.canceledAt ? a.canceledAt.getTime() : 0;
        const tb = b.canceledAt ? b.canceledAt.getTime() : 0;
        return (ta - tb) * dir;
      }

      if (key === "receptionNumber") {
        const av = Number(a.receptionNumber) || 0;
        const bv = Number(b.receptionNumber) || 0;
        return (av - bv) * dir;
      }

      if (key === "status") {
        const ai = STATUS_ORDER[a.status] ?? 0;
        const bi = STATUS_ORDER[b.status] ?? 0;
        return (ai - bi) * dir;
      }

      if (key === "type") {
        const ai = TYPE_ORDER[a.type] ?? 3;
        const bi = TYPE_ORDER[b.type] ?? 3;
        return (ai - bi) * dir;
      }

      const va = String(a[key] || "");
      const vb = String(b[key] || "");
      return va.localeCompare(vb, "ja-JP") * dir;
    });

    return data;
  }, [reservationsRaw, sortConfig]);

  // ──────────────────────────────────────────
  // 集計（statusCounts / total / 本日）
  const { statusCounts, totalReservations, todayCount, todayLimit } = useMemo(() => {
    const counts = {
      予約済: 0,
      未受付: 0,
      受付済: 0,
      外出中: 0,
      呼び出し中: 0,
      "診療中/処置中": 0,
      診察終了: 0,
      会計済: 0,
      キャンセル済: 0,
    };

    for (const r of reservationsRaw) {
      const s = (r.status || "予約済").trim();
      if (counts[s] !== undefined) counts[s] += 1;
    }

    const total = reservationsRaw.filter(
      (r) => (r.status || "").trim() !== "キャンセル済"
    ).length;

    const now = nowJST();
    const todayKey = toDateKeyJST(now);
    const { start, end } = getDayRange(now);

    const isEffective = (r) => (r.status || "未受付").trim() !== "キャンセル済";
    const inRange = (dt, s, e) => dt && s && e && dt >= s && dt < e;

    const tCount = reservationsRaw.filter((r) => {
      if (!isEffective(r)) return false;
      if (r.dateKey === todayKey) return true;
      if (r.dateKeyISO === todayKey) return true;
      return inRange(r.createdAt, start, end);
    }).length;

    return {
      statusCounts: counts,
      totalReservations: total,
      todayCount: tCount,
      todayLimit: maxReservationsDay,
    };
  }, [reservationsRaw, maxReservationsDay]);

  // ──────────────────────────────────────────
  // latestRef（タイマー等で参照）
  const latestRef = useRef({
    isReservationOpen,
    maxReservationsDay,
    forceOpenActive,
  });

  useEffect(() => {
    latestRef.current = {
      isReservationOpen,
      maxReservationsDay,
      forceOpenActive,
    };
  }, [isReservationOpen, maxReservationsDay, forceOpenActive]);

  // ──────────────────────────────────────────
  // ✅ 修正版：上限到達で自動停止（ログ重複をトランザクションで根絶）
  const autoStopInFlightRef = useRef(false);
  const deviceIdRef = useRef("");
  useEffect(() => {
    let id = localStorage.getItem("deviceId");
    if (!id) {
      id = "端末-" + Math.random().toString(36).slice(2, 7).toUpperCase();
      localStorage.setItem("deviceId", id);
    }
    deviceIdRef.current = id;
    setDeviceName(id);
    setDeviceNameInput(id);
  }, []);

  const autoStopReservationOnce = useCallback(async ({ count, limit }) => {
    const settingsRef = doc(db, "settings", "clinic");
    const logsCol = collection(db, "logs");
    const now = nowJST();

    return await runTransaction(db, async (tx) => {
      const snap = await tx.get(settingsRef);
      if (!snap.exists()) return { didStop: false, reason: "no_settings" };

      const s = snap.data() || {};
      const until = s.forceOpenUntil?.toDate?.() ?? null;
      const forceActive = until ? now < until : false;
      if (forceActive) return { didStop: false, reason: "force_open" };

      const isOpen = readBool(s.isReservationOpen, true);
      if (!isOpen) return { didStop: false, reason: "already_closed" };

      tx.update(settingsRef, { isReservationOpen: false, forceOpenUntil: null });

      const logRef = doc(logsCol);
      tx.set(logRef, {
        action: "自動：停止",
        details: `上限到達(${count}/${limit})により 本日 の受付を停止`,
        user: "system",
        device: deviceIdRef.current,
        timestamp: serverTimestamp(),
      });

      return { didStop: true };
    });
  }, []);

  useEffect(() => {
    if (forceOpenActive) return;
    if (!isReservationOpen) return;

    const limit = maxReservationsDay;
    const count = todayCount;
    if (count < limit) return;

    if (autoStopInFlightRef.current) return;
    autoStopInFlightRef.current = true;

    const run = async () => {
      try {
        await autoStopReservationOnce({ count, limit });
      } catch (e) {
        console.error("自動停止エラー:", e);
      } finally {
        setTimeout(() => {
          autoStopInFlightRef.current = false;
        }, 1500);
      }
    };

    run();
  }, [
    todayCount,
    maxReservationsDay,
    isReservationOpen,
    forceOpenActive,
    autoStopReservationOnce,
  ]);

  // ──────────────────────────────────────────
  // 自動昇格（★1本、OFFなら絶対に動かない、20件まで、二重実行防止）
  const promotingRef = useRef(false);

  useEffect(() => {
    if (!autoPromoteTop20) return;
    if (!reservationsRaw?.length) return;
    if (promotingRef.current) return;

    const already = reservationsRaw.filter(
      (r) => (r.status || "").trim() === "未受付"
    ).length;
    if (already >= 20) return;

    promotingRef.current = true;

    const promote = async () => {
      try {
        const need = 20 - already;

        const targets = [...reservationsRaw]
          .filter((r) => (r.status || "").trim() === "予約済")
          .sort(
            (a, b) =>
              (Number(a.receptionNumber) || 0) - (Number(b.receptionNumber) || 0)
          )
          .slice(0, need);

        if (targets.length === 0) return;

        const batch = writeBatch(db);
        targets.forEach((r) =>
          batch.update(doc(db, "reservations", r.id), { status: "未受付" })
        );
        await batch.commit();

        await addLog("自動昇格実行", `予約済→未受付 ${targets.length}件`, deviceIdRef.current);
      } catch (e) {
        console.error("❌ 自動昇格エラー:", e);
      } finally {
        promotingRef.current = false;
      }
    };

    promote();
  }, [autoPromoteTop20, reservationsRaw]);


  // ──────────────────────────────────────────
  // ★追加：手動操作を「停止」「通常再開」「強制再開」に分離
  const stopReservation = async () => {
    const settingsRef = doc(db, "settings", "clinic");

    try {
      await updateDoc(settingsRef, { isReservationOpen: false, forceOpenUntil: null });
      await addLog("手動：停止", "手動ボタンで受付停止", deviceIdRef.current);
    } catch (e) {
      console.error("❌ stopReservation エラー:", e);
    }
  };

  const resumeReservationNormal = async () => {
    const settingsRef = doc(db, "settings", "clinic");

    try {
      await updateDoc(settingsRef, { isReservationOpen: true, forceOpenUntil: null });
      await addLog("手動：再開(通常)", "上限到達時は自動停止が効く通常再開", deviceIdRef.current);
    } catch (e) {
      console.error("❌ resumeReservationNormal エラー:", e);
    }
  };

  const resumeReservationForce = async () => {
    const settingsRef = doc(db, "settings", "clinic");

    try {
      const now = nowJST();
      const end = new Date(now);
      end.setHours(24, 0, 0, 0); // ★本日終了まで強制オープン

      await updateDoc(settingsRef, {
        isReservationOpen: true,
        forceOpenUntil: Timestamp.fromDate(end),
      });

      await addLog(
        "手動：再開(強制)",
        `本日終了まで上限無視。期限 ${end.toLocaleString("ja-JP", {
          hour12: false,
        })}`,
        deviceIdRef.current
      );
    } catch (e) {
      console.error("❌ resumeReservationForce エラー:", e);
    }
  };

  // ──────────────────────────────────────────
  // UIユーティリティ
  const getStatusColor = (status) => {
    switch (status) {
      case "予約済":
        return "bg-gray-100";
      case "未受付":
        return "bg-sky-100";
      case "受付済":
        return "bg-blue-300";
      case "診療中/処置中":
        return "bg-yellow-300";
      case "診察終了":
        return "bg-green-300";
      case "会計済":
        return "bg-purple-300";
      case "呼び出し中":
        return "bg-red-300";
      case "外出中":
        return "bg-orange-300";
      case "キャンセル済":
        return "bg-gray-300";
      default:
        return "";
    }
  };

  const getTypeColor = (type) => {
    switch (type) {
      case "初診":
        return "bg-blue-500";
      case "再診":
        return "bg-green-500";
      default:
        return "";
    }
  };

  const getStatusBadgeClasses = (status) => {
    switch (status) {
      case "予約済":
        return "bg-gray-100 text-gray-800";
      case "未受付":
        return "bg-sky-100 text-sky-800";
      case "受付済":
        return "bg-blue-100 text-blue-800";
      case "外出中":
        return "bg-orange-100 text-orange-800";
      case "呼び出し中":
        return "bg-red-100 text-red-800";
      case "診療中/処置中":
        return "bg-yellow-100 text-yellow-800";
      case "診察終了":
        return "bg-green-100 text-green-800";
      case "会計済":
        return "bg-purple-100 text-purple-800";
      case "キャンセル済":
        return "bg-gray-200 text-gray-800";
      default:
        return "bg-gray-50 text-gray-600";
    }
  };

  // ──────────────────────────────────────────
  // handlers
  const handlePasswordSubmit = (e) => {
    e.preventDefault();
    if (password === correct) setAuthorized(true);
    else {
      alert("パスワードが違います");
      setPassword("");
    }
  };

  const handleSort = (key) => {
    setSortConfig((prev) => {
      const direction =
        prev.key === key && prev.direction === "asc" ? "desc" : "asc";
      return { key, direction };
    });
  };

  const handleStatusChange = async (id, newStatus) => {
    const ref = doc(db, "reservations", id);

    try {
      if (newStatus === "キャンセル済") {
        await updateDoc(ref, { status: "キャンセル済", canceledAt: serverTimestamp() });
        // カウンターを減算（キャンセルは削除と違いドキュメントは残るため穴リストには追加しない）
        const r = reservationsRaw.find((rv) => rv.id === id);
        if (r) {
          const dk = r.dateKeyISO || r.dateKey;
          if (dk) {
            const cRef = doc(db, "counters", dk);
            await runTransaction(db, async (tx) => {
              const snap = await tx.get(cRef);
              const c = snap.exists() ? snap.data() || {} : {};
              const count = Number(c.count ?? 0);
              if (count > 0) tx.set(cRef, { count: count - 1 }, { merge: true });
            });
          }
        }
      } else if (newStatus === "受付済") {
        await updateDoc(ref, { status: newStatus, acceptedAt: serverTimestamp() });
      } else {
        await updateDoc(ref, { status: newStatus });
      }
    } catch (error) {
      console.error("❌ ステータスの更新に失敗:", error);
    }
  };

  const handleCommentChange = async (id, newComment) => {
    try {
      await updateDoc(doc(db, "reservations", id), { comment: newComment });
    } catch (error) {
      console.error("❌ コメント更新エラー:", error);
    }
  };

  const toggleAutoPromoteTop20 = async () => {
    const settingsRef = doc(db, "settings", "clinic");
    const next = !autoPromoteTop20;

    try {
      await updateDoc(settingsRef, { autoPromoteTop20: next });
      await addLog(
        "自動昇格フラグ変更",
        next ? "ON：先頭20件を未受付へ" : "OFF：自動昇格停止",
        deviceIdRef.current
      );
    } catch (e) {
      console.error("❌ toggleAutoPromoteTop20 エラー:", e);
      alert("自動昇格の設定変更に失敗しました。");
    }
  };

  // ★ タイマー設定ON/OFF
  const toggleTimerOpen830 = async () => {
    const settingsRef = doc(db, "settings", "clinic");
    const next = !timerOpen830;

    try {
      await updateDoc(settingsRef, { timerOpen830: next });
      setTimerOpen830(next);
      await addLog(
        "タイマー設定変更",
        next ? "ON：8:30に予約受付を自動開始" : "OFF：8:30自動開始を停止",
        deviceIdRef.current
      );
    } catch (e) {
      console.error("❌ toggleTimerOpen830 エラー:", e);
      alert("8:30タイマーの設定変更に失敗しました。");
    }
  };

  const toggleTimerOpen1430 = async () => {
    const settingsRef = doc(db, "settings", "clinic");
    const next = !timerOpen1430;

    try {
      await updateDoc(settingsRef, { timerOpen1430: next });
      setTimerOpen1430(next);
      await addLog(
        "タイマー設定変更",
        next ? "ON：14:30に予約受付を自動開始" : "OFF：14:30自動開始を停止",
        deviceIdRef.current
      );
    } catch (e) {
      console.error("❌ toggleTimerOpen1430 エラー:", e);
      alert("14:30タイマーの設定変更に失敗しました。");
    }
  };

  // ★ 上限保存（1日上限）
  const updateMaxReservations = async () => {
    const ref = doc(db, "settings", "clinic");

    try {
      await updateDoc(ref, {
        maxReservationsDay,
        maxReservationsPerDay: maxReservationsDay,
      });
      await addLog("予約上限変更", `1日上限=${maxReservationsDay}`, deviceIdRef.current);
    } catch (e) {
      console.error("❌ 上限保存失敗:", e);
      alert("上限の保存に失敗しました。Firestoreの権限/接続を確認してください。");
    }
  };

  const handleDeleteSelected = async () => {
    if (!window.confirm("選択した予約を削除しますか？")) return;

    const toDelete = reservationsRaw.filter((r) => selectedReservations.includes(r.id));

    const batch = writeBatch(db);
    selectedReservations.forEach((id) =>
      batch.delete(doc(db, "reservations", id))
    );
    await batch.commit();

    // 削除した番号を穴リストに追加（日付キーごとにグループ化）
    const byDateKey = {};
    for (const r of toDelete) {
      const dk = r.dateKeyISO || r.dateKey;
      if (!dk) continue;
      if (!byDateKey[dk]) byDateKey[dk] = [];
      byDateKey[dk].push(r);
    }

    for (const [dk, rList] of Object.entries(byDateKey)) {
      const cRef = doc(db, "counters", dk);
      try {
        await runTransaction(db, async (tx) => {
          const snap = await tx.get(cRef);
          const c = snap.exists() ? snap.data() || {} : {};

          const walkHoles = Array.isArray(c.walkHoles) ? [...c.walkHoles] : [];
          const onlineHoles = Array.isArray(c.onlineHoles) ? [...c.onlineHoles] : [];
          const vipHoles = Array.isArray(c.vipHoles) ? [...c.vipHoles] : [];
          let count = Number(c.count ?? 0);

          for (const r of rList) {
            const num = Number(r.receptionNumber);
            if (r.vip || num >= 1001) {
              vipHoles.push(num);
            } else if (num % 6 === 0) {
              walkHoles.push(num);
            } else {
              onlineHoles.push(num);
            }
            if (count > 0) count--;
          }

          tx.set(cRef, {
            count,
            walkHoles: walkHoles.sort((a, b) => a - b),
            onlineHoles: onlineHoles.sort((a, b) => a - b),
            vipHoles: vipHoles.sort((a, b) => a - b),
          }, { merge: true });
        });
      } catch (e) {
        console.error("カウンター更新エラー:", e);
      }
    }

    await addLog("予約削除", `削除された予約 ID: ${selectedReservations.join(", ")}`, deviceIdRef.current);
    setSelectedReservations([]);
  };

  const handleExport = () => {
    const csvData = reservations.map((r) => ({
      受付番号: r.receptionNumber,
      予約取得時刻: r.createdAt ? r.createdAt.toISOString() : "",
      初診_再診: r.type,
      診察券番号: r.cardNumber || "",
      名前: r.name,
      生年月日: r.birthdate || "",
      電話番号: r.phone || "",
      受付状態: r.status,
    }));

    let csv = Papa.unparse(csvData);
    csv = "\uFEFF" + csv;

    const now = new Date();
    const jstNow = new Intl.DateTimeFormat("ja-JP", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
      timeZone: "Asia/Tokyo",
    })
      .format(now)
      .replace(/\//g, "-")
      .replace(/:/g, "-")
      .replace(/ /g, "_");

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

  const handleImport = (event) => {
    const file = event.target.files[0];
    if (!file) return;

    Papa.parse(file, {
      complete: async (result) => {
        const importedData = result.data;

        for (let row of importedData) {
          if (!row.受付番号 || !row.名前) continue;

          const createdAt = row.予約取得時刻 ? new Date(row.予約取得時刻) : nowJST();
          const dateKey = toDateKeyJST(createdAt);

          await addDoc(collection(db, "reservations"), {
            receptionNumber: parseInt(row.受付番号, 10),
            createdAt,
            type: row.初診_再診 || "不明",
            cardNumber: row.診察券番号 || "",
            name: row.名前,
            birthdate: row.生年月日 || "",
            phone: row.電話番号 || "",
            status: row.受付状態 || "予約済",
            dateKey,
            vip: Number(row.受付番号) >= 1001,
          });
        }

        alert("インポートが完了しました！");
      },
      header: true,
      skipEmptyLines: true,
    });
  };

  const handleDeleteAll = async () => {
    if (
      !window.confirm(
        "⚠️ 本当にすべての予約データを削除しますか？ この操作は元に戻せません！"
      )
    )
      return;

    try {
      const qs = await getDocs(collection(db, "reservations"));
      if (qs.empty) {
        alert("削除できる予約データがありません。");
        return;
      }

      await Promise.all(qs.docs.map((d) => deleteDoc(d.ref)));
      alert("すべての予約データを削除しました。");
    } catch (error) {
      console.error("❌ 全データ削除エラー:", error);
      alert("エラーが発生しました。削除に失敗しました。");
    }
  };

  // ─── ログ購読 ───
  useEffect(() => {
    const logsQuery = query(collection(db, "logs"), orderBy("timestamp", "desc"));

    const unsub = onSnapshot(
      logsQuery,
      (snapshot) => {
        const data = snapshot.docs.map((docSnap) => {
          const d = docSnap.data() || {};
          return {
            id: docSnap.id,
            action: d.action,
            details: d.details,
            timestamp: d.timestamp ? d.timestamp.toDate() : null,
            user: d.user,
            device: d.device || "",
          };
        });
        setLogs(data);
      },
      (err) => console.error("🚨 ログ取得エラー:", err)
    );

    return () => unsub();
  }, []);

  const handleDeleteLog = async (id) => {
    if (!window.confirm("本当にこのログを削除しますか？")) return;

    try {
      await deleteDoc(doc(db, "logs", id));
      setLogs((prev) => prev.filter((log) => log.id !== id));
      alert("ログを削除しました。");
    } catch (error) {
      console.error("❌ ログ削除エラー:", error);
      alert("エラーが発生しました。削除できませんでした。");
    }
  };

  const handleDeleteAllLogs = async () => {
    if (
      !window.confirm(
        "⚠️ 本当にすべてのログを削除しますか？ この操作は元に戻せません！"
      )
    )
      return;

    try {
      const qs = await getDocs(collection(db, "logs"));
      if (qs.empty) {
        alert("削除できるログがありません。");
        return;
      }

      await Promise.all(qs.docs.map((d) => deleteDoc(d.ref)));
      setLogs([]);
      alert("すべてのログを削除しました。");
    } catch (error) {
      console.error("❌ 全ログ削除エラー:", error);
      alert("エラーが発生しました。削除できませんでした。");
    }
  };

  // ──────────────────────────────────────────
  // 新規予約（直来/VIP）
  const [newReservation, setNewReservation] = useState({
    name: "",
    type: "初診",
    cardNumber: "",
    birthdate: "",
    phone: "",
  });

  const validateNewReservation = () => {
    const { name, birthdate, phone } = newReservation;

    if (!name.trim()) {
      alert("名前を入力してください。");
      return false;
    }

    if (birthdate && !/^\d{8}$/.test(birthdate)) {
      alert("生年月日は8桁の半角数字（YYYYMMDD）で入力してください。");
      return false;
    }

    if (phone && !/^\d{10,11}$/.test(phone)) {
      alert("電話番号は10〜11桁の半角数字で入力してください。");
      return false;
    }

    return true;
  };

  const [isAdding, setIsAdding] = useState(false);
  const [isAddingVIP, setIsAddingVIP] = useState(false);

  // ──────────────────────────────────────────
  // 採番＋作成をDBクエリ＋トランザクションで完全重複防止
  const createReservationAtomic = async ({
    vip,
    payload,
    allowEvenIfClosed = false,
    allowEvenIfOverLimit = false,
  }) => {
    const now = nowJST();
    const dateKey    = toDateKeyJST(now);
    const dateKeyISO = isoDateKey(now);
    const { start, end } = jstDayRange(now);

    // ① トランザクション外で今日の予約を全件取得（カウンターズレに備えた実態確認）
    const todaySnap = await getDocs(
      query(
        collection(db, "reservations"),
        where("createdAt", ">=", Timestamp.fromDate(start)),
        where("createdAt", "<", Timestamp.fromDate(end))
      )
    );
    const usedWalk = new Set();
    const usedVip  = new Set();
    todaySnap.docs.forEach((d) => {
      const num = Number(d.data().receptionNumber ?? 0);
      if (num >= 1001) usedVip.add(num);
      else if (num % 6 === 0 && num > 0) usedWalk.add(num);
    });
    const dbMaxWalk = usedWalk.size > 0 ? Math.max(...usedWalk) : 0;
    const dbMaxVip  = usedVip.size  > 0 ? Math.max(...usedVip)  : 0;

    const settingsRef    = doc(db, "settings", "clinic");
    const counterRef     = doc(db, "counters", dateKeyISO);
    const reservationsCol = collection(db, "reservations");

    // ② トランザクションで採番・書き込み（Firestoreが競合を自動リトライ）
    const result = await runTransaction(db, async (tx) => {
      const [settingsSnap, counterSnap] = await Promise.all([
        tx.get(settingsRef),
        tx.get(counterRef),
      ]);

      const settings = settingsSnap.exists() ? settingsSnap.data() || {} : {};
      const isOpen   = readBool(settings.isReservationOpen, true);
      const limit    = toPositiveIntOr(settings.maxReservationsDay, maxReservationsDay);
      const until    = settings.forceOpenUntil?.toDate?.() ?? null;
      const forceActive = until ? now < until : false;

      const counter = counterSnap.exists() ? counterSnap.data() || {} : {};
      const count   = Number(counter.count ?? 0);

      if (!forceActive && !isOpen && !allowEvenIfClosed) {
        throw new Error("受付停止中です（通常再開するか、強制再開してください）");
      }
      if (!forceActive && count >= limit && !allowEvenIfOverLimit) {
        throw new Error(`上限に達しています（${count}/${limit}）`);
      }

      let nextNo;

      if (vip) {
        // 穴リストのうちDBに存在しないものだけ再利用
        const holes = (Array.isArray(counter.vipHoles) ? counter.vipHoles : [])
          .filter((n) => !usedVip.has(n))
          .sort((a, b) => a - b);

        if (holes.length > 0) {
          nextNo = holes[0];
          tx.set(counterRef, { count: count + 1, vipHoles: holes.slice(1) }, { merge: true });
        } else {
          // カウンターとDBの両方を踏まえた最大値 + 1 からスタート
          const next = Math.max(Number(counter.nextVip ?? 1001), dbMaxVip + 1);
          if (next > 2000) throw new Error("本日のVIP予約番号枠が満杯です");
          nextNo = next;
          tx.set(counterRef, { count: count + 1, nextVip: next + 1 }, { merge: true });
        }
      } else {
        const holes = (Array.isArray(counter.walkHoles) ? counter.walkHoles : [])
          .filter((n) => !usedWalk.has(n))
          .sort((a, b) => a - b);

        if (holes.length > 0) {
          nextNo = holes[0];
          tx.set(counterRef, { count: count + 1, walkHoles: holes.slice(1) }, { merge: true });
        } else {
          let next = Math.max(Number(counter.nextWalk ?? 6), dbMaxWalk + 6);
          if (next % 6 !== 0) next = Math.ceil(next / 6) * 6;
          if (next > 6000) throw new Error("本日の直来予約番号枠が満杯です");
          nextNo = next;
          tx.set(counterRef, { count: count + 1, nextWalk: next + 6 }, { merge: true });
        }
      }

      const newRef = doc(reservationsCol);
      const overLimitAtCreate = !forceActive && count >= limit;
      const closedAtCreate    = !forceActive && !isOpen;

      tx.set(newRef, {
        receptionNumber: nextNo,
        createdAt: serverTimestamp(),
        status: "予約済",
        ...payload,
        dateKey,
        dateKeyISO,
        vip: !!vip,
        createdBy: "admin",
        bypass: {
          allowEvenIfClosed: !!allowEvenIfClosed,
          allowEvenIfOverLimit: !!allowEvenIfOverLimit,
          overLimitAtCreate,
          closedAtCreate,
        },
      });

      return { receptionNumber: nextNo, overLimitAtCreate, closedAtCreate, limit, count };
    });

    return { ...result, dateKey };
  };

  const handleAddNewReservation = async (newReservationData) => {
    if (isAdding) return;
    if (!validateNewReservation()) return;

    setIsAdding(true);

    try {
      // ✅ 直来：停止中でもOK / 上限超過でもOK
      const { receptionNumber, overLimitAtCreate, closedAtCreate, limit, count } =
        await createReservationAtomic({
          vip: false,
          payload: newReservationData,
          allowEvenIfClosed: true,
          allowEvenIfOverLimit: true,
        });

      alert(`✅ 予約を追加しました！（受付番号：${receptionNumber}）`);

      setNewReservation({
        name: "",
        type: "初診",
        cardNumber: "",
        birthdate: "",
        phone: "",
      });

      const flags = [
        closedAtCreate ? "停止中でも追加" : null,
        overLimitAtCreate ? `上限超過でも追加(${count}/${limit})` : null,
      ].filter(Boolean);

      await addLog(
        "手動追加：直来",
        `受付番号=${receptionNumber}${flags.length ? " / " + flags.join(" / ") : ""}`,
        deviceIdRef.current
      );
    } catch (e) {
      console.error(e);
      alert("予約の追加に失敗しました: " + (e?.message || String(e)));
    } finally {
      setIsAdding(false);
    }
  };

  const handleAddVIPReservation = async (newReservationData) => {
    if (isAddingVIP) return;
    if (!validateNewReservation()) return;

    setIsAddingVIP(true);

    try {
      // ✅ VIP：停止中でもOK / 上限超過でもOK（完全に上限無関係）
      const { receptionNumber, overLimitAtCreate, closedAtCreate, limit, count } =
        await createReservationAtomic({
          vip: true,
          payload: newReservationData,
          allowEvenIfClosed: true,
          allowEvenIfOverLimit: true,
        });

      alert(`✅ VIP予約を追加しました！（受付番号：${receptionNumber}）`);

      setNewReservation({
        name: "",
        type: "初診",
        cardNumber: "",
        birthdate: "",
        phone: "",
      });

      const flags = [
        closedAtCreate ? "停止中でも追加" : null,
        overLimitAtCreate ? `上限超過でも追加(${count}/${limit})` : null,
      ].filter(Boolean);

      await addLog(
        "手動追加：VIP",
        `受付番号=${receptionNumber}${flags.length ? " / " + flags.join(" / ") : ""}`,
        deviceIdRef.current
      );
    } catch (e) {
      console.error(e);
      alert("VIP予約の追加に失敗しました: " + (e?.message || String(e)));
    } finally {
      setIsAddingVIP(false);
    }
  };

  // ──────────────────────────────────────────
  // 認証UI
  if (!authorized) {
    return (
      <div className="flex items-center justify-center h-screen bg-gray-100">
        <form onSubmit={handlePasswordSubmit} className="bg-white p-8 shadow rounded space-y-4">
          <h1 className="text-2xl font-bold">管理画面パスワード</h1>

          <input
            type="password"
            placeholder="パスワードを入力"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full border p-2 rounded"
            required
          />

          <button
            type="submit"
            className="w-full bg-blue-500 text-white py-2 rounded hover:bg-blue-600"
          >
            開く
          </button>
        </form>
      </div>
    );
  }

  // ──────────────────────────────────────────
  // ──── レンダリング ────
  return (
    <>
      <div className="w-full flex items-center justify-center py-3">
        <img
          src="/chin.png"
          alt="チン王"
          className="h-14 w-auto sm:h-16 md:h-20 object-contain"
        />
      </div>

      <div className="container mx-auto p-6">
        {/* 予約一覧テーブル */}
        <table className="w-full border-collapse border border-gray-300 mt-4">
          <thead>
            <tr className="bg-gray-100">
              <th
                className="border p-2 cursor-pointer w-12"
                onClick={() => handleSort("receptionNumber")}
              >
                受付番号 ▲▼
              </th>

              <th
                className="border p-2 cursor-pointer w-16"
                onClick={() => handleSort("createdAt")}
              >
                予約取得時刻 ▲▼
              </th>

              {showCanceled && (
                <th
                  className="border p-2 cursor-pointer w-16"
                  onClick={() => handleSort("canceledAt")}
                >
                  キャンセル時刻 ▲▼
                </th>
              )}

              <th
                className="border p-2 cursor-pointer w-12"
                onClick={() => handleSort("status")}
              >
                受付状態 ▲▼
              </th>

              <th
                className="border p-2 cursor-pointer w-16"
                onClick={() => handleSort("acceptedAt")}
              >
                受付完了時刻 ▲▼
              </th>

              <th
                className="border p-2 cursor-pointer w-14"
                onClick={() => handleSort("type")}
              >
                初診/再診 ▲▼
              </th>

              <th
                className="border p-2 cursor-pointer w-16"
                onClick={() => handleSort("cardNumber")}
              >
                診察券番号 ▲▼
              </th>
              <th
                className="border p-2 cursor-pointer w-44"
                onClick={() => handleSort("name")}
              >
                名前 ▲▼
              </th>
              <th
                className="border p-2 cursor-pointer w-16"
                onClick={() => handleSort("birthdate")}
              >
                生年月日 ▲▼
              </th>
              <th
                className="border p-2 cursor-pointer w-60"
                onClick={() => handleSort("comment")}
              >
                コメント ▲▼
              </th>
              <th
                className="border p-2 cursor-pointer w-16"
                onClick={() => handleSort("phone")}
              >
                電話番号 ▲▼
              </th>
              <th className="border p-2 w-8">予約削除</th>
            </tr>
          </thead>

          <tbody>
            {reservations.map((r) => {
              const statusBg = getStatusColor(r.status);
              const typeBg = getTypeColor(r.type);

              return (
                <tr key={r.id} className={`${statusBg}`}>
                  <td className="border p-2 text-center">{r.receptionNumber}</td>

                  <td className="border p-2 text-center">
                    {r.createdAt
                      ? new Intl.DateTimeFormat("ja-JP", {
                          hour: "2-digit",
                          minute: "2-digit",
                          second: "2-digit",
                          hour12: false,
                        }).format(r.createdAt)
                      : ""}
                  </td>

                  {showCanceled && (
                    <td className="border p-2 text-center">
                      {r.canceledAt
                        ? new Intl.DateTimeFormat("ja-JP", {
                            hour: "2-digit",
                            minute: "2-digit",
                            second: "2-digit",
                            hour12: false,
                          }).format(r.canceledAt)
                        : ""}
                    </td>
                  )}

                  <td className="border p-2 text-center">
                    <select
                      value={r.status}
                      onChange={(e) => handleStatusChange(r.id, e.target.value)}
                      className="border rounded p-1"
                    >
                      {STATUS_LIST.map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </select>
                  </td>

                  <td className="border p-2 text-center">
                    {r.acceptedAt
                      ? new Intl.DateTimeFormat("ja-JP", {
                          hour: "2-digit",
                          minute: "2-digit",
                          second: "2-digit",
                          hour12: false,
                        }).format(r.acceptedAt)
                      : ""}
                  </td>

                  <td className={`border p-2 text-center ${typeBg}`}>{r.type}</td>

                  <td className="border p-2 text-center">{r.cardNumber || "なし"}</td>
                  <td className="border p-2">{r.name}</td>
                  <td className="border p-2 text-center">{r.birthdate || "なし"}</td>

                  <td className="border p-2">
                    <input
                      type="text"
                      value={r.comment}
                      onChange={(e) => {
                        const v = e.target.value;
                        setReservationsRaw((prev) =>
                          prev.map((x) => (x.id === r.id ? { ...x, comment: v } : x))
                        );
                      }}
                      onBlur={(e) => handleCommentChange(r.id, e.target.value)}
                      className="w-full border rounded p-1"
                    />
                  </td>

                  <td className="border p-2 text-center">{r.phone || "なし"}</td>

                  <td className="border p-2 text-center">
                    <input
                      type="checkbox"
                      checked={selectedReservations.includes(r.id)}
                      onChange={(e) => {
                        setSelectedReservations((prev) =>
                          e.target.checked
                            ? [...prev, r.id]
                            : prev.filter((id) => id !== r.id)
                        );
                      }}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {/* 任意番号予約フォーム */}
        <div className="mb-6 mx-auto p-4 border rounded bg-yellow-50 w-full max-w-8xl">
          <h2 className="text-xl font-bold mb-2">任意番号予約フォーム</h2>
          <ManualReservationForm />
        </div>

        {/* 新規予約（直来/VIP） */}
        <div className="mb-6 p-4 border rounded bg-gray-50">
          <h2 className="text-xl font-bold mb-2">新規予約を追加(直来、VIP用)</h2>

          <div className="grid grid-cols-1 md:grid-cols-6 gap-2 items-end">
            <div className="col-span-2">
              <label className="block text-sm">名前</label>
              <input
                type="text"
                value={newReservation.name}
                onChange={(e) =>
                  setNewReservation({ ...newReservation, name: e.target.value })
                }
                placeholder="例: チンオウ ユリア"
                className="w-full border p-2 rounded"
              />
            </div>

            <div>
              <label className="block text-sm">初診/再診</label>
              <select
                value={newReservation.type}
                onChange={(e) =>
                  setNewReservation({ ...newReservation, type: e.target.value })
                }
                className="w-full border p-2 rounded"
              >
                <option value="初診">初診</option>
                <option value="再診">再診</option>
              </select>
            </div>

            <div>
              <label className="block text-sm">診察券番号</label>
              <input
                type="tel"
                value={newReservation.cardNumber}
                onChange={(e) =>
                  setNewReservation((prev) => ({ ...prev, cardNumber: e.target.value }))
                }
                placeholder="例: 123456"
                className="w-full border p-2 rounded"
              />
            </div>

            <div>
              <label className="block text-sm">生年月日</label>
              <input
                type="text"
                value={newReservation.birthdate}
                onChange={(e) =>
                  setNewReservation((prev) => ({ ...prev, birthdate: e.target.value }))
                }
                placeholder="YYYYMMDD"
                className="w-full border p-2 rounded"
              />
            </div>

            <div>
              <label className="block text-sm">電話番号</label>
              <input
                type="tel"
                value={newReservation.phone}
                onChange={(e) =>
                  setNewReservation({ ...newReservation, phone: e.target.value })
                }
                placeholder="例: 08012345678"
                className="w-full border p-2 rounded"
              />
            </div>

            <div className="md:col-span-6 flex flex-col sm:flex-row items-stretch sm:items-center sm:space-x-2 space-y-2 sm:space-y-0">
              <button
                onClick={() => handleAddNewReservation(newReservation)}
                disabled={isAdding}
                className={`w-full sm:flex-1 min-h-[44px] px-3 py-2 text-sm sm:text-base leading-none tracking-tight rounded-lg text-white ${
                  isAdding
                    ? "bg-green-300 cursor-not-allowed"
                    : "bg-green-500 hover:bg-green-600 active:bg-green-700"
                }`}
              >
                {isAdding ? "送信中…" : "予約を追加（直来・6の倍数）"}
              </button>

              <button
                onClick={() => handleAddVIPReservation(newReservation)}
                disabled={isAddingVIP}
                className={`w-full sm:flex-1 min-h-[44px] px-3 py-2 text-sm sm:text-base leading-none tracking-tight rounded-lg text-white ${
                  isAddingVIP
                    ? "bg-yellow-200 cursor-not-allowed"
                    : "bg-yellow-400 hover:bg-yellow-500 active:bg-yellow-600"
                }`}
              >
                {isAddingVIP ? "送信中…" : "VIP予約（1001〜）"}
              </button>
            </div>
          </div>
        </div>

        {/* 自動昇格 ON/OFF */}
        <div className="mb-6 p-4 border rounded bg-indigo-50">
          <h2 className="text-lg font-bold mb-2">「予約済」→「未受付」自動昇格設定</h2>
          <p className="text-sm text-gray-700 mb-3">
            数字が小さい「予約済」を上から20件まで、自動で「未受付」に変換する機能のON/OFF。
          </p>

          <button
            onClick={toggleAutoPromoteTop20}
            className={`px-4 py-2 rounded-lg font-semibold shadow ${
              autoPromoteTop20
                ? "bg-indigo-500 text-white hover:bg-indigo-600"
                : "bg-gray-200 text-gray-800 hover:bg-gray-300"
            }`}
          >
            {autoPromoteTop20
              ? "✅ 自動昇格：ON（20件を自動で『未受付』へ）"
              : "⛔ 自動昇格：OFF（自動で変更しない）"}
          </button>
        </div>

        {/* 予約開始タイマー ON/OFF */}
        <div className="mb-6 p-4 border rounded bg-emerald-50">
          <h2 className="text-lg font-bold mb-2">予約受付：自動開始タイマー（JST）</h2>
          <p className="text-sm text-gray-700 mb-3">
            サーバー側で自動実行されます。ブラウザを開いていなくても機能します。
          </p>

          <div className="flex flex-col sm:flex-row gap-2">
            <button
              onClick={toggleTimerOpen830}
              className={`px-4 py-2 rounded-lg font-semibold shadow ${
                timerOpen830
                  ? "bg-emerald-600 text-white hover:bg-emerald-700"
                  : "bg-gray-200 text-gray-800 hover:bg-gray-300"
              }`}
            >
              {timerOpen830 ? "✅ 8:30 タイマー：ON" : "⛔ 8:30 タイマー：OFF"}
            </button>

            <button
              onClick={toggleTimerOpen1430}
              className={`px-4 py-2 rounded-lg font-semibold shadow ${
                timerOpen1430
                  ? "bg-emerald-600 text-white hover:bg-emerald-700"
                  : "bg-gray-200 text-gray-800 hover:bg-gray-300"
              }`}
            >
              {timerOpen1430 ? "✅ 14:30 タイマー：ON" : "⛔ 14:30 タイマー：OFF"}
            </button>
          </div>
        </div>

        {/* 操作パネル */}
        <div className="w-full max-w-full overflow-x-auto">
          <div className="mx-auto w-full max-w-6xl flex flex-col sm:flex-row justify-center items-center gap-4 mt-4">
            <button
              onClick={() => setShowCanceled((v) => !v)}
              className="px-4 py-2 bg-gray-200 rounded hover:bg-gray-300 w-full sm:w-auto text-center"
            >
              {showCanceled ? "キャンセル時刻を非表示" : "キャンセル時刻を表示"}
            </button>

            <button
              onClick={handleDeleteSelected}
              className="px-4 py-2 bg-red-500 text-white rounded-md hover:bg-red-700 w-full sm:w-auto text-center"
            >
              選択した予約を削除
            </button>

            <button
              onClick={handleExport}
              className="px-4 py-2 bg-blue-500 text-white rounded-md hover:bg-blue-700 w-full sm:w-auto text-center"
            >
              予約データをエクスポート 📥
            </button>

            <input
              type="file"
              accept=".csv"
              onChange={handleImport}
              className="px-4 py-2 border rounded-md w-full sm:w-auto text-center"
            />
          </div>
        </div>

        {/* 予約受付 ON/OFF */}
        <div className="mt-4 flex items-center justify-center gap-3 flex-wrap">
          {isReservationOpen ? (
            <button
              onClick={stopReservation}
              className="px-6 py-3 text-lg font-bold text-white rounded-lg shadow-lg bg-red-500 hover:bg-red-700"
            >
              ⛔ 予約を停止する
            </button>
          ) : (
            <>
              <button
                onClick={resumeReservationNormal}
                className="px-6 py-3 text-lg font-bold text-white rounded-lg shadow-lg bg-green-500 hover:bg-green-700"
              >
                ✅ 予約を再開（通常）
              </button>

              <button
                onClick={resumeReservationForce}
                className="px-6 py-3 text-lg font-bold text-white rounded-lg shadow-lg bg-amber-500 hover:bg-amber-600"
              >
                ⚠️ 予約を再開（強制：上限無視）
              </button>
            </>
          )}
        </div>

        {/* 現在の予約数（1日） */}
        <div className="mt-3 text-center">
          <p className="text-base">
            本日の予約数：
            <span className="font-bold">
              {" "}
              {todayCount}/{maxReservationsDay}{" "}
            </span>
          </p>
          {forceOpenActive && (
            <p className="text-sm text-amber-700 mt-2 font-semibold">
              ⚠️ 強制再開中（上限停止は無効）
            </p>
          )}
        </div>

        {/* 上限設定（1日） */}
        <div className="mt-6 p-4 border rounded">
          <h2 className="text-xl font-bold text-center">予約人数の上限設定（1日）</h2>

          <div className="flex justify-center gap-4 mt-2 items-end flex-wrap">
            <div>
              <label>1日上限：</label>
              <input
                type="number"
                className="border p-2 rounded-md w-24"
                value={maxReservationsDay}
                onChange={(e) => setMaxReservationsDay(Number(e.target.value))}
              />
            </div>

            <button
              onClick={updateMaxReservations}
              className="px-4 py-2 bg-blue-500 text-white rounded-md hover:bg-blue-700"
            >
              設定を保存
            </button>
          </div>

        </div>

        {/* 右下ミニパネル */}
        <div
          className={`fixed bottom-4 right-4 bg-white shadow-lg border border-gray-300 rounded-lg transition-all overflow-hidden ${
            isMinimized
              ? "p-1 w-32 h-10 flex items-center justify-between"
              : "p-1 w-36"
          }`}
        >
          <button
            onClick={() => setIsMinimized(!isMinimized)}
            aria-label={isMinimized ? "ウィジェットを展開" : "ウィジェットを最小化"}
            className="absolute top-1 right-1 w-6 h-6 flex items-center justify-center bg-gray-300 hover:bg-gray-500 text-xs font-bold rounded-full z-10 pointer-events-auto"
          >
            {isMinimized ? "＋" : "−"}
          </button>

          {isMinimized ? (
            <div className="flex items-center gap-1 -mr-2">
              <span
                className={`inline-flex items-center px-1.5 py-0.5 rounded-full text-[11px] font-semibold ${
                  isReservationOpen
                    ? "bg-green-100 text-green-700"
                    : "bg-red-100 text-red-700"
                }`}
              >
                {isReservationOpen ? "受付中" : "停止中"}
              </span>

              <span className="text-[11px] text-gray-600">
                本日 {todayCount}/{maxReservationsDay}
              </span>
            </div>
          ) : (
            <div className="pt-4 -mr-2 text-[10px] leading-tight">
              <h2 className="text-xs font-bold mb-0.5">受付状態</h2>

              <div className="flex items-center gap-1 mb-0.5">
                <span className="text-xs">現在:</span>
                <span
                  className={`inline-flex items-center px-1.5 py-0.5 rounded-full text-[11px] font-semibold ${
                    isReservationOpen
                      ? "bg-green-100 text-green-700"
                      : "bg-red-100 text-red-700"
                  }`}
                >
                  {isReservationOpen ? "受付中 ✅" : "停止中 ⛔"}
                </span>
              </div>

              <div className="text-[10px] text-gray-600 mb-1">
                本日:{" "}
                <span className="font-semibold">
                  {todayCount}/{maxReservationsDay}
                </span>
              </div>

              <div className="w-full flex justify-center gap-1">
                {isReservationOpen ? (
                  <button
                    onClick={stopReservation}
                    className="w-full px-2 py-1.5 text-xs font-bold text-white rounded shadow bg-red-500 hover:bg-red-600"
                  >
                    ⛔ 停止
                  </button>
                ) : (
                  <>
                    <button
                      onClick={resumeReservationNormal}
                      className="w-1/2 px-2 py-1.5 text-xs font-bold text-white rounded shadow bg-green-500 hover:bg-green-600"
                    >
                      ✅ 通常
                    </button>
                    <button
                      onClick={resumeReservationForce}
                      className="w-1/2 px-2 py-1.5 text-xs font-bold text-white rounded shadow bg-amber-500 hover:bg-amber-600"
                    >
                      ⚠️ 強制
                    </button>
                  </>
                )}
              </div>

              {forceOpenActive && (
                <div className="mt-1 text-[10px] font-semibold text-amber-700">
                  ⚠️ 強制再開中
                </div>
              )}

              <hr className="my-1" />

              <ul className="space-y-1">
                {Object.entries(statusCounts).map(([status, count]) => (
                  <li key={status} className="flex items-center">
                    <span
                      className={`inline-flex items-center px-1.5 py-0.5 rounded-full text-[11px] font-medium tracking-tight ${getStatusBadgeClasses(
                        status
                      )}`}
                    >
                      {status}
                      <span className="font-bold text-[11px]">:{count}</span>
                    </span>
                  </li>
                ))}
              </ul>

              <p className="text-[11px] font-bold mt-1">合計: {totalReservations} 件</p>
            </div>
          )}
        </div>

        {/* ログ一覧 */}
        <div className="container mx-auto p-6">
          <h2 className="text-2xl font-bold mb-4">予約システムのログ</h2>

          <table className="w-full border-collapse border border-gray-300">
            <thead>
              <tr className="bg-gray-100">
                <th className="border p-2">操作内容</th>
                <th className="border p-2">日時</th>
                <th className="border p-2">詳細</th>
                <th className="border p-2">端末</th>
                <th className="border p-2">削除</th>
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
                  <td className="border p-2 text-center font-mono text-sm">{log.device || "—"}</td>
                  <td className="border p-2 text-center">
                    <button
                      onClick={() => handleDeleteLog(log.id)}
                      className="px-3 py-1 bg-red-500 text-white rounded hover:bg-red-700"
                    >
                      削除
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="mt-4 flex gap-3">
            <button
              onClick={handleDeleteAllLogs}
              className="px-4 py-2 bg-red-700 text-white rounded-md hover:bg-red-900"
            >
              🚨 すべてのログを削除
            </button>

            <button
              onClick={handleDeleteAll}
              className="px-4 py-2 bg-red-700 text-white rounded-md hover:bg-red-900"
            >
              🚨 全予約を削除
            </button>

            <button
              onClick={handleExport}
              className="px-4 py-2 bg-blue-500 text-white rounded-md hover:bg-blue-700"
            >
              予約データをエクスポート 📥
            </button>
          </div>
        </div>
      </div>

      {/* 端末名設定 */}
      <div className="mt-6 p-4 border rounded bg-gray-50">
        <h2 className="text-lg font-bold mb-2">この端末の名前</h2>
        <p className="text-sm text-gray-500 mb-2">現在：<span className="font-mono font-bold">{deviceName}</span></p>
        <div className="flex gap-2">
          <input
            type="text"
            value={deviceNameInput}
            onChange={e => setDeviceNameInput(e.target.value)}
            placeholder="例：受付PC、診察室PC"
            className="border p-2 rounded w-48"
          />
          <button
            onClick={() => {
              const name = deviceNameInput.trim();
              if (!name) return;
              localStorage.setItem("deviceId", name);
              deviceIdRef.current = name;
              setDeviceName(name);
              alert(`端末名を「${name}」に設定しました`);
            }}
            className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-700"
          >
            保存
          </button>
        </div>
      </div>
    </>
  );
}
