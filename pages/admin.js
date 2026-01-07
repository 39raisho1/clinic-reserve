import React, { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { db } from "../firebaseConfig";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  addDoc,
  query,
  runTransaction,
  serverTimestamp,
  onSnapshot,
  updateDoc,
  writeBatch,
  deleteDoc,
  orderBy,
  Timestamp,
  limit,
  where,
} from "firebase/firestore";
import Papa from "papaparse";
import ManualReservationForm from "../components/ManualReservationForm";
import { nowJST, isoDateKey } from "../utils/timeJST";

// ──────────────────────────────────────────
// ログ記録
const addLog = async (action, details) => {
  await addDoc(collection(db, "logs"), {
    action,
    details,
    user: "admin",
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
const STATUS_LIST = ["予約済", "未受付", "受付済", "外出中", "呼び出し中", "診療中/処置中", "診察終了", "会計済", "キャンセル済"];

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
const toDateKeyJST = (d) => `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}`;

// ★ 受付番号スロット DocId を作る
const slotDocId = (dateKeyISO, receptionNumber) =>
  `${dateKeyISO}_${receptionNumber}`;
// ──────────────────────────────────────────
// ★ freeSlots（空き番号プール）で「最小の未使用番号」を取る

// ゼロパディング（docId用）
const padNo = (n) => String(n).padStart(6, "0");

// ✅ 直来は「6の倍数」固定
const isDirectNo = (no) => Number.isFinite(no) && no > 0 && no < 1001 && no % 6 === 0;

// ✅ freeSlots に戻す/拾う kind 判定（戻せない番号は null）
const kindForPool = (no) => {
  if (!Number.isFinite(no)) return null;
  if (no >= 1001) return "V";
  if (isDirectNo(no)) return "R";
  return null; // 任意番号（手入力）などはプールに戻さない
};

// freeSlots の items コレクション参照
// kind: "R"（直来=6の倍数）, "V"（VIP）
const freeItemsCol = (dateKeyISO, kind) =>
  collection(db, "freeSlots", `${dateKeyISO}_${kind}`, "items");

// ✅ 1クエリで、その日の「最小の空き番号」を取る
const findSmallestFree = async (dateKeyISO, kind) => {
  const q = query(
    freeItemsCol(dateKeyISO, kind),
    orderBy("__name__"),
    limit(1)
  );
  const snap = await getDocs(q);
  if (snap.empty) return null;

  const d = snap.docs[0];
  const no = Number(d.id); // "000006" -> 6
  return { no, ref: d.ref };
};

const chunk = (arr, size) => {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
};

const rebuildFreeSlotsForToday = async () => {
  const now = nowJST();
  const dateKey = toDateKeyJST(now);  // YYYYMMDD
  const dateKeyISO = isoDateKey(now); // YYYY-MM-DD

  // 今日の予約（キャンセル除外で used）
  const rs = await getDocs(
    query(collection(db, "reservations"), where("dateKeyISO", "==", dateKeyISO))
  );

  const usedR = new Set();
  const usedV = new Set();

  rs.docs.forEach((d) => {
  const r = d.data() || {};
  const no = Number(r.receptionNumber);
  if (!Number.isFinite(no)) return;

  // ✅ キャンセル済でも番号は“使用中”として扱う（穴にしない）
  if (r.vip === true || no >= 1001) {
    usedV.add(no);
  } else {
    if (isDirectNo(no)) usedR.add(no); // ✅ 直来は6倍数だけ
    // 任意番号(例:53)は usedR に入れても穴生成に影響しないが、プールの対象ではないので無視でOK
  }
});


  // counter から cursor 取得（上限を決める）
  const counterRef = doc(db, "counters", dateKeyISO);
  const counterSnap = await getDoc(counterRef);
  const counter = counterSnap.exists() ? counterSnap.data() || {} : {};

  const cursorR = (Number(counter.nextRegular ?? 1) * 6);   // 次に払い出す直来番号
  const cursorV = Number(counter.nextVip ?? 1001);          // 次に払い出すVIP番号

  // 直来：used の最大か cursor の手前までを対象に穴を作る
  const maxUsedR = usedR.size ? Math.max(...Array.from(usedR)) : 0;
  const endR = Math.max(maxUsedR, cursorR - 6); // cursor の直前まで

  // VIP：used の最大か cursor の手前まで
  const maxUsedV = usedV.size ? Math.max(...Array.from(usedV)) : 0;
  const endV = Math.max(maxUsedV, cursorV - 1);

  // freeSlots を作る（存在チェックはしない：mergeで上書きOK）
  const toCreateR = [];
  for (let n = 6; n <= endR; n += 6) {
    if (!usedR.has(n)) toCreateR.push(n);
  }

  const toCreateV = [];
  for (let n = 1001; n <= endV; n += 1) {
    if (!usedV.has(n)) toCreateV.push(n);
  }

  // 書き込み（500制限で分割）
  const writesR = chunk(toCreateR, 450); // 余裕持たせる
  for (const part of writesR) {
    const batch = writeBatch(db);
    part.forEach((n) => {
      const ref = doc(freeItemsCol(dateKeyISO, "R"), padNo(n));
      batch.set(ref, { receptionNumber: n, rebuiltAt: serverTimestamp() }, { merge: true });
    });
    await batch.commit();
  }

  const writesV = chunk(toCreateV, 450);
  for (const part of writesV) {
    const batch = writeBatch(db);
    part.forEach((n) => {
      const ref = doc(freeItemsCol(dateKeyISO, "V"), padNo(n));
      batch.set(ref, { receptionNumber: n, rebuiltAt: serverTimestamp() }, { merge: true });
    });
    await batch.commit();
  }

  await addLog(
    "freeSlots再構築",
    `date=${dateKeyISO} / R穴=${toCreateR.length}件 / VIP穴=${toCreateV.length}件 / cursorR=${cursorR} / cursorV=${cursorV}`
  );

  alert(`✅ freeSlots再構築完了\n直来の穴: ${toCreateR.length}\nVIPの穴: ${toCreateV.length}`);
};


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
  const [isReservationOpen, setIsReservationOpen] = useState(true);

  // ★ 1日上限（午前/午後は廃止）
  const [maxReservationsDay, setMaxReservationsDay] = useState(100);

  const [autoPromoteTop20, setAutoPromoteTop20] = useState(false);

  // ★ 予約開始タイマー ON/OFF（JST 8:30 / 14:30）
  // 14:30は本来不要だが、残したいなら残せる（あなたのUIがあるので残す）
  const [timerOpen830, setTimerOpen830] = useState(false);
  const [timerOpen1430, setTimerOpen1430] = useState(false);

  // 強制オープン
  const [forceOpenUntil, setForceOpenUntil] = useState(null); // Date | null
  const [forceOpenActive, setForceOpenActive] = useState(false);

  // ─── reservations/logs ───
  const [reservationsRaw, setReservationsRaw] = useState([]);
  const [logs, setLogs] = useState([]);
  const [selectedReservations, setSelectedReservations] = useState([]);
  const [showCanceled, setShowCanceled] = useState(true);

  // ─── sort ───
  const [sortConfig, setSortConfig] = useState({ key: "receptionNumber", direction: "asc" });

  // ─── UI ───
  const [isMinimized, setIsMinimized] = useState(false);

  // ──────────────────────────────────────────
  // settings 購読（★1本に統合 / 1日上限に統一）
useEffect(() => {
  const settingsRef = doc(db, "settings", "clinic");
  const unsub = onSnapshot(
    settingsRef,
    (snap) => {
      if (!snap.exists()) return;
      const data = snap.data() || {};
      setIsReservationOpen(readBool(data.isReservationOpen, true));

      const m = toPositiveIntOr(data.maxReservationsMorning, 50);
      const a = toPositiveIntOr(data.maxReservationsAfternoon, 50);
      setMaxReservationsDay(toPositiveIntOr(data.maxReservationsDay, m + a));

      setAutoPromoteTop20(readBool(data.autoPromoteTop20, false));
      setTimerOpen830(readBool(data.timerOpen830, false));
      setTimerOpen1430(readBool(data.timerOpen1430, false));

      const until = data.forceOpenUntil?.toDate?.() ?? null;
      setForceOpenUntil(until);
      setForceOpenActive(until ? nowJST() < until : false);
    },
    (err) => console.error("🚨 settings購読エラー:", err)
  );

  return () => unsub();
}, []);

useEffect(() => {
  const logsQuery = query(
    collection(db, "logs"),
    orderBy("timestamp", "desc"),
    limit(200)
  );

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
  dateKey: d.dateKey || null,
  dateKeyISO: d.dateKeyISO || null,
        };
      });
      setLogs(data);
    },
    (err) => console.error("🚨 ログ取得エラー:", err)
  );

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
            await updateDoc(doc(db, "settings", "clinic"), { forceOpenUntil: null });
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
  const todayISO = isoDateKey(nowJST());
  const qRef = query(
    collection(db, "reservations"),
    where("dateKeyISO", "==", todayISO)
  );

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

    const total = reservationsRaw.filter((r) => (r.status || "").trim() !== "キャンセル済").length;

    const now = nowJST();
    const todayKey = toDateKeyJST(now);
    const dateKeyISO = isoDateKey(now);
    const { start, end } = getDayRange(now);

    const isEffective = (r) => (r.status || "未受付").trim() !== "キャンセル済";
    const inRange = (dt, s, e) => dt && s && e && dt >= s && dt < e;

    const tCount = reservationsRaw.filter((r) => {
      if (!isEffective(r)) return false;
      if (r.dateKey) return r.dateKey === todayKey; // 新方式
      return inRange(r.createdAt, start, end); // 旧データ互換
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
  }, [todayCount, maxReservationsDay, isReservationOpen, forceOpenActive, autoStopReservationOnce]);

  // ──────────────────────────────────────────
  // 自動昇格（★1本、OFFなら絶対に動かない、20件まで、二重実行防止）
  const promotingRef = useRef(false);

  useEffect(() => {
    if (!autoPromoteTop20) return;
    if (!reservationsRaw?.length) return;
    if (promotingRef.current) return;

    const already = reservationsRaw.filter((r) => (r.status || "").trim() === "未受付").length;
    if (already >= 20) return;

    promotingRef.current = true;

    const promote = async () => {
      try {
        const need = 20 - already;
        const targets = [...reservationsRaw]
          .filter((r) => (r.status || "").trim() === "予約済")
          .sort((a, b) => (Number(a.receptionNumber) || 0) - (Number(b.receptionNumber) || 0))
          .slice(0, need);

        if (targets.length === 0) return;

        const batch = writeBatch(db);
        targets.forEach((r) => batch.update(doc(db, "reservations", r.id), { status: "未受付" }));
        await batch.commit();
        await addLog("自動昇格実行", `予約済→未受付 ${targets.length}件`);
      } catch (e) {
        console.error("❌ 自動昇格エラー:", e);
      } finally {
        promotingRef.current = false;
      }
    };

    promote();
  }, [autoPromoteTop20, reservationsRaw]);

  // ──────────────────────────────────────────
  // ★ 追加：予約受付 自動開始タイマー（JST 8:30 / 14:30）
  const openReservationByTimer = useCallback(async (label, fieldKey) => {
  const settingsRef = doc(db, "settings", "clinic");
  const logsCol = collection(db, "logs");
  const todayISO = isoDateKey(nowJST());

  try {
    const res = await runTransaction(db, async (tx) => {
      const snap = await tx.get(settingsRef);
      if (!snap.exists()) return { did: false, reason: "no_settings" };

      const s = snap.data() || {};
      const last = s[fieldKey] || null;

      // ★同日二重発火を抑止（端末/タブが多くてもここで止まる）
      if (last === todayISO) return { did: false, reason: "already_done" };

      tx.update(settingsRef, {
        isReservationOpen: true,
        forceOpenUntil: null,
        [fieldKey]: todayISO,
        lastTimerOpenAt: serverTimestamp(),
        lastTimerOpenLabel: label,
      });

      const logRef = doc(logsCol);
      tx.set(logRef, {
        action: "タイマー：自動開始",
        details: `${label} により予約受付を自動再開（多重発火防止済）`,
        user: "system",
        timestamp: serverTimestamp(),
      });

      return { did: true };
    });

    // ここで res.did false のときは何もしない（ログも増えない）
  } catch (e) {
    console.error("❌ openReservationByTimer(tx) エラー:", e);
  }
}, []);


  const timer830Ref = useRef(null);
  const timer1430Ref = useRef(null);

  const scheduleDailyTimer = useCallback((hour, minute, enabled, ref, fire) => {
  if (ref.current) clearTimeout(ref.current);
  if (!enabled) return;

  const now = nowJST();
  const next = new Date(now);
  next.setHours(hour, minute, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);

  ref.current = setTimeout(async () => {
    await fire();
    scheduleDailyTimer(hour, minute, enabled, ref, fire);
  }, next.getTime() - now.getTime());
}, []);

useEffect(() => {
  scheduleDailyTimer(8, 30, timerOpen830, timer830Ref, () =>
    openReservationByTimer("8:30タイマー", "lastTimerOpen830DateISO")
  );

  scheduleDailyTimer(14, 30, timerOpen1430, timer1430Ref, () =>
    openReservationByTimer("14:30タイマー", "lastTimerOpen1430DateISO")
  );

  return () => {
    if (timer830Ref.current) clearTimeout(timer830Ref.current);
    if (timer1430Ref.current) clearTimeout(timer1430Ref.current);
  };
}, [timerOpen830, timerOpen1430, scheduleDailyTimer, openReservationByTimer]);


  // ──────────────────────────────────────────
  // ★追加：手動操作を「停止」「通常再開」「強制再開」に分離
  const stopReservation = async () => {
    const settingsRef = doc(db, "settings", "clinic");
    try {
      await updateDoc(settingsRef, { isReservationOpen: false, forceOpenUntil: null });
      await addLog("手動：停止", "手動ボタンで受付停止");
    } catch (e) {
      console.error("❌ stopReservation エラー:", e);
    }
  };

  const resumeReservationNormal = async () => {
    const settingsRef = doc(db, "settings", "clinic");
    try {
      await updateDoc(settingsRef, { isReservationOpen: true, forceOpenUntil: null });
      await addLog("手動：再開(通常)", "上限到達時は自動停止が効く通常再開");
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
      await updateDoc(settingsRef, { isReservationOpen: true, forceOpenUntil: Timestamp.fromDate(end) });
      await addLog("手動：再開(強制)", `本日終了まで上限無視。期限 ${end.toLocaleString("ja-JP", { hour12: false })}`);
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

  // ✅ 今日の「孤児slot（reservationが消えてるのにslotだけ残ってる）」を掃除して番号を復活させる
const cleanupOrphanSlotsToday = async () => {
  const todayISO = isoDateKey(nowJST());

  try {
    // 今日のslot一覧
    const slotSnap = await getDocs(
      query(collection(db, "reservationSlots"), where("dateKeyISO", "==", todayISO))
    );

    if (slotSnap.empty) {
      alert("✅ 今日のreservationSlotsは空です（掃除不要）");
      return;
    }

    const slots = slotSnap.docs.map((d) => ({
      id: d.id,
      ref: d.ref,
      ...(d.data() || {}),
    }));

    let freed = 0;

    // 500制限に引っかかりやすいので、まずはバッチを分けてcommitする
    // 当日分なので多くても数百程度の想定
    let batch = writeBatch(db);
    let ops = 0;

    for (const s of slots) {
      const rid = s.reservationId;
      const no = Number(s.receptionNumber);

      if (!rid || !Number.isFinite(no)) continue;

      // reservation が存在するか確認（存在しなければ孤児）
      const rSnap = await getDoc(doc(db, "reservations", rid));
      if (rSnap.exists()) continue;

      // 1) 孤児slot削除
      batch.delete(s.ref);
      ops++;

      // 2) freeSlotsへ戻す（VIP判定は番号で確定）
      const kind = kindForPool(no); // "V" | "R" | null

      // 1) slot削除（孤児は必ず消す）
batch.delete(s.ref);
ops++;

// 2) freeSlotsへ戻す（戻せる番号だけ）
if (kind) {
  const freeRef = doc(freeItemsCol(todayISO, kind), padNo(no));
  batch.set(
    freeRef,
    { receptionNumber: no, freedAt: serverTimestamp(), freedBy: "orphan_cleanup" },
    { merge: true }
  );
  ops++;
  freed++;
}


      const freeRef = doc(freeItemsCol(todayISO, kind), padNo(no));
      batch.set(
        freeRef,
        { receptionNumber: no, freedAt: serverTimestamp(), freedBy: "orphan_cleanup" },
        { merge: true }
      );
      ops++;

      freed++;

      // 450操作くらいでcommit（余裕）
      if (ops >= 450) {
        await batch.commit();
        batch = writeBatch(db);
        ops = 0;
      }
    }

    if (ops > 0) await batch.commit();

    await addLog("孤児slot掃除", `date=${todayISO} / 解放=${freed}件`);
    alert(`✅ 孤児slot掃除完了：${freed}件 解放しました`);
  } catch (e) {
    console.error("❌ cleanupOrphanSlotsToday エラー:", e);
    alert("❌ 孤児slot掃除に失敗: " + (e?.message || String(e)));
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
      const direction = prev.key === key && prev.direction === "asc" ? "desc" : "asc";
      return { key, direction };
    });
  };

  const handleStatusChange = async (id, newStatus) => {
    const ref = doc(db, "reservations", id);
    try {
      if (newStatus === "キャンセル済") {
        await updateDoc(ref, { status: "キャンセル済", canceledAt: serverTimestamp() });
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
      await addLog("自動昇格フラグ変更", next ? "ON：先頭20件を未受付へ" : "OFF：自動昇格停止");
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
      await addLog("タイマー設定変更", next ? "ON：8:30に予約受付を自動開始" : "OFF：8:30自動開始を停止");
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
      await addLog("タイマー設定変更", next ? "ON：14:30に予約受付を自動開始" : "OFF：14:30自動開始を停止");
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
    await addLog("予約上限変更", `1日上限=${maxReservationsDay}（互換: morning/afternoon も同期）`);
  } catch (e) {
    console.error("❌ 上限保存失敗:", e);
    alert("上限の保存に失敗しました。Firestoreの権限/接続を確認してください。");
  }
};

  const handleDeleteSelected = async () => {
  if (!window.confirm("選択した予約を削除しますか？")) return;

  const targets = reservationsRaw.filter((r) => selectedReservations.includes(r.id));
  const batch = writeBatch(db);

  targets.forEach((r) => {
    batch.delete(doc(db, "reservations", r.id));

    if (r.dateKeyISO && r.receptionNumber) {
      // slot削除
      batch.delete(doc(db, "reservationSlots", slotDocId(r.dateKeyISO, r.receptionNumber)));

      // ✅ freeへ戻す（VIPか直来か）
      const no = Number(r.receptionNumber);
const kind = kindForPool(no); // "V" | "R" | null

if (kind) {
  const freeRef = doc(freeItemsCol(r.dateKeyISO, kind), padNo(no));
  batch.set(
    freeRef,
    { receptionNumber: no, freedAt: serverTimestamp() },
    { merge: true }
  );
}

    }
  });

  await batch.commit();
  await addLog("予約削除", `削除 ${targets.length}件（slot削除＋free戻し）`);
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
          const dateKeyISO = isoDateKey(createdAt);

          await addDoc(collection(db, "reservations"), {
            receptionNumber: parseInt(row.受付番号, 10),
            createdAt: Timestamp.fromDate(createdAt), // ★型を揃える（推奨）
            type: row.初診_再診 || "不明",
            cardNumber: row.診察券番号 || "",
            name: row.名前,
            birthdate: row.生年月日 || "",
            phone: row.電話番号 || "",
            status: row.受付状態 || "予約済",
            dateKey,
            dateKeyISO,
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
    if (!window.confirm("⚠️ 本当にすべての予約データを削除しますか？ この操作は元に戻せません！")) return;
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
    if (!window.confirm("⚠️ 本当にすべてのログを削除しますか？ この操作は元に戻せません！")) return;
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

  const createReservationAtomic = async ({
  vip,
  payload,
  allowEvenIfClosed = false,
  allowEvenIfOverLimit = false,
}) => {
  const now = nowJST();
  const dateKeyISO = isoDateKey(now);
  const dateKey = String(dateKeyISO).replace(/-/g, ""); // ✅ ISO→YYYYMMDDで整合

  const kind = vip ? "V" : "R";
  const step = vip ? 1 : 6;

  // 先読み（トランザクション内で existence 再確認するのでOK）
  const free = await findSmallestFree(dateKeyISO, kind); // { no, ref } | null

  const settingsRef = doc(db, "settings", "clinic");
  const counterRef = doc(db, "counters", dateKeyISO);
  const reservationsCol = collection(db, "reservations");

  const result = await runTransaction(db, async (tx) => {
    // ---- READ PHASE（ここから write するまで読み切る）----
    const settingsSnap = await tx.get(settingsRef);
    const counterSnap = await tx.get(counterRef);
    const freeSnap = free ? await tx.get(free.ref) : null;

    const settings = settingsSnap.exists() ? settingsSnap.data() || {} : {};
    const counter = counterSnap.exists() ? counterSnap.data() || {} : {};

    const isOpen = readBool(settings.isReservationOpen, true);

    // ✅ 上限読み取りはあなたの方針でOKだが、0(無制限)を必ず許容
    const limitNum = toPositiveIntOr(settings.maxReservationsDay, maxReservationsDay);

    const until = settings.forceOpenUntil?.toDate?.() ?? null;
    const forceActive = until ? now < until : false;

    const count = Number(counter.count ?? 0);

    const closedAtCreate = (!forceActive && !isOpen);
    const overLimitAtCreate = (!forceActive && limitNum > 0 && count >= limitNum); // ✅ここが必須修正

    if (closedAtCreate && !allowEvenIfClosed) {
      throw new Error("受付停止中です（通常再開するか、強制再開してください）");
    }
    if (overLimitAtCreate && !allowEvenIfOverLimit) {
      throw new Error(`上限に達しています（${count}/${limitNum}）`);
    }

    // cursor
    let cursorNo;
    if (vip) {
      cursorNo = Number(counter.nextVip ?? 1001);
      if (cursorNo < 1001) cursorNo = 1001;
    } else {
      const nextRegular = Number(counter.nextRegular ?? 1);
      cursorNo = nextRegular * 6;
      if (cursorNo < 6) cursorNo = 6;
    }

    // free候補の妥当性
    let freeOk = !!(free && freeSnap && freeSnap.exists());
    let freeNo = freeOk ? Number(free.no) : null;

    // 「後で消す」free（ゴミ or stale）
    let deleteFreeRef = null;

    // ゴミ free の自己修復（直来なのに6の倍数じゃない）
    if (freeOk && kind === "R" && !isDirectNo(freeNo)) {
      deleteFreeRef = free.ref; // あとで削除
      freeOk = false;
      freeNo = null;
    }

    // 開始候補：free が cursor 以下なら free 優先
    let candidateStart = (freeOk && freeNo <= cursorNo) ? freeNo : cursorNo;

    // 直来は必ず6の倍数に寄せる（念のため）
    if (!vip) {
      if (!isDirectNo(candidateStart)) {
        // 次の6の倍数へ繰り上げ
        candidateStart = Math.ceil(candidateStart / 6) * 6;
      }
    }

    // ✅ slot 競合したら次へ（transaction内で read を繰り返す）
    let chosen = null;
    let candidate = candidateStart;

    for (let i = 0; i < 5000; i++) {
      if (!vip && !isDirectNo(candidate)) {
        candidate = Math.ceil(candidate / 6) * 6;
      }

      const slotRef = doc(db, "reservationSlots", slotDocId(dateKeyISO, candidate));
      const slotSnap = await tx.get(slotRef);

      if (!slotSnap.exists()) {
        chosen = candidate;
        break;
      }

      // freeNo が stale（空きに見えるのに slot がある）なら掃除対象
      if (freeOk && freeNo === candidate && free?.ref) {
        deleteFreeRef = free.ref;
      }

      candidate += step;
    }

    if (chosen === null) {
      throw new Error("番号枠が満杯です（空きが見つかりません）");
    }

    // ---- WRITE PHASE（ここから先は read しない）----
    const newRef = doc(reservationsCol); // ✅ 参照作るだけでwriteではない

    if (deleteFreeRef) tx.delete(deleteFreeRef);

    const counterPatch = { count: count + 1 };

    // cursor は「chosen が cursor 以上なら」進める（freeで巻き戻った場合は維持）
    if (chosen >= cursorNo) {
      if (vip) counterPatch.nextVip = chosen + 1;
      else counterPatch.nextRegular = (chosen / 6) + 1;
    }

    tx.set(counterRef, counterPatch, { merge: true });

    tx.set(newRef, {
      ...payload,                 // ✅先にpayload
      receptionNumber: chosen,    // ✅確定値で上書き
      createdAt: serverTimestamp(),
      status: "予約済",
      dateKey,
      dateKeyISO,
      vip: !!vip,
      createdBy: "admin",
    });

    const finalSlotRef = doc(db, "reservationSlots", slotDocId(dateKeyISO, chosen));
    tx.set(finalSlotRef, {
      dateKeyISO,
      receptionNumber: chosen,
      reservationId: newRef.id,
      createdAt: serverTimestamp(),
      createdBy: "admin",
      kind: vip ? "vip" : "direct",
    });

    // free を採用した場合も削除（ただし chosen==freeNo のとき）
    if (freeOk && freeNo === chosen && free?.ref) {
      tx.delete(free.ref);
    }

    return {
      receptionNumber: chosen,
      limit: limitNum,
      count,
      closedAtCreate,
      overLimitAtCreate,
    };
  });

  return { ...result, dateKey, dateKeyISO };
};

  const handleAddNewReservation = async (newReservationData) => {
    if (isAdding) return;
    if (!validateNewReservation()) return;
    setIsAdding(true);

    try {
      // ✅ 直来：停止中でもOK / 上限超過でもOK
      const { receptionNumber, overLimitAtCreate, closedAtCreate, limit, count } = await createReservationAtomic({
        vip: false,
        payload: newReservationData,
        allowEvenIfClosed: true,
        allowEvenIfOverLimit: true,
      });

      alert(`✅ 予約を追加しました！（受付番号：${receptionNumber}）`);
      setNewReservation({ name: "", type: "初診", cardNumber: "", birthdate: "", phone: "" });

      const flags = [closedAtCreate ? "停止中でも追加" : null, overLimitAtCreate ? `上限超過でも追加(${count}/${limit})` : null].filter(Boolean);
      await addLog("手動追加：直来", `受付番号=${receptionNumber}${flags.length ? " / " + flags.join(" / ") : ""}`);
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
      const { receptionNumber, overLimitAtCreate, closedAtCreate, limit, count } = await createReservationAtomic({
        vip: true,
        payload: newReservationData,
        allowEvenIfClosed: true,
        allowEvenIfOverLimit: true,
      });

      alert(`✅ VIP予約を追加しました！（受付番号：${receptionNumber}）`);
      setNewReservation({ name: "", type: "初診", cardNumber: "", birthdate: "", phone: "" });

      const flags = [closedAtCreate ? "停止中でも追加" : null, overLimitAtCreate ? `上限超過でも追加(${count}/${limit})` : null].filter(Boolean);
      await addLog("手動追加：VIP", `受付番号=${receptionNumber}${flags.length ? " / " + flags.join(" / ") : ""}`);
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
          <button type="submit" className="w-full bg-blue-500 text-white py-2 rounded hover:bg-blue-600">
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
        <img src="/chin.png" alt="チン王" className="h-14 w-auto sm:h-16 md:h-20 object-contain" />
      </div>

      <div className="container mx-auto p-6">
        {/* 予約一覧テーブル */}
        <table className="w-full border-collapse border border-gray-300 mt-4">
          <thead>
            <tr className="bg-gray-100">
              <th className="border p-2 cursor-pointer w-12" onClick={() => handleSort("receptionNumber")}>
                受付番号 ▲▼
              </th>
              <th className="border p-2 cursor-pointer w-16" onClick={() => handleSort("createdAt")}>
                予約取得時刻 ▲▼
              </th>
              {showCanceled && (
                <th className="border p-2 cursor-pointer w-16" onClick={() => handleSort("canceledAt")}>
                  キャンセル時刻 ▲▼
                </th>
              )}
              <th className="border p-2 cursor-pointer w-12" onClick={() => handleSort("status")}>
                受付状態 ▲▼
              </th>
              <th className="border p-2 cursor-pointer w-16" onClick={() => handleSort("acceptedAt")}>
                受付完了時刻 ▲▼
              </th>
              <th className="border p-2 cursor-pointer w-14" onClick={() => handleSort("type")}>
                初診/再診 ▲▼
              </th>
              <th className="border p-2 w-16">診察券番号</th>
              <th className="border p-2 w-36">名前</th>
              <th className="border p-2 w-16">生年月日</th>
              <th className="border p-2 w-60">コメント</th>
              <th className="border p-2 w-16">電話番号</th>
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
                      ? new Intl.DateTimeFormat("ja-JP", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).format(
                          r.createdAt
                        )
                      : ""}
                  </td>

                  {showCanceled && (
                    <td className="border p-2 text-center">
                      {r.canceledAt
                        ? new Intl.DateTimeFormat("ja-JP", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).format(
                            r.canceledAt
                          )
                        : ""}
                    </td>
                  )}

                  <td className="border p-2 text-center">
                    <select value={r.status} onChange={(e) => handleStatusChange(r.id, e.target.value)} className="border rounded p-1">
                      {STATUS_LIST.map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </select>
                  </td>

                  <td className="border p-2 text-center">
                    {r.acceptedAt
                      ? new Intl.DateTimeFormat("ja-JP", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).format(
                          r.acceptedAt
                        )
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
                        setReservationsRaw((prev) => prev.map((x) => (x.id === r.id ? { ...x, comment: v } : x)));
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
                        setSelectedReservations((prev) => (e.target.checked ? [...prev, r.id] : prev.filter((id) => id !== r.id)));
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
                onChange={(e) => setNewReservation({ ...newReservation, name: e.target.value })}
                placeholder="例: チンオウ ユリア"
                className="w-full border p-2 rounded"
              />
            </div>

            <div>
              <label className="block text-sm">初診/再診</label>
              <select value={newReservation.type} onChange={(e) => setNewReservation({ ...newReservation, type: e.target.value })} className="w-full border p-2 rounded">
                <option value="初診">初診</option>
                <option value="再診">再診</option>
              </select>
            </div>

            <div>
              <label className="block text-sm">診察券番号</label>
              <input
                type="tel"
                value={newReservation.cardNumber}
                onChange={(e) => setNewReservation((prev) => ({ ...prev, cardNumber: e.target.value }))}
                placeholder="例: 123456"
                className="w-full border p-2 rounded"
              />
            </div>

            <div>
              <label className="block text-sm">生年月日</label>
              <input
                type="text"
                value={newReservation.birthdate}
                onChange={(e) => setNewReservation((prev) => ({ ...prev, birthdate: e.target.value }))}
                placeholder="YYYYMMDD"
                className="w-full border p-2 rounded"
              />
            </div>

            <div>
              <label className="block text-sm">電話番号</label>
              <input
                type="tel"
                value={newReservation.phone}
                onChange={(e) => setNewReservation({ ...newReservation, phone: e.target.value })}
                placeholder="例: 08012345678"
                className="w-full border p-2 rounded"
              />
            </div>

            <div className="md:col-span-6 flex flex-col sm:flex-row items-stretch sm:items-center sm:space-x-2 space-y-2 sm:space-y-0">
              <button
                onClick={() => handleAddNewReservation(newReservation)}
                disabled={isAdding}
                className={`w-full sm:flex-1 min-h-[44px] px-3 py-2 text-sm sm:text-base leading-none tracking-tight rounded-lg text-white ${
                  isAdding ? "bg-green-300 cursor-not-allowed" : "bg-green-500 hover:bg-green-600 active:bg-green-700"
                }`}
              >
                {isAdding ? "送信中…" : "予約を追加（直来・6の倍数）"}
              </button>

              <button
                onClick={() => handleAddVIPReservation(newReservation)}
                disabled={isAddingVIP}
                className={`w-full sm:flex-1 min-h-[44px] px-3 py-2 text-sm sm:text-base leading-none tracking-tight rounded-lg text-white ${
                  isAddingVIP ? "bg-yellow-200 cursor-not-allowed" : "bg-yellow-400 hover:bg-yellow-500 active:bg-yellow-600"
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
          <p className="text-sm text-gray-700 mb-3">数字が小さい「予約済」を上から20件まで、自動で「未受付」に変換する機能のON/OFF。</p>
          <button
            onClick={toggleAutoPromoteTop20}
            className={`px-4 py-2 rounded-lg font-semibold shadow ${
              autoPromoteTop20 ? "bg-indigo-500 text-white hover:bg-indigo-600" : "bg-gray-200 text-gray-800 hover:bg-gray-300"
            }`}
          >
            {autoPromoteTop20 ? "✅ 自動昇格：ON（20件を自動で『未受付』へ）" : "⛔ 自動昇格：OFF（自動で変更しない）"}
          </button>
        </div>

        {/* 予約開始タイマー ON/OFF */}
        <div className="mb-6 p-4 border rounded bg-emerald-50">
          <h2 className="text-lg font-bold mb-2">予約受付：自動開始タイマー（JST）</h2>
          <p className="text-sm text-gray-700 mb-3">管理画面を開いている端末で、指定時刻に「予約受付」を自動でONにします。</p>

          <div className="flex flex-col sm:flex-row gap-2">
            <button
              onClick={toggleTimerOpen830}
              className={`px-4 py-2 rounded-lg font-semibold shadow ${
                timerOpen830 ? "bg-emerald-600 text-white hover:bg-emerald-700" : "bg-gray-200 text-gray-800 hover:bg-gray-300"
              }`}
            >
              {timerOpen830 ? "✅ 8:30 タイマー：ON" : "⛔ 8:30 タイマー：OFF"}
            </button>

            <button
              onClick={toggleTimerOpen1430}
              className={`px-4 py-2 rounded-lg font-semibold shadow ${
                timerOpen1430 ? "bg-emerald-600 text-white hover:bg-emerald-700" : "bg-gray-200 text-gray-800 hover:bg-gray-300"
              }`}
            >
              {timerOpen1430 ? "✅ 14:30 タイマー：ON" : "⛔ 14:30 タイマー：OFF"}
            </button>
          </div>
        </div>

        {/* 操作パネル */}
        <div className="w-full max-w-full overflow-x-auto">
          <div className="mx-auto w-full max-w-6xl flex flex-col sm:flex-row justify-center items-center gap-4 mt-4">
            <button onClick={() => setShowCanceled((v) => !v)} className="px-4 py-2 bg-gray-200 rounded hover:bg-gray-300 w-full sm:w-auto text-center">
              {showCanceled ? "キャンセル時刻を非表示" : "キャンセル時刻を表示"}
            </button>

            <button onClick={handleDeleteSelected} className="px-4 py-2 bg-red-500 text-white rounded-md hover:bg-red-700 w-full sm:w-auto text-center">
              選択した予約を削除
            </button>

            <button onClick={handleExport} className="px-4 py-2 bg-blue-500 text-white rounded-md hover:bg-blue-700 w-full sm:w-auto text-center">
              予約データをエクスポート 📥
            </button>
           
            <input type="file" accept=".csv" onChange={handleImport} className="px-4 py-2 border rounded-md w-full sm:w-auto text-center" />
          </div>
        </div>

        {/* 予約受付 ON/OFF */}
        <div className="mt-4 flex items-center justify-center gap-3 flex-wrap">
          {isReservationOpen ? (
            <button onClick={stopReservation} className="px-6 py-3 text-lg font-bold text-white rounded-lg shadow-lg bg-red-500 hover:bg-red-700">
              ⛔ 予約を停止する
            </button>
          ) : (
            <>
              <button onClick={resumeReservationNormal} className="px-6 py-3 text-lg font-bold text-white rounded-lg shadow-lg bg-green-500 hover:bg-green-700">
                ✅ 予約を再開（通常）
              </button>

              <button onClick={resumeReservationForce} className="px-6 py-3 text-lg font-bold text-white rounded-lg shadow-lg bg-amber-500 hover:bg-amber-600">
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
              {todayCount}/{maxReservationsDay}
            </span>
          </p>

          {forceOpenActive && <p className="text-sm text-amber-700 mt-2 font-semibold">⚠️ 強制再開中（上限停止は無効）</p>}
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

            <button onClick={updateMaxReservations} className="px-4 py-2 bg-blue-500 text-white rounded-md hover:bg-blue-700">
              設定を保存
            </button>
          </div>

          <p className="text-xs text-gray-600 text-center mt-2">
            ※ 旧設定（午前/午後）が残っていても、maxReservationsDay が無ければ「午前+午後」を1日上限として自動採用します。
          </p>
        </div>

        {/* 右下ミニパネル */}
        <div
          className={`
            fixed bottom-4 right-4 bg-white shadow-lg border border-gray-300
            rounded-lg transition-all overflow-hidden
            ${isMinimized ? "p-1 w-32 h-10 flex items-center justify-between" : "p-1 w-36"}
          `}
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
                  isReservationOpen ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"
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
                    isReservationOpen ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"
                  }`}
                >
                  {isReservationOpen ? "受付中 ✅" : "停止中 ⛔"}
                </span>
              </div>

              <div className="text-[10px] text-gray-600 mb-1">
                本日:
                <span className="font-semibold">
                  {todayCount}/{maxReservationsDay}
                </span>
              </div>

              <div className="w-full flex justify-center gap-1">
                {isReservationOpen ? (
                  <button onClick={stopReservation} className="w-full px-2 py-1.5 text-xs font-bold text-white rounded shadow bg-red-500 hover:bg-red-600">
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

              {forceOpenActive && <div className="mt-1 text-[10px] font-semibold text-amber-700">⚠️ 強制再開中</div>}

              <hr className="my-1" />

              <ul className="space-y-1">
                {Object.entries(statusCounts).map(([status, count]) => (
                  <li key={status} className="flex items-center">
                    <span className={`inline-flex items-center px-1.5 py-0.5 rounded-full text-[11px] font-medium tracking-tight ${getStatusBadgeClasses(status)}`}>
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
                <th className="border p-2">削除</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((log) => (
                <tr key={log.id} className="border">
                  <td className="border p-2">{log.action}</td>
                  <td className="border p-2">{log.timestamp ? log.timestamp.toLocaleString("ja-JP", { hour12: false }) : ""}</td>
                  <td className="border p-2">{log.details}</td>
                  <td className="border p-2 text-center">
                    <button onClick={() => handleDeleteLog(log.id)} className="px-3 py-1 bg-red-500 text-white rounded hover:bg-red-700">
                      削除
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="mt-4 flex gap-3">
            <button onClick={handleDeleteAllLogs} className="px-4 py-2 bg-red-700 text-white rounded-md hover:bg-red-900">
              🚨 すべてのログを削除
            </button>
            <button onClick={handleDeleteAll} className="px-4 py-2 bg-red-700 text-white rounded-md hover:bg-red-900">
              🚨 全予約を削除
            </button>
            <button onClick={handleExport} className="px-4 py-2 bg-blue-500 text-white rounded-md hover:bg-blue-700">
              予約データをエクスポート 📥
            </button>
            <button
  onClick={cleanupOrphanSlotsToday}
  className="px-4 py-2 bg-black text-white rounded-md hover:bg-gray-800"
>
  🧹 今日の孤児slotを掃除（DUPLICATE_NO対策）
</button>

             <button
             onClick={rebuildFreeSlotsForToday}
             className="px-4 py-2 bg-black text-white rounded-md hover:bg-gray-800">
             🛠 本日の番号プールを再構築（穴を埋める）
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
