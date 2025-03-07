import Link from "next/link";

export default function Home() {
  return (
    <div className="flex flex-col items-center justify-center min-h-screen p-4">
      <h1 className="text-3xl font-bold text-center mb-6">けんおう皮フ科クリニック 予約ページ</h1>
      <div className="flex flex-col gap-6 w-full max-w-md">
        <Link href="/shoshin">
          <a className="px-6 py-4 bg-blue-500 text-white text-center rounded-lg hover:bg-blue-700 text-lg">
            初診予約はこちら
          </a>
        </Link>
        <Link href="/saishin">
          <a className="px-6 py-4 bg-green-500 text-white text-center rounded-lg hover:bg-green-700 text-lg">
            再診予約はこちら
          </a>
        </Link>
      </div>
    </div>
  );
}
