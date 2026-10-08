import {
  initializeApp,
  getApps,
  getApp
} from "https://www.gstatic.com/firebasejs/13.0.0/firebase-app.js";

import {
  getFirestore,
  collection,
  getDocs,
  doc,
  getDoc,
  setDoc
} from "https://www.gstatic.com/firebasejs/13.0.0/firebase-firestore.js";

import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/13.0.0/firebase-auth.js";


const config =
  window.SEEDSTUDIO_CONFIG?.firebaseConfig;

if (!config) {
  throw new Error(
    "Firebase configuration is missing."
  );
}


const app =
  getApps().length
    ? getApp()
    : initializeApp(config);

const db =
  getFirestore(app);

const auth =
  getAuth(app);

const googleProvider =
  new GoogleAuthProvider();

googleProvider.setCustomParameters({
  prompt: "select_account"
});


async function getStaffProfile(user) {

  if (!user) {
    return null;
  }

  const ref =
    doc(
      db,
      "staff",
      user.uid
    );

  const snapshot =
    await getDoc(ref);

  if (!snapshot.exists()) {
    return null;
  }

  return {
    uid: user.uid,
    ...snapshot.data()
  };
}


async function buildAuthState(user) {

  if (!user) {

    return {
      signedIn: false,
      authorized: false,
      user: null,
      staff: null
    };
  }

  let staff = null;

  try {

    staff =
      await getStaffProfile(user);

  } catch (error) {

    console.error(
      "Failed to load staff profile.",
      error
    );
  }

  const authorized =
    !!staff &&
    staff.active === true &&
    ["admin", "support"]
      .includes(staff.role);

  return {
    signedIn: true,
    authorized,
    user: {
      uid: user.uid,
      email: user.email || "",
      displayName:
        user.displayName || "",
      photoURL:
        user.photoURL || ""
    },
    staff
  };
}


window.SeedStudioAuth = {

  async signIn() {

    const result =
      await signInWithPopup(
        auth,
        googleProvider
      );

    return buildAuthState(
      result.user
    );
  },


  async signOut() {

    await signOut(auth);
  },


  observe(callback) {

    return onAuthStateChanged(
      auth,
      async (user) => {

        const state =
          await buildAuthState(user);

        callback(state);
      }
    );
  },


  waitUntilReady() {

    return new Promise(
      (resolve) => {

        const unsubscribe =
          onAuthStateChanged(
            auth,
            async (user) => {

              unsubscribe();

              const state =
                await buildAuthState(user);

              resolve(state);
            }
          );
      }
    );
  },


  getCurrentUser() {

    return auth.currentUser;
  }
};


window.SeedStudioFirestore = {

  async listPostingRecords() {

    const snapshot =
      await getDocs(
        collection(
          db,
          "postingRecords"
        )
      );

    return snapshot.docs.map(
      (document) => ({
        id: document.id,
        ...document.data()
      })
    );
  },


  async savePostingRecord(record) {

    const user =
      auth.currentUser;

    if (!user) {

      throw new Error(
        "Authentication required."
      );
    }

    const payload = {
      ...record,

      createdByUid:
        user.uid,

      createdByEmail:
        user.email || ""
    };

    await setDoc(
      doc(
        db,
        "postingRecords",
        record.id
      ),
      payload
    );

    return payload;
  }
};
