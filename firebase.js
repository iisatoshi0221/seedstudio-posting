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
  initializeAuth,
  indexedDBLocalPersistence,
  browserLocalPersistence,
  browserSessionPersistence,
  browserPopupRedirectResolver,
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/13.0.0/firebase-auth.js";


// ============================================================
// Firebase configuration
// ============================================================

const config =
  window.SEEDSTUDIO_CONFIG?.firebaseConfig;

if (!config) {
  throw new Error(
    "Firebase configuration is missing."
  );
}


// ============================================================
// Firebase initialization
// ============================================================

const app =
  getApps().length
    ? getApp()
    : initializeApp(config);


// ============================================================
// Authentication
//
// Explicit persistence order:
// 1. IndexedDB
// 2. localStorage
// 3. sessionStorage
//
// This gives iPhone / Android / PC several storage fallbacks.
// ============================================================

let auth;

try {
  auth = initializeAuth(
    app,
    {
      persistence: [
        indexedDBLocalPersistence,
        browserLocalPersistence,
        browserSessionPersistence
      ],

      popupRedirectResolver:
        browserPopupRedirectResolver
    }
  );

} catch (error) {
  /*
   * initializeAuth throws if Auth was already initialized.
   * This normally does not happen in Posting,
   * but retaining the existing instance is safer.
   */

  const module =
    await import(
      "https://www.gstatic.com/firebasejs/13.0.0/firebase-auth.js"
    );

  auth =
    module.getAuth(app);
}


const db =
  getFirestore(app);


const googleProvider =
  new GoogleAuthProvider();

googleProvider.setCustomParameters({
  prompt: "select_account"
});


// ============================================================
// Staff profile
// ============================================================

async function getStaffProfile(user) {
  if (!user) {
    return null;
  }

  const reference =
    doc(
      db,
      "staff",
      user.uid
    );

  const snapshot =
    await getDoc(reference);

  if (!snapshot.exists()) {
    return null;
  }

  return {
    uid:
      user.uid,

    ...snapshot.data()
  };
}


// ============================================================
// Auth state
// ============================================================

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
      await getStaffProfile(
        user
      );

  } catch (error) {
    console.error(
      "Failed to load staff profile.",
      error
    );
  }

  const authorized =
    !!staff &&
    staff.active === true &&
    [
      "admin",
      "support"
    ].includes(
      staff.role
    );

  return {
    signedIn: true,

    authorized,

    user: {
      uid:
        user.uid,

      email:
        user.email || "",

      displayName:
        user.displayName || "",

      photoURL:
        user.photoURL || ""
    },

    staff
  };
}


// ============================================================
// Popup sign-in
// ============================================================

async function signInGoogle() {
  try {
    const result =
      await signInWithPopup(
        auth,
        googleProvider
      );

    return await buildAuthState(
      result.user
    );

  } catch (error) {
    console.error(
      "Google popup sign-in failed.",
      error
    );

    /*
     * Common mobile cases:
     * - popup blocked
     * - popup closed
     * - Safari opens auth in another browser context
     *
     * Do NOT automatically switch to signInWithRedirect here.
     * Redirect auth on GitHub Pages can fail under Safari's
     * third-party storage restrictions.
     */

    if (
      error?.code ===
      "auth/popup-blocked"
    ) {
      throw new Error(
        "POPUP_BLOCKED"
      );
    }

    if (
      error?.code ===
      "auth/popup-closed-by-user"
    ) {
      throw new Error(
        "POPUP_CLOSED"
      );
    }

    throw error;
  }
}


// ============================================================
// Public Auth bridge
// ============================================================

window.SeedStudioAuth = {

  async signIn() {
    return await signInGoogle();
  },


  async signOut() {
    await signOut(auth);
  },


  observe(callback) {
    return onAuthStateChanged(
      auth,
      async (user) => {
        try {
          const state =
            await buildAuthState(
              user
            );

          callback(state);

        } catch (error) {
          console.error(
            "Auth observer failed.",
            error
          );

          callback({
            signedIn: false,
            authorized: false,
            user: null,
            staff: null
          });
        }
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

              try {
                resolve(
                  await buildAuthState(
                    user
                  )
                );

              } catch (error) {
                console.error(
                  "Initial auth state failed.",
                  error
                );

                resolve({
                  signedIn: false,
                  authorized: false,
                  user: null,
                  staff: null
                });
              }
            }
          );
      }
    );
  },


  getCurrentUser() {
    return auth.currentUser;
  }
};


// ============================================================
// Firestore bridge
// ============================================================

window.SeedStudioFirestore = {

  async listPostingRecords() {
    const user =
      auth.currentUser;

    if (!user) {
      throw new Error(
        "Authentication required."
      );
    }

    const snapshot =
      await getDocs(
        collection(
          db,
          "postingRecords"
        )
      );

    return snapshot.docs.map(
      (documentSnapshot) => ({
        id:
          documentSnapshot.id,

        ...documentSnapshot.data()
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


// ============================================================
// Debug information
// ============================================================

console.log(
  "SeedStudio Firebase bridge ready.",
  {
    signedIn:
      !!auth.currentUser,

    projectId:
      config.projectId
  }
);
