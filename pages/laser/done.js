import React from "react";
import Link from "next/link";
import { useRouter } from "next/router";

export default function LaserDonePage() {
  const router = useRouter();
  const { date, time, endTime, name, typeName, token } = router.query;

  if (!router.isReady) return null;

  if (!date || !time || !token) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen p-4">
        <p className="text-gray-500 mb-4">このページは直接アクセスできません。</p>
        <Link href="/laser" className="text-blue-500 underline text-lg">レーザー予約トップへ</Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center min-h-screen p-4">
      <img src="/logo.png" alt="けんおう皮フ科クリニック" className="w-32 h-32 mb-4" />
      <h1 className="text-3xl font-bold mb-2">予約完了</h1>

      <div className="w-full max-w-md bg-green-50 border-2 border-green-500 rounded-xl p-6 text-center mb-6">
        <p className="text-2xl font-bold text-green-700 mb-3">予約が確定しました！</p>
        {typeName && <p className="text-xl font-bold mb-1">{typeName}</p>}
        {name && <p className="text-xl mb-1">{name} 様</p>}
        <p className="text-xl font-bold">
          {date}　{time} 〜 {endTime}
        </p>
      </div>

      <div className="w-full max-w-md bg-yellow-50 border-2 border-yellow-400 rounded-xl p-5 text-center mb-8">
        <p className="text-lg font-bold text-yellow-800 mb-3">
          ⚠️ キャンセルコード（必ず控えてください）
        </p>
        <p className="text-5xl font-extrabold text-yellow-700 tracking-widest mb-3">{token}</p>
        <p className="text-sm text-gray-600">
          キャンセル時にこのコードが必要です。<br />
          スクリーンショットを保存してください。
        </p>
      </div>

      <Link
        href="/"
        className="px-8 py-4 bg-blue-500 text-white text-2xl font-bold rounded-lg hover:bg-blue-700"
      >
        トップに戻る
      </Link>
    </div>
  );
}
