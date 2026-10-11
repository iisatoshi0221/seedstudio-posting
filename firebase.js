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
  setDoc,
  runTransaction,
  serverTimestamp
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
//
// Phase 4
// Posting participant + master management
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
// Date helpers
// ============================================================

function todayIso() {
  const now =
    new Date();

  const local =
    new Date(
      now.getTime() -
      now.getTimezoneOffset() *
        60000
    );

  return local
    .toISOString()
    .slice(
      0,
      10
    );
}


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
// Posting Records v2 helpers
//
// SP-Next-2C-2
// Transaction + immutable changeLog foundation.
//
// IMPORTANT:
// savePostingRecord() remains the production v0.1 create path.
// These v2 APIs are introduced dormant until the matching
// Firestore Rules are deployed.
// ============================================================

function postingRecordStatus(
  record
) {
  return record?.status ===
    "deleted"
    ? "deleted"
    : "active";
}


function postingRecordVersion(
  record
) {
  const value =
    Number(
      record?.version
    );

  return Number.isInteger(
      value
    ) &&
    value >= 1
      ? value
      : 1;
}


function postingOperationId() {
  const random =
    globalThis.crypto
      ?.randomUUID
      ?.();

  return random
    ? `posting-${random}`
    : `posting-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2, 12)}`;
}


function postingAuditSnapshot(
  record
) {
  return {
    postingDate:
      record?.postingDate ||
      "",

    staffId:
      record?.staffId ||
      "",

    flyerId:
      record?.flyerId ||
      "",

    quantity:
      Number(
        record?.quantity ||
        0
      ),

    participants:
      Array.isArray(
        record?.participants
      )
        ? record.participants
        : [],

    area:
      record?.area || {}
  };
}


function postingV2BasePayload(
  record
) {
  return {
    ...record,

    status:
      postingRecordStatus(
        record
      ),

    version:
      postingRecordVersion(
        record
      ),

    operationId:
      typeof record?.operationId ===
        "string"
        ? record.operationId
        : "",

    updatedAt:
      record?.updatedAt ||
      null,

    updatedByUid:
      record?.updatedByUid ||
      null,

    deletedAt:
      record?.deletedAt ||
      null,

    deletedByUid:
      record?.deletedByUid ||
      null,

    deleteReason:
      record?.deleteReason ||
      "",

    deleteComment:
      record?.deleteComment ||
      ""
  };
}


function assertPostingExpectedVersion(
  current,
  expectedVersion
) {
  const currentVersion =
    postingRecordVersion(
      current
    );

  if (
    Number(expectedVersion) !==
    currentVersion
  ) {
    const error =
      new Error(
        "POSTING_VERSION_CONFLICT"
      );

    error.code =
      "POSTING_VERSION_CONFLICT";

    error.currentVersion =
      currentVersion;

    throw error;
  }

  return currentVersion;
}


