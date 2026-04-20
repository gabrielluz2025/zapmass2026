import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getAnalytics } from "firebase/analytics";

const firebaseConfig = {
  apiKey: "AIzaSyDXmAZ-VW7Ti1_L5GPW0gNBkfGxMmxvypQ",
  authDomain: "controle-de-igrejas.firebaseapp.com",
  projectId: "controle-de-igrejas",
  storageBucket: "controle-de-igrejas.firebasestorage.app",
  messagingSenderId: "457376397325",
  appId: "1:457376397325:web:aacc6cef3e91390314fd44",
  measurementId: "G-PENC7PPT4M"
};

const app = initializeApp(firebaseConfig);
export const analytics = getAnalytics(app);
export const db = getFirestore(app);