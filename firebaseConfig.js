import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
    apiKey: "AIzaSyAWzVE-1j_gXlWGw623o81D01ZJjP75L9I",
    authDomain: "kenohyoyaku.firebaseapp.com",
    projectId: "kenohyoyaku",
    storageBucket: "kenohyoyaku.firebasestorage.app",
    messagingSenderId: "607743779176",
    appId: "1:607743779176:web:9e43e2ccf38684604fb6dd"
};

// Firebase を初期化
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

export { db };
