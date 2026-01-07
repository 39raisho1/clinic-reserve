import React, { useState, useEffect, useMemo } from "react";
import Link from "next/link";
import { db } from "../firebaseConfig";
import {
  doc,
  onSnapshot,
  collection,
  query,
  where,
} from "firebase/firestore";
import { nowJST, isoDateKey } from "../utils/timeJST";
import CrowdStatus from "../components/CrowdStatus";
import PendingList from "../components/PendingList";

export default function Home() {
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [isReservationOpen, setIsReservationOpen] = useState(true);
  const [maxPerDay, setMaxPerDay] = useState(0);
  const [forceOpenUntil, setForceOpenUntil] = useState(null);
  const [forceOpenActive, setForceOpenActive] = useState(false);

  // ✅ 当日合算カウント（reservations実体から算出）
  const [countToday, setCountToday] = useState(0);

  // ── 設定を購読（isReservationOpen / maxReservationsPerDay / forceOpenUntil）
  useEffect(() => {
    const settingsRef = doc(db, "settings", "clinic");
    return onSnapshot(settingsRef, (snap) => {
      if (!snap.exists()) return;
      const d = snap.data() || {};
      setIsReservationOpen(!!d.isReservationOpen);
      setMaxPerDay(Number(d.maxReservationsPerDay || 0));
      const until = d.forceOpenUntil?.toDate?.() ?? null;
      setForceOpenUntil(until);
      setForceOpenActive(until ? nowJST() < until : false);
      setSettingsLoaded(true);
    });
  }, []);

  // ── 強制オープンの期限をポーリング（30秒ごと）
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

  // ✅ 当日（JST）の予約数を reservations から集計（dateKeyISO が真実）
    useEffect(() => {
  const todayISO = isoDateKey(nowJST());
  const qRef = query(
    collection(db, "reservations"),
    where("dateKeyISO", "==", todayISO)
  );

  return onSnapshot(qRef, (snap) => {
    const n = snap.docs.filter(d => (d.data()?.status || "").trim() !== "キャンセル済").length;
    setCountToday(n);
  });
}, []);

  // ── 受付可否（強制オープン中は上限超えでも受付可）
  const limitReached = useMemo(
    () => Number(maxPerDay || 0) > 0 && countToday >= Number(maxPerDay || 0),
    [maxPerDay, countToday]
  );

  const isClosed = useMemo(() => {
    if (forceOpenActive) return false;
    if (!isReservationOpen) return true;
    return limitReached;
  }, [forceOpenActive, isReservationOpen, limitReached]);

  const canReserve =
    settingsLoaded && (isReservationOpen || forceOpenActive) && !isClosed;

  return (
    <div className="flex flex-col items-center justify-center min-h-screen p-4">
      <img src="/logo.png" alt="けんおう皮フ科クリニック" className="w-40 h-40 mb-6" />
      <h1 className="text-4xl font-bold text-center mb-4">
        けんおう皮フ科クリニック 予約ページ
      </h1>

      <PendingList />
      <CrowdStatus />

      <p className="text-3xl text-red-600 font-bold mt-6 text-center">～お知らせ～</p>
      <p className="text-xl text-red-600 font-bold mt-6 text-center">あけましておめでとうございます。</p>
      <p className="text-xl text-red-600 font-bold mt-6 text-center">昨年は大変多くの患者さんに受診していただきました。感謝いたします。</p>
      <p className="text-xl text-red-600 font-bold mt-6 text-center">今年はなるべくお待たせしないように、そして診療の質を下げないように精進してまいります。</p>
      <p className="text-xl text-red-600 font-bold mt-6 text-center">どうか今年もよろしくお願いいたします。</p>
      <p className="text-xl text-red-600 font-bold mt-6 text-center"></p>
      <p className="text-xl text-red-600 font-bold mt-6 text-center"></p>
      <p className="text-xl text-red-600 font-bold mt-6 text-center"></p>
      <p className="text-xl text-red-600 font-bold mt-6 text-center"></p>
      <p className="text-l text-blue-600 font-bold mt-4"></p>
      <p className="text-l text-blue-600 font-bold mt-4">1月の日曜診療は4日と18日の午前中となります。</p>
      <p className="text-l text-blue-600 font-bold mt-4">2月の日曜診療は1日と15日の午前中となります。</p>

      <br />
      <br />

      {/* 満員 or 停止の表示（強制オープン時は非表示） */}
      {settingsLoaded && !forceOpenActive && isClosed && (
        <p className="text-xl text-red-600 font-bold mt-6 text-center">
          ⛔本日の予約上限に達しました。<br />
          現在、予約受付を停止しています。<br /><br />
          午前は8:30、午後は14:30から受付開始となります<br /><br />
          土曜は昼休みなしでの診療となりますので8:30からの予約のみとなります<br />
          土曜は直接ご来院いただいた方でも15時で受付を締め切ります。<br />
        </p>
      )}

      <br />
      <img src="/chin.png" alt="チンおう" className="w-40 h-40 mb-6" />

      {/* 予約ボタン（受付可能時のみ） */}
      <div className="flex flex-col gap-8 w-full max-w-md mt-6">
        {canReserve && (
          <>
            <Link href="/shoshin">
              <div className="px-8 py-6 bg-blue-500 text-white text-center text-2xl font-bold rounded-lg hover:bg-blue-700 shadow-lg cursor-pointer">
                初めての方
              </div>
            </Link>
            <Link href="/saishin">
              <div className="px-8 py-6 bg-green-500 text-white text-center text-2xl font-bold rounded-lg hover:bg-green-700 shadow-lg cursor-pointer">
                以前受診された方
              </div>
            </Link>
          </>
        )}

        <Link href="/confirm">
          <div className="px-8 py-6 bg-red-500 text-white text-center text-2xl font-bold rounded-lg hover:bg-red-700 shadow-lg cursor-pointer">
            予約の確認・キャンセル
          </div>
        </Link>
      </div>

      <br />

      <p className="text-3xl text-black-600 font-bold mt-4">予約受付時間</p>
      <br />
      <br />

      <p className="text-3xl text-black-600 font-bold mt-4">月、木、金、土、日(月に1～2回)</p>
      <p className="text-3xl text-black-600 font-bold mt-4">午前 8時30分～12時30分</p>
      <p className="text-3xl text-black-600 font-bold mt-4">午後 14時30分～18時00分</p>
      <p className="text-3xl text-black-600 font-bold mt-4"></p>

      <p className="text-xl text-red-600 font-bold mt-6 text-center">
        ※土曜日の診察は9:30～1900まで通しで診療します<br />
        (**土曜の受付は15:00まで**)
      </p>
      <br />

      <p className="text-2xl text-red-600 font-bold mt-4">
        ※注意事項(必ずお読みください)<br />
      </p>
      当院の診察は当日のみの順番予約制となります。<br />
      午前の受付で午後の診察を希望することはできませんのでご注意ください。<br />
      当日午前または午後の予約人数が上限に達しますと、予約受付が停止いたします。<br />
      診察できる人数を超えてしまった場合は、やむを得ず受付時間内でもWEB受付を停止させていただく場合がございます。予めご了承ください。<br />
      web予約人数が上限に達しても、予約受付時間内(午前9時30分～12時30分、午後15時～18時00分)に直接ご来院いただければ診察いたします。<br />
      <br />
      自費診療(美容)の予約は承っておりませんので、施術をご希望の日に直接ご来院いただきますようお願いいたします。<br />
      web予約では保険診療と自費診療(美容)の区別はなく、予約いただいた順番での診察になります。<br />
      当院で美容施術を受けたことのある方は受付にお伝えください。<br />
      診察内容によって診察の順番が前後する可能性があります。ご了承ください。<br />
      <br />
      平日18時以降、土曜日12時以降、休日の受診の方は厚生労働省の定めた診療報酬点数の算定基準に基づき「夜間・早朝等加算」を適用となります。 <br />
      加算点数は50点となりますので、ご負担額は150円になります(3割負担の場合)。<br />
      <br />
      予約可能時間外はご予約をお取りできません。 <br />
      まれに予約システムの異常で予約可能時間外に予約が取れてしまう場合がありますが、上記の時間帯以外のご予約は無効となりますのでご注意ください。<br />
    </div>
  );
}