async function getPostingActor() {
  const user =
    auth.currentUser;

  if (!user) {
    throw new Error(
      "Authentication required."
    );
  }

  const staff =
    await getStaffProfile(
      user
    );

  if (
    !staff ||
    staff.active !== true ||
    ![
      "admin",
      "support"
    ].includes(
      staff.role
    )
  ) {
    throw new Error(
      "Posting permission required."
    );
  }

  return {
    user,
    staff
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
// User master helpers
//
// SSS共通 users コレクションを正本とする。
// Posting側に氏名をコピーしない。
// ============================================================

function userMasterIsCurrentlyActive(
  data
) {
  if (
    !data ||
    data.active !== true
  ) {
    return false;
  }

  const today =
    todayIso();

  /*
   * startDate がある場合は
   * 利用開始日以降のみ対象。
   */
  if (
    typeof data.startDate ===
      "string" &&
    data.startDate &&
    data.startDate >
      today
  ) {
    return false;
  }

  /*
   * endDate がある場合は
   * 終了日を過ぎたら対象外。
   */
  if (
    typeof data.endDate ===
      "string" &&
    data.endDate &&
    data.endDate <
      today
  ) {
    return false;
  }

  return true;
}


function normalizeActiveUser(
  documentSnapshot
) {
  const data =
    documentSnapshot.data();

  const personId =
    data.userId ||
    documentSnapshot.id;

  return {
    personId,

    userId:
      data.userId ||
      documentSnapshot.id,

    name:
      data.name ||
      personId,

    phase:
      "ACTIVE",

    phaseLabel:
      "利用中",

    source:
      "users",

    active:
      data.active === true,

    startDate:
      data.startDate ||
      null,

    endDate:
      data.endDate ??
      null
  };
}


// ============================================================
// User directory helper
//
// 履歴の氏名解決用。
// active / startDate / endDate に関係なく users 全件を読む。
// ============================================================

function normalizeUserDirectoryItem(
  documentSnapshot
) {
  const data =
    documentSnapshot.data();

  const personId =
    data.userId ||
    documentSnapshot.id;

  return {
    personId,

    userId:
      data.userId ||
      documentSnapshot.id,

    name:
      data.name ||
      personId,

    active:
      data.active === true,

    startDate:
      data.startDate ||
      null,

    endDate:
      data.endDate ??
      null
  };
}


// ============================================================
// Posting participant helpers
// ============================================================

function normalizePostingParticipant(
  documentSnapshot
) {
  const data =
    documentSnapshot.data();

  return {
    personId:
      data.personId ||
      documentSnapshot.id,

    enabled:
      data.enabled === true,

    addedAt:
      data.addedAt ||
      null,

    addedByUid:
      data.addedByUid ||
      null,

    updatedAt:
      data.updatedAt ||
      null,

    updatedByUid:
      data.updatedByUid ||
      null
  };
}


// ============================================================
// Phase 4
// Posting master normalization
// ============================================================

function normalizePostingStaff(
  documentSnapshot
) {
  const data =
    documentSnapshot.data();

  return {
    staffId:
      data.staffId ||
      documentSnapshot.id,

    name:
      data.name ||
      "",

    active:
      data.active === true,

    displayOrder:
      Number.isFinite(
        Number(
          data.displayOrder
        )
      )
        ? Number(
            data.displayOrder
          )
        : 9999,

    createdAt:
      data.createdAt ||
      null,

    createdByUid:
      data.createdByUid ||
      null,

    updatedAt:
      data.updatedAt ||
      null,

    updatedByUid:
      data.updatedByUid ||
      null
  };
}


function normalizePostingFlyer(
  documentSnapshot
) {
  const data =
    documentSnapshot.data();

  return {
    flyerId:
      data.flyerId ||
      documentSnapshot.id,

    name:
      data.name ||
      "",

    active:
      data.active === true,

    displayOrder:
      Number.isFinite(
        Number(
          data.displayOrder
        )
      )
        ? Number(
            data.displayOrder
          )
        : 9999,

    createdAt:
      data.createdAt ||
      null,

    createdByUid:
      data.createdByUid ||
      null,

    updatedAt:
      data.updatedAt ||
      null,

    updatedByUid:
      data.updatedByUid ||
      null
  };
}


// ============================================================
// Firestore bridge
// ============================================================

window.SeedStudioFirestore = {

  // ==========================================================
  // Phase 4
  // Posting staff / flyer masters
  // ==========================================================

  async listPostingStaff() {
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
          "postingStaff"
        )
      );

    return snapshot.docs
      .map(
        normalizePostingStaff
      )
      .sort(
        (
          a,
          b
        ) => {
          const orderDiff =
            a.displayOrder -
            b.displayOrder;

          if (
            orderDiff !== 0
          ) {
            return orderDiff;
          }

          return String(
            a.name
          ).localeCompare(
            String(
              b.name
            ),
            "ja"
          );
        }
      );
  },


  async listPostingFlyers() {
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
          "postingFlyers"
        )
      );

    return snapshot.docs
      .map(
        normalizePostingFlyer
      )
      .sort(
        (
          a,
          b
        ) => {
          const orderDiff =
            a.displayOrder -
            b.displayOrder;

          if (
            orderDiff !== 0
          ) {
            return orderDiff;
          }

          return String(
            a.name
          ).localeCompare(
            String(
              b.name
            ),
            "ja"
          );
        }
      );
  },


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


    return decodePostingRecord(
      payload
    );
  },


  // ------------------------------------------------------------
  // Posting Records v2 - transactional update
  //
  // Online only. The caller must pass the version that was read
  // when the edit screen was opened. Legacy records are treated
  // as version 1 / status active.
  // ------------------------------------------------------------

  async updatePostingRecord(
    postingId,
    expectedVersion,
    changes,
    reason = ""
  ) {
    const {
      user
    } =
      await getPostingActor();


    if (
      typeof postingId !==
        "string" ||
      !postingId.trim()
    ) {
      throw new Error(
        "postingId is required."
      );
    }


    const editableKeys =
      new Set([
        "postingDate",
        "staffId",
        "flyerId",
        "quantity",
        "participants",
        "area"
      ]);


    const suppliedChanges =
      changes &&
      typeof changes ===
        "object"
        ? changes
        : {};


    Object.keys(
      suppliedChanges
    ).forEach(
      (key) => {
        if (
          !editableKeys.has(
            key
          )
        ) {
          throw new Error(
            `Unsupported Posting edit field: ${key}`
          );
        }
      }
    );


    const reference =
      doc(
        db,
        "postingRecords",
        postingId.trim()
      );


    const operationId =
      postingOperationId();


    await runTransaction(
      db,

      async (
        transaction
      ) => {
        const snapshot =
          await transaction.get(
            reference
          );


        if (
          !snapshot.exists()
        ) {
          throw new Error(
            "POSTING_NOT_FOUND"
          );
        }


        const current =
          snapshot.data();


        if (
          postingRecordStatus(
            current
          ) !== "active"
        ) {
          throw new Error(
            "POSTING_NOT_ACTIVE"
          );
        }


        const currentVersion =
          assertPostingExpectedVersion(
            current,
            expectedVersion
          );


        const encodedChanges =
          encodePostingRecord(
            suppliedChanges
          );


        const currentV2 =
          postingV2BasePayload(
            current
          );


        const next = {
          ...currentV2,
          ...encodedChanges,

          id:
            current.id ||
            postingId.trim(),

          createdAt:
            current.createdAt,

          createdByUid:
            current.createdByUid,

          createdByEmail:
            current.createdByEmail ||
            "",

          status:
            "active",

          version:
            currentVersion + 1,

          operationId,

          updatedAt:
            serverTimestamp(),

          updatedByUid:
            user.uid,

          deletedAt:
            null,

          deletedByUid:
            null,

          deleteReason:
            "",

          deleteComment:
            ""
        };


        const changeLogReference =
          doc(
            db,
            "postingRecords",
            postingId.trim(),
            "changeLogs",
            operationId
          );


        const log = {
          action:
            "update",

          versionBefore:
            currentVersion,

          versionAfter:
            currentVersion + 1,

          before:
            postingAuditSnapshot(
              currentV2
            ),

          after:
            postingAuditSnapshot(
              next
            ),

          reason:
            String(
              reason ||
              ""
            ).trim(),

          actorUid:
            user.uid,

          actorEmail:
            user.email ||
            "",

          operationId,

          changedAt:
            serverTimestamp()
        };


        transaction.set(
          reference,
          next
        );


        transaction.set(
          changeLogReference,
          log
        );
      }
    );


    const saved =
      await getDoc(
        reference
      );


    return decodePostingRecord({
      id:
        saved.id,

      ...saved.data()
    });
  },


  // ------------------------------------------------------------
  // Posting Records v2 - logical delete
  //
  // Admin only. Physical deletion remains prohibited.
  // ------------------------------------------------------------

  async softDeletePostingRecord(
    postingId,
    expectedVersion,
    deleteReason,
    deleteComment = ""
  ) {
    const {
      user,
      staff
    } =
      await getPostingActor();


    if (
      staff.role !==
      "admin"
    ) {
      throw new Error(
        "POSTING_ADMIN_REQUIRED"
      );
    }


    const normalizedReason =
      String(
        deleteReason ||
        ""
      ).trim();


    if (
      !normalizedReason
    ) {
      throw new Error(
        "DELETE_REASON_REQUIRED"
      );
    }


    const reference =
      doc(
        db,
        "postingRecords",
        postingId
      );


    const operationId =
      postingOperationId();


    await runTransaction(
      db,

      async (
        transaction
      ) => {
        const snapshot =
          await transaction.get(
            reference
          );


        if (
          !snapshot.exists()
        ) {
          throw new Error(
            "POSTING_NOT_FOUND"
          );
        }


        const current =
          snapshot.data();


        if (
          postingRecordStatus(
            current
          ) !== "active"
        ) {
          throw new Error(
            "POSTING_NOT_ACTIVE"
          );
        }


        const currentVersion =
          assertPostingExpectedVersion(
            current,
            expectedVersion
          );


        const currentV2 =
          postingV2BasePayload(
            current
          );


        const next = {
          ...currentV2,

          id:
            current.id ||
            postingId,

          createdAt:
            current.createdAt,

          createdByUid:
            current.createdByUid,

          createdByEmail:
            current.createdByEmail ||
            "",

          status:
            "deleted",

          version:
            currentVersion + 1,

          operationId,

          updatedAt:
            serverTimestamp(),

          updatedByUid:
            user.uid,

          deletedAt:
            serverTimestamp(),

          deletedByUid:
            user.uid,

          deleteReason:
            normalizedReason,

          deleteComment:
            String(
              deleteComment ||
              ""
            ).trim()
        };


        const changeLogReference =
          doc(
            db,
            "postingRecords",
            postingId,
            "changeLogs",
            operationId
          );


        const log = {
          action:
            "delete",

          versionBefore:
            currentVersion,

          versionAfter:
            currentVersion + 1,

          before:
            postingAuditSnapshot(
              currentV2
            ),

          after:
            postingAuditSnapshot(
              next
            ),

          reason:
            normalizedReason,

          comment:
            String(
              deleteComment ||
              ""
            ).trim(),

          actorUid:
            user.uid,

          actorEmail:
            user.email ||
            "",

          operationId,

          changedAt:
            serverTimestamp()
        };


        transaction.set(
          reference,
          next
        );


        transaction.set(
          changeLogReference,
          log
        );
      }
    );


    const saved =
      await getDoc(
        reference
      );


    return decodePostingRecord({
      id:
        saved.id,

      ...saved.data()
    });
  },


  // ------------------------------------------------------------
  // Posting Records v2 - change log reader
  // ------------------------------------------------------------

  async listPostingRecordChangeLogs(
    postingId
  ) {
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
          "postingRecords",
          postingId,
          "changeLogs"
        )
      );


    return snapshot.docs
      .map(
        (
          documentSnapshot
        ) => ({
          id:
            documentSnapshot.id,

          ...documentSnapshot.data()
        })
      )
      .sort(
        (
          a,
          b
        ) =>
          Number(
            b.versionAfter ||
            0
          ) -
          Number(
            a.versionAfter ||
            0
          )
      );
  },


  // ==========================================================
  // Phase 2
  // SSS user master
  // ==========================================================

  // ------------------------------------------------------------
  // Load currently active formal users
  //
  // 現時点では SSS の users のみ。
  //
  // 将来、体験フェーズのPersonの正本が確定したら、
  // phase:"TRIAL" のデータをここへ合流する。
  // ------------------------------------------------------------

  async listAllUsers() {
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
          "users"
        )
      );

    return snapshot.docs
      .map(
        normalizeUserDirectoryItem
      )
      .sort(
        (
          a,
          b
        ) =>
          String(
            a.name
          ).localeCompare(
            String(
              b.name
            ),
            "ja"
          )
      );
  },


  async listActiveUsers() {
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
          "users"
        )
      );

    return snapshot.docs
      .filter(
        (
          documentSnapshot
        ) =>
          userMasterIsCurrentlyActive(
            documentSnapshot.data()
          )
      )
      .map(
        normalizeActiveUser
      )
      .sort(
        (
          a,
          b
        ) =>
          String(
            a.name
          ).localeCompare(
            String(
              b.name
            ),
            "ja"
          )
      );
  },


  // ==========================================================
  // Posting participant configuration
  // ==========================================================

  // ------------------------------------------------------------
  // Load Posting participant settings
  // ------------------------------------------------------------

  async listPostingParticipants() {
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
          "postingParticipants"
        )
      );

    return snapshot.docs.map(
      normalizePostingParticipant
    );
  },


  // ------------------------------------------------------------
  // Load all candidates for participant management
  //
  // app.jsから見ると、
  //
  // {
  //   personId,
  //   name,
  //   phase,
  //   phaseLabel,
  //   postingEnabled
  // }
  //
  // の共通形式になる。
  // ------------------------------------------------------------

  async listPostingParticipantCandidates() {
    const [
      users,
      postingSettings
    ] =
      await Promise.all([
        this.listActiveUsers(),
        this.listPostingParticipants()
      ]);


    const settingMap =
      new Map(
        postingSettings.map(
          (
            setting
          ) => [
            setting.personId,
            setting
          ]
        )
      );


    return users.map(
      (
        person
      ) => {
        const setting =
          settingMap.get(
            person.personId
          );

        return {
          ...person,

          postingEnabled:
            setting
              ?.enabled ===
            true
        };
      }
    );
  },


  // ------------------------------------------------------------
  // Load only enabled Posting participants
  //
  // 通常の「一緒に参加した人」欄では、
  // 基本的にこの結果だけを使う。
  // ------------------------------------------------------------

  async listEnabledPostingParticipants() {
    const candidates =
      await this
        .listPostingParticipantCandidates();

    return candidates.filter(
      (
        person
      ) =>
        person.postingEnabled ===
        true
    );
  },


  // ------------------------------------------------------------
  // Enable / disable Posting participant
  //
  // Posting側では名前・利用状態を保持しない。
  // personId と Posting参加対象かどうかだけを保持する。
  // ------------------------------------------------------------

  async setPostingParticipantEnabled(
    personId,
    enabled
  ) {
    const user =
      auth.currentUser;

    if (!user) {
      throw new Error(
        "Authentication required."
      );
    }


    if (
      typeof personId !==
        "string" ||
      !personId.trim()
    ) {
      throw new Error(
        "personId is required."
      );
    }


    if (
      typeof enabled !==
      "boolean"
    ) {
      throw new Error(
        "enabled must be boolean."
      );
    }


    const normalizedPersonId =
      personId.trim();


    const reference =
      doc(
        db,
        "postingParticipants",
        normalizedPersonId
      );


    const existing =
      await getDoc(
        reference
      );


    /*
     * 初回追加
     */
    if (
      !existing.exists()
    ) {
      const payload = {
        personId:
          normalizedPersonId,

        enabled,

        addedAt:
          serverTimestamp(),

        addedByUid:
          user.uid,

        updatedAt:
          serverTimestamp(),

        updatedByUid:
          user.uid
      };


      await setDoc(
        reference,
        payload
      );


      return {
        personId:
          normalizedPersonId,

        enabled
      };
    }


    /*
     * 既存設定の変更
     *
     * addedAt / addedByUid は保持。
     */
    const existingData =
      existing.data();


    const payload = {
      personId:
        normalizedPersonId,

      enabled,

      addedAt:
        existingData.addedAt ||
        serverTimestamp(),

      addedByUid:
        existingData.addedByUid ||
        user.uid,

      updatedAt:
        serverTimestamp(),

      updatedByUid:
        user.uid
    };


    await setDoc(
      reference,
      payload
    );


    return {
      personId:
        normalizedPersonId,

      enabled
    };
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
      "Firestore:{lng,lat} / App:[lng,lat]",

    postingParticipants:
      "Phase 2 bridge enabled",

    postingMasters:
      "Phase 4 bridge enabled"
  }
);
