import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyCeVWtVzgQ02o7ueI9CbLpszz-MeV3bmww",
  authDomain: "controle-de-validade-4bd8a.firebaseapp.com",
  projectId: "controle-de-validade-4bd8a",
  storageBucket: "controle-de-validade-4bd8a.firebasestorage.app",
  messagingSenderId: "839219897741",
  appId: "1:839219897741:web:4f0c4e2fe231ba347609c4"
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
