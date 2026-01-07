/**
 * ① 必要パッケージのインストール
 *   npm install firebase-admin
 *
 * ② 管理画面用サービスアカウント JSON を用意して
 *    FIREBASE_SERVICE_ACCOUNT という環境変数にファイルパスを設定
 *
 * ③ 実行:
 *    node test-concurrent.js
 */
// test-concurrent.js の先頭
const admin = require("firebase-admin");
const { FieldValue } = admin.firestore;
const serviceAccount = require("./serviceAccountKey.json");  
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});
const db = admin.firestore();
// … 以下 reserveOnce() や main() の定義 …

async function reserveOnce() {
  const today = new Date().toISOString().slice(0,10);
  return db.runTransaction(async tx => {
    // (1) 当日カウンター
    const dailyRef = db.doc(`dailyCounters/${today}`);
    const dailySnap = await tx.get(dailyRef);
    const todayCount = dailySnap.exists ? dailySnap.data().count || 0 : 0;

    // (2) グローバルカウンター
    const counterRef = db.doc("counters/reservation");
    const counterSnap = await tx.get(counterRef);
    const lastGlobal = counterSnap.exists ? counterSnap.data().count || 0 : 0;

    // (3) 発番ロジック
    let candidate = lastGlobal + 1;
    if (candidate % 6 === 0) candidate++;

    // (4) 書き込み
    tx.set(dailyRef, { count: todayCount + 1 }, { merge: true });
    tx.update(counterRef, { count: candidate });

    tx.set(db.collection("reservations").doc(), {
      type: "テスト",
      name: "並列テスト",
      receptionNumber: candidate,
      date: today,
      status: "未受付",
      createdAt: FieldValue.serverTimestamp(),
    });

    return candidate;
  });
}

async function main() {
  // 並列で N 回トランザクションを実行
  const CONCURRENT = 10;
  const promises = Array.from({length: CONCURRENT}, () => reserveOnce());
  const results = await Promise.all(promises.map(p => p.catch(e => ({ error: e.message }))));
  console.log("取得結果:", results);

  // 番号の重複チェック
  const nums = results.filter(r => typeof r === "number");
  const dupes = nums.filter((v,i) => nums.indexOf(v) !== i);
  if (dupes.length) {
    console.warn("⚠️ 重複番号発生:", dupes);
  } else {
    console.log("✅ 重複なし");
  }
  process.exit(0);
}

main().catch(console.error);
