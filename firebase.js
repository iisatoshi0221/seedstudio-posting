import { initializeApp, getApps, getApp } from "https://www.gstatic.com/firebasejs/13.0.0/firebase-app.js";
import {
  getFirestore,
  collection,
  getDocs,
  doc,
  setDoc
} from "https://www.gstatic.com/firebasejs/13.0.0/firebase-firestore.js";

const config = window.SEEDSTUDIO_CONFIG?.firebaseConfig;

if (!config) {
  throw new Error("Firebase configuration is missing.");
}

const app = getApps().length ? getApp() : initializeApp(config);
const db = getFirestore(app);

window.SeedStudioFirestore = {
  async listPostingRecords() {
    const snapshot = await getDocs(collection(db, "postingRecords"));
    return snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
  },

  async savePostingRecord(record) {
    await setDoc(doc(db, "postingRecords", record.id), record);
    return record;
  }
};
