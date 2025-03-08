import Link from "next/link";

export default function Home() {
  return (
    <div className="flex flex-col items-center justify-center min-h-screen p-4">
      {/* 🔹 クリニックのロゴを追加 */}
      <img src="/logo.png" alt="けんおう皮フ科クリニック" className="w-40 h-40 mb-6" />

      <h1 className="text-4xl font-bold text-center mb-8">けんおう皮フ科クリニック 予約ページ</h1>

      <div className="flex flex-col gap-8 w-full max-w-md">
        {/* 🔹 予約ボタンを大きくする */}
        <Link href="/shoshin">
          <div className="px-8 py-6 bg-blue-500 text-white text-center text-2xl font-bold rounded-lg hover:bg-blue-700 shadow-lg cursor-pointer">
            初診予約はこちら
          </div>
        </Link>
        <Link href="/saishin">
          <div className="px-8 py-6 bg-green-500 text-white text-center text-2xl font-bold rounded-lg hover:bg-green-700 shadow-lg cursor-pointer">
            再診予約はこちら
          </div>
        </Link>
        {/* 🔹 予約確認 & キャンセルへのボタン追加 */}
        <Link href="/confirm">
          <div className="px-8 py-6 bg-red-500 text-white text-center text-2xl font-bold rounded-lg hover:bg-red-700 shadow-lg cursor-pointer">
            予約の確認・キャンセル
          </div>
        </Link>
      </div>
    </div>
  );
}
