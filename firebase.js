import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";

// ✅ ここに Firebase コンソールでコピーした `firebaseConfig` を貼り付ける！
const firebaseConfig = {
    apiKey: "AIzaSyAWzVE-1j_gXlWGw623o81D01ZJjP75L9I",
    authDomain: "kenohyoyaku.firebaseapp.com",
    projectId: "kenohyoyaku",
    storageBucket: "kenohyoyaku.firebasestorage.app",
    messagingSenderId: "607743779176",
    appId: "1:607743779176:web:9e43e2ccf38684604fb6dd"
  };
  
// Firebaseアプリを初期化
const app = initializeApp(firebaseConfig);

// Firestoreデータベースを取得
const db = getFirestore(app);

console.log("✅ Firebase に接続しました！", db);  // デバッグ用

export { db };
