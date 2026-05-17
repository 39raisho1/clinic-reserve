import React, { useState, useEffect, useMemo } from "react";
import Link from "next/link";
import { db } from "../firebaseConfig";
import {
  doc,
  onSnapshot,
  collection,
  query,
  where,
  getDocs,
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

  // 当日合算カウント（reservations実体から算出）
  const [countToday, setCountToday] = useState(0);

  // 呼び出し中表示用（←元コードで未定義だった）
  const [callingPatients, setCallingPatients] = useState([]);
  const [loading, setLoading] = useState(true);

  // 設定を購読
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

  // 強制オープン期限の監視
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

  // 当日の予約数集計（キャンセル除外）
  useEffect(() => {
    const todayISO = isoDateKey(nowJST());
    const qRef = query(
      collection(db, "reservations"),
      where("dateKeyISO", "==", todayISO)
    );

    return onSnapshot(qRef, (snap) => {
      const n = snap.docs.filter(
        (d) => (d.data()?.status || "").trim() !== "キャンセル済"
      ).length;
      setCountToday(n);
    });
  }, []);

  // 呼び出し中患者の取得
  const fetchCallingPatients = async () => {
    const callQuery = query(
      collection(db, "reservations"),
      where("status", "==", "呼び出し中")
    );

    try {
      const snapshot = await getDocs(callQuery);

      const callList = snapshot.docs.map((d) => ({
        id: d.id,
        receptionNumber: d.data().receptionNumber ?? "未設定",
      }));

      // receptionNumber 昇順
      callList.sort(
        (a, b) => Number(a.receptionNumber) - Number(b.receptionNumber)
      );

      setCallingPatients(callList);
    } catch (error) {
      console.error("Firestore からのデータ取得に失敗:", error);
      setCallingPatients([]);
    } finally {
      setLoading(false);
    }
  };

  // 初回 + 定期更新
  useEffect(() => {
    fetchCallingPatients();
    const id = setInterval(fetchCallingPatients, 10000);
    return () => clearInterval(id);
  }, []);

  // 受付可否
  const limitReached = useMemo(() => {
    return Number(maxPerDay || 0) > 0 && countToday >= Number(maxPerDay || 0);
  }, [maxPerDay, countToday]);

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

      <div className="w-full max-w-md mt-4 mb-2 bg-red-50 border-2 border-red-500 rounded-xl p-4 text-center">
        <p className="text-xl text-red-600 font-bold">6月13日(土)は学会参加のため休診します。</p>
        <p className="text-xl text-red-600 font-bold mt-2">6月27日(土)は学会参加のため15時までの受付となります。</p>
      </div>

<p className="text-3xl text-red-600 font-bold mt-6 text-center">女性医師による診察が始まりました。</p>
<p className="text-xl text-red-600 font-bold mt-6 text-center">4月より医師が増え、原則2診体制(月木金は女性医師)になりました。</p>
<p className="text-xl text-red-600 font-bold mt-6 text-center">それに伴い土曜日でも14:30～18:00まで午後のweb予約を受け付ける体制に戻しました。</p>
<p className="text-xl text-red-600 font-bold mt-6 text-center">土曜午前に予約が取れなかった方はぜひ午後にご予約ください。</p>
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

      {settingsLoaded && !forceOpenActive && isClosed && (
        <p className="text-xl text-red-600 font-bold mt-6 text-center">
          ⛔現在、予約受付を停止しています。<br />
          予約の上限に達しているか、受付時間外である可能性があります。<br /><br />
          午前は8:30、午後は14:30から受付開始となります(土曜日も)<br /><br />
          <br />
        </p>
      )}

      <p className="text-l text-blue-600 font-bold mt-4">5月の日曜診療は10日と24日の午前中となります。</p>
      <p className="text-l text-blue-600 font-bold mt-4">6月の日曜診療は7日と21日の午前中となります。</p>
      <p className="text-l text-blue-600 font-bold mt-4">7月の日曜診療は7日と21日の午前中となります。</p>
      <PendingList />
      <br />

      <div className="text-center text-lg font-semibold mt-4">
        <p className="text-gray-700 text-2xl">診察室にご案内中の方</p>

        {loading ? (
          <p className="text-gray-500 mt-4 text-xl">データを取得中...</p>
        ) : callingPatients.length > 0 ? (
          <div className="bg-gradient-to-r from-blue-600 to-blue-400 p-6 rounded-2xl shadow-xl text-white text-2xl font-bold mt-4 w-full max-w-lg">
            <div className="grid grid-cols-2 md:grid-cols-3 gap-6 justify-center">
              {callingPatients.map((patient) => (
                <div
                  key={patient.id}
                  className="bg-white text-blue-600 px-8 py-4 rounded-xl shadow-lg text-6xl font-bold flex items-center justify-center"
                >
                  {patient.receptionNumber}
                </div>
              ))}
            </div>
          </div>
        ) : (
          <p className="text-blue-500 mt-4 text-2xl"></p>
        )}
      </div>

      <CrowdStatus />
      <br />



      <br />
      <img src="/chin.png" alt="チンおう" className="w-40 h-40 mb-6" />
      <p className="text-3xl text-red-600 font-bold mt-6 text-center">～お知らせ～</p>

      <p className="text-xl text-red-600 font-bold mt-6 text-center">当院は火・水はお休みをいただいています。</p>
      <p className="text-xl text-red-600 font-bold mt-6 text-center">4月より、2診体制での診療を開始しております。</p>
      <p className="text-xl text-red-600 font-bold mt-6 text-center">これに伴い、これまで土曜日に実施していた午前・午後の通し診療を、従来どおり午前・午後の診療体制へ変更いたします。</p>
      <p className="text-xl text-red-600 font-bold mt-6 text-center">今後もお待たせしないよう、より受診しやすい診療体制づくりに努めてまいります。</p>
      <p className="text-xl text-red-600 font-bold mt-6 text-center"></p>
      <p className="text-xl text-red-600 font-bold mt-6 text-center">花粉症の時期は、鼻や目だけでなく、皮膚症状が悪化する方も少なくありません。</p>
      <p className="text-xl text-red-600 font-bold mt-6 text-center">顔の赤み、かゆみ、湿疹などが気になる方は、お気軽にご受診ください。</p>
      <p className="text-xl text-red-600 font-bold mt-6 text-center">症状を長引かせないためにも、早めの対応がおすすめです。</p>
      <p className="text-xl text-red-600 font-bold mt-6 text-center"></p>

      <br />
      <br />
      <p className="text-3xl text-black font-bold mt-4">予約受付時間</p>
      <br />
      <p className="text-3xl text-black font-bold mt-4">月、木、金、土、日(不定期)</p>
      <p className="text-3xl text-black font-bold mt-4">午前 8時30分～12時30分</p>
      <p className="text-3xl text-black font-bold mt-4">午後 14時30分～18時00分</p>
      <p className="text-3xl text-black font-bold mt-4"></p>

      <p className="text-xl text-red-600 font-bold mt-6 text-center">
        ※土曜日の診察も平日と同様午前と午後の診療になります。<br />
        （土曜の受付も平日と同じく18:00まで）
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
      平日18時以降、土曜日12時以降、休日の受診の方は厚生労働省の定めた診療報酬点数の算定基準に基づき「夜間・早朝等加算」を適用となります。<br />
      加算点数は50点となりますので、ご負担額は150円になります(3割負担の場合)。<br />
      <br />
      予約可能時間外はご予約をお取りできません。<br />
      まれに予約システムの異常で予約可能時間外に予約が取れてしまう場合がありますが、上記の時間帯以外のご予約は無効となりますのでご注意ください。<br />
    </div>
  );
}