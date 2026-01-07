// pages/done.js
import React, { useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/router";

export default function DonePage() {
  const router = useRouter();
  const { no, type } = router.query;

  // 直リンクで no が無い場合はトップへ
  useEffect(() => {
    if (!router.isReady) return;
    if (!no) {
      // replaceで履歴汚さない
      router.replace("/");
    }
  }, [router.isReady, no, router]);

  if (!no) return null;

  const label =
    type === "shoshin" ? "初診予約" :
    type === "saishin" ? "再診予約" :
    "予約";

  return (
    <div className="flex flex-col items-center justify-center p-4 w-full max-w-lg mx-auto">
      <img src="/logo.png" alt="けんおう皮フ科クリニック" className="w-40 h-40 mb-6" />
      <h2 className="text-3xl font-bold">けんおう皮フ科クリニック</h2>
      <h3 className="text-2xl font-semibold mb-6">{label}</h3>

      <div className="text-center">
        <p className="text-lg font-bold">予約が完了しました！</p>
        <p className="text-6xl font-extrabold text-green-500 my-4">{no}</p>

        <div className="w-full flex justify-center">
          <img src="/yoro.png" alt="チンおう" className="w-40 h-40 mb-6" />
        </div>

        <p className="text-2xl text-red-600 font-bold mt-4">
          ※受付番号を表示した画面をスクショして受付にお見せください。<br />
        </p>

        <Link
          href="/"
          className="mt-6 inline-block px-8 py-4 bg-blue-500 text-white text-2xl font-bold rounded-lg hover:bg-blue-700"
        >
          トップに戻る
        </Link>
      </div>
    </div>
  );
}
