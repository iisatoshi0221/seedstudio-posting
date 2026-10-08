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
  getAuth,
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
// SeedStudio Posting
// Firebase bridge
// ============================================================


// ============================================================
// Configuration
// ============================================================

const config =
  window.SEEDSTUDIO_CONFIG?.firebaseConfig;

if (!config) {
  throw new Error(
    "Firebase configuration is missing."
  );
}


// ============================================================
// Firebase app
// ============================================================

const app =
  getApps().length
    ? getApp()
    : initializeApp(config);


// ============================================================
// Authentication
//
// iPhone / Android / PC で安定させるため、
// 複数の persistence を明示する。
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
   * Firebase Auth がすでに初期化されている場合は
   * 既存インスタンスを利用する。
   */
  console.warn(
    "Firebase Auth already initialized.",
    error
  );

  auth =
    getAuth(app);
}


// ============================================================
// Firestore
// ============================================================

const db =
  getFirestore(app);


// ============================================================
// Google provider
// ============================================================

const googleProvider =
  new GoogleAuthProvider();

googleProvider.setCustomParameters({
  prompt: "select_account"
});


// ============================================================
// Coordinate conversion
//
// app.js:
// [
//   [lng, lat],
//   [lng, lat]
// ]
//
// Firestore:
// [
//   { lng, lat },
//   { lng, lat }
// ]
//
// Firestoreでは配列の中の配列を避け、
// オブジェクト形式にして保存する。
// ============================================================

function encodeCoordinates(
  coordinates
) {
  if (
    !Array.isArray(
      coordinates
    )
  ) {
    return [];
  }

  return coordinates
    .map(
      (point) => {

        /*
         * app.js形式
         * [lng, lat]
         */
        if (
          Array.isArray(point) &&
          point.length >= 2
        ) {
          const lng =
            Number(point[0]);

          const lat =
            Number(point[1]);

          if (
            Number.isFinite(lng) &&
            Number.isFinite(lat)
          ) {
            return {
              lng,
              lat
            };
          }
        }


        /*
         * すでにFirestore形式の場合
         * { lng, lat }
         */
        if (
          point &&
          typeof point ===
            "object" &&
          Number.isFinite(
            Number(point.lng)
          ) &&
          Number.isFinite(
            Number(point.lat)
          )
        ) {
          return {
            lng:
              Number(point.lng),

            lat:
              Number(point.lat)
          };
        }


        return null;
      }
    )
    .filter(Boolean);
}


function decodeCoordinates(
  coordinates
) {
  if (
    !Array.isArray(
      coordinates
    )
  ) {
    return [];
  }

  return coordinates
    .map(
      (point) => {

        /*
         * 旧形式にも対応
         * [lng, lat]
         */
        if (
          Array.isArray(point) &&
          point.length >= 2
        ) {
          const lng =
            Number(point[0]);

          const lat =
            Number(point[1]);

          if (
            Number.isFinite(lng) &&
            Number.isFinite(lat)
          ) {
            return [
              lng,
              lat
            ];
          }
        }


        /*
         * Firestore保存形式
         * { lng, lat }
         */
        if (
          point &&
          typeof point ===
            "object" &&
          Number.isFinite(
            Number(point.lng)
          ) &&
          Number.isFinite(
            Number(point.lat)
          )
        ) {
          return [
            Number(point.lng),
            Number(point.lat)
          ];
        }


        return null;
      }
    )
    .filter(Boolean);
}


// ============================================================
// Posting record conversion
// ============================================================

function encodePostingRecord(
  record
) {
  if (!record) {
    return record;
  }

  const area =
    record.area &&
    record.area.type ===
      "Polygon"
      ? {
          type:
            "Polygon",

          coordinates:
            encodeCoordinates(
              record.area
                .coordinates
            )
        }
      : record.area;

  return {
    ...record,
    area
  };
}


function decodePostingRecord(
  record
) {
  if (!record) {
    return record;
  }

  const area =
    record.area &&
    record.area.type ===
      "Polygon"
      ? {
          type:
            "Polygon",

          coordinates:
            decodeCoordinates(
              record.area
                .coordinates
            )
        }
      : record.area;

  return {
    ...record,
    area
  };
}


// ============================================================
// Staff profile
// ============================================================

async function getStaffProfile(
  user
) {
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
    await getDoc(
      reference
    );

  if (
    !snapshot.exists()
  ) {
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

async function buildAuthState(
  user
) {
  if (!user) {
    return {
      signedIn: false,
      authorized: false,
      user: null,
      staff: null
    };
  }

  let staff =
    null;

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
    signedIn:
      true,

    authorized,

    user: {
      uid:
        user.uid,

      email:
        user.email ||
        "",

      displayName:
        user.displayName ||
        "",

      photoURL:
        user.photoURL ||
        ""
    },

    staff
  };
}


// ============================================================
// Google sign-in
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
      "Google sign-in failed.",
      error
    );

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
// Public authentication bridge
// ============================================================

window.SeedStudioAuth = {

  async signIn() {
    return await signInGoogle();
  },


  async signOut() {
    await signOut(
      auth
    );
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

          callback(
            state
          );

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
                const state =
                  await buildAuthState(
                    user
                  );

                resolve(
                  state
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

  // ------------------------------------------------------------
  // Load all posting records
  // ------------------------------------------------------------

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
      (documentSnapshot) => {

        const rawRecord = {
          id:
            documentSnapshot.id,

          ...documentSnapshot.data()
        };

        /*
         * Firestore形式
         * {lng,lat}
         *
         * ↓
         *
         * app.js形式
         * [lng,lat]
         */
        return decodePostingRecord(
          rawRecord
        );
      }
    );
  },


  // ------------------------------------------------------------
  // Save posting record
  // ------------------------------------------------------------

  async savePostingRecord(
    record
  ) {
    const user =
      auth.currentUser;

    if (!user) {
      throw new Error(
        "Authentication required."
      );
    }


    if (
      !record?.id
    ) {
      throw new Error(
        "Posting record ID is missing."
      );
    }


    /*
     * app.js形式
     * [lng,lat]
     *
     * ↓
     *
     * Firestore形式
     * {lng,lat}
     */
    const encodedRecord =
      encodePostingRecord(
        record
      );


    const payload = {
      ...encodedRecord,

      createdByUid:
        user.uid,

      createdByEmail:
        user.email ||
        ""
    };


    console.log(
      "Saving Posting record to Firestore.",
      payload
    );


    await setDoc(
      doc(
        db,
        "postingRecords",
        record.id
      ),
      payload
    );


    /*
     * app.jsへ返すときは
     * 再び [lng,lat] 形式へ戻す。
     */
    return decodePostingRecord(
      payload
    );
  }
};


// ============================================================
// Debug
// ============================================================

console.log(
  "SeedStudio Firebase bridge ready.",
  {
    projectId:
      config.projectId,

    signedIn:
      !!auth.currentUser,

    coordinateFormat:
      "Firestore:{lng,lat} / App:[lng,lat]"
  }
);
