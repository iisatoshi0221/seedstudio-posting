(() => {
  "use strict";

  // ============================================================
  // SeedStudio Posting
  // app.js
  // Phase 2 - Posting participant management
  // ============================================================

  const STORAGE_KEY = "seedstudio-posting-v0.1-records";

  const DEFAULT_CENTER = {
    lat: 35.6074,
    lng: 140.1065
  };

  const DEFAULT_ZOOM = 14;

  // ============================================================
  // Temporary local masters
  //
  // Staff/FlyerはPhase 4でFirestore masterへ移行予定。
  // ParticipantsはPhase 2からSSS共通 users + postingParticipants を使用。
  // ============================================================

  const master = {
    staff: [
      { id: "S0006", name: "田島 雄弥" },
      { id: "S0007", name: "山本 耕平" },
      { id: "S0008", name: "井伊 啓" },
      { id: "S0001", name: "大久保 和恵" }
    ],

    flyers: [
      {
        id: "F0001",
        name: "SeedStudio 事業所案内 2026-10"
      }
    ]
  };

  // 過去の職員IDを履歴表示で解決するため保持
  const legacyStaffNames = {
    S0001: "大久保 和恵",
    S0002: "宮 麻衣子",
    S0003: "鈴木 由香",
    S0004: "小野 瑞季",
    S0005: "番場 みづい",
    S0006: "田島 雄弥",
    S0007: "山本 耕平",
    S0008: "井伊 啓"
  };

  // 旧Postingテストデータ表示互換
  const legacyParticipantNames = {
    U0001: "長島 栄一",
    U0002: "佐藤 彩衣",
    U0003: "能瀬 望結",
    U0004: "出口 朋茄",
    U0005: "安田 孝博",
    U0006: "小山 悟",
    U0007: "宮 麻衣子",
    U0008: "鈴木 由香",
    U0009: "小野 瑞季",
    U0010: "冨樫 浩一",
    U0011: "黒川 裕明",
    U0012: "久保田 真琴",
    U0013: "白澤 英哉"
  };

  const state = {
    currentView: "home",

    authState: {
      signedIn: false,
      authorized: false,
      user: null,
      staff: null
    },

    // Firestoreから取得したSSS利用者
    participantCandidates: [],

    // postingEnabled === true の利用者
    postingParticipants: [],

    participantLoading: false,
    participantError: null,

    mapPoints: [],
    draft: {},
    lastSavedRecord: null,

    mapsPromise: null,

    postingMap: null,
    postingPolygon: null,
    postingMarkers: [],
    postingHistoryPolygons: [],

    confirmMap: null,
    confirmPolygon: null,

    historyMap: null,
    historyPolygons: []
  };

  const milestoneSteps = [
    10000,
    50000,
    100000,
    250000,
    500000
  ];

  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => [...document.querySelectorAll(selector)];

  // ============================================================
  // Generic helpers
  // ============================================================

  function todayIso() {
    const now = new Date();
    const local = new Date(
      now.getTime() - now.getTimezoneOffset() * 60000
    );

    return local.toISOString().slice(0, 10);
  }

  function currentYm() {
    return todayIso().slice(0, 7);
  }

  function formatNumber(value) {
    return Number(value || 0).toLocaleString("ja-JP");
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function getParticipantById(id) {
    return (
      state.participantCandidates.find(
        (item) => item.personId === id
      ) ||
      state.postingParticipants.find(
        (item) => item.personId === id
      ) ||
      null
    );
  }

  const names = {
    staff(id) {
      return (
        master.staff.find((item) => item.id === id)?.name ||
        legacyStaffNames[id] ||
        id
      );
    },

    participant(id) {
      return (
        getParticipantById(id)?.name ||
        legacyParticipantNames[id] ||
        id
      );
    },

    flyer(id) {
      return (
        master.flyers.find((item) => item.id === id)?.name ||
        id
      );
    }
  };

  // ============================================================
  // Authentication UI
  // ============================================================

  function setRegistrationAvailability(enabled) {
    const button = document.querySelector(
      '[data-nav="register-basic"]'
    );

    if (!button) {
      return;
    }

    button.disabled = !enabled;
    button.style.opacity = enabled ? "1" : "0.55";
  }

  function renderAuthState() {
    const auth = state.authState;

    const loading = $("#authLoading");
    const signedOut = $("#authSignedOut");
    const signedIn = $("#authSignedIn");

    if (!loading || !signedOut || !signedIn) {
      return;
    }

    loading.classList.add("is-hidden");

    if (!auth.signedIn) {
      signedOut.classList.remove("is-hidden");
      signedIn.classList.add("is-hidden");
      setRegistrationAvailability(false);
      return;
    }

    signedOut.classList.add("is-hidden");
    signedIn.classList.remove("is-hidden");

    const userName = $("#authUserName");
    const userEmail = $("#authUserEmail");
    const permissionStatus = $("#authPermissionStatus");

    if (userName) {
      userName.textContent =
        auth.user?.displayName ||
        auth.user?.email ||
        "ログイン中";
    }

    if (userEmail) {
      userEmail.textContent = auth.user?.email || "";
    }

    if (!permissionStatus) {
      return;
    }

    if (auth.authorized) {
      permissionStatus.textContent =
        "✓ SeedStudio職員として認証済み";

      permissionStatus.style.color = "#2F6D4F";

      setRegistrationAvailability(true);
    } else {
      permissionStatus.textContent =
        "このGoogleアカウントはSeedStudio職員として登録されていません";

      permissionStatus.style.color = "#B54848";

      setRegistrationAvailability(false);
    }
  }

  function showAuthError(message) {
    $("#authLoading")?.classList.add("is-hidden");
    $("#authSignedOut")?.classList.remove("is-hidden");

    setRegistrationAvailability(false);
    console.error(message);
  }

  // ============================================================
  // Posting record repository
  // ============================================================

  const dataRepository = {
    cache: [],
    mode: "loading",

    loadLocal() {
      const raw = localStorage.getItem(STORAGE_KEY);

      if (!raw) {
        return [];
      }

      try {
        return JSON.parse(raw);
      } catch (error) {
        console.warn(
          "Local data parse failed.",
          error
        );

        return [];
      }
    },

    saveLocal(records) {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify(records)
      );
    },

    async waitForFirebaseBridge(timeoutMs = 10000) {
      const started = Date.now();

      while (
        !window.SeedStudioFirestore ||
        !window.SeedStudioAuth
      ) {
        if (Date.now() - started > timeoutMs) {
          throw new Error(
            "Firebase bridge timeout"
          );
        }

        await sleep(100);
      }
    },

    async initialize() {
      try {
        await this.waitForFirebaseBridge();

        const authState =
          await window.SeedStudioAuth.waitUntilReady();

        state.authState = authState;
        renderAuthState();

        if (!authState.authorized) {
          this.cache = this.loadLocal();
          this.mode = "auth-required";
          return;
        }

        await Promise.all([
          this.reloadFromFirestore(),
          participantRepository.reload()
        ]);
      } catch (error) {
        console.error(
          "Firebase initialization failed.",
          error
        );

        this.cache = this.loadLocal();
        this.mode = "local";

        state.authState = {
          signedIn: false,
          authorized: false,
          user: null,
          staff: null
        };

        showAuthError(
          "Firebase認証を初期化できませんでした。"
        );
      }
    },

    load() {
      return [...this.cache];
    },

    async reloadFromFirestore() {
      if (!state.authState.authorized) {
        return;
      }

      const records =
        await window.SeedStudioFirestore.listPostingRecords();

      this.cache = records.sort(
        (a, b) =>
          (b.postingDate || "").localeCompare(
            a.postingDate || ""
          )
      );

      this.mode = "firestore";
      this.saveLocal(this.cache);
    },

    async add(record) {
      if (!state.authState.authorized) {
        throw new Error("LOGIN_REQUIRED");
      }

      try {
        const saved =
          await window.SeedStudioFirestore.savePostingRecord(
            record
          );

        this.cache.push(saved);

        this.cache.sort(
          (a, b) =>
            (b.postingDate || "").localeCompare(
              a.postingDate || ""
            )
        );

        this.saveLocal(this.cache);
        this.mode = "firestore";

        return {
          mode: "firestore",
          record: saved
        };
      } catch (error) {
        console.error(
          "Firestore save failed.",
          error
        );

        this.cache.push(record);
        this.saveLocal(this.cache);

        this.mode = "local";

        return {
          mode: "local",
          record
        };
      }
    }
  };

  // ============================================================
  // Participant repository
  // ============================================================

  const participantRepository = {
    async reload() {
      if (!state.authState.authorized) {
        state.participantCandidates = [];
        state.postingParticipants = [];
        return;
      }

      state.participantLoading = true;
      state.participantError = null;

      renderParticipantLoadingStates();

      try {
        const candidates =
          await window.SeedStudioFirestore
            .listPostingParticipantCandidates();

        state.participantCandidates =
          Array.isArray(candidates)
            ? [...candidates]
            : [];

        state.postingParticipants =
          state.participantCandidates.filter(
            (person) =>
              person.postingEnabled === true
          );

        renderParticipantUI();
      } catch (error) {
        console.error(
          "Participant master load failed.",
          error
        );

        state.participantError = error;
        state.participantCandidates = [];
        state.postingParticipants = [];

        renderParticipantUI();
      } finally {
        state.participantLoading = false;
        renderParticipantLoadingStates();
      }
    },

    async setEnabled(personId, enabled) {
      if (!state.authState.authorized) {
        throw new Error(
          "Authentication required."
        );
      }

      await window.SeedStudioFirestore
        .setPostingParticipantEnabled(
          personId,
          enabled
        );

      await this.reload();
    }
  };

  // ============================================================
  // Participant UI helpers
  // ============================================================

  function phaseLabelHtml(person) {
    const phase =
      person.phase || "ACTIVE";

    const label =
      person.phaseLabel ||
      (phase === "TRIAL"
        ? "体験中"
        : "利用中");

    const style =
      phase === "TRIAL"
        ? "background:#FFF1D8;color:#8A6020;"
        : "background:#E8F3EC;color:#2F6D4F;";

    return `
      <span
        style="
          display:inline-flex;
          align-items:center;
          padding:4px 8px;
          border-radius:999px;
          font-size:11px;
          font-weight:700;
          ${style}
        "
      >
        ${escapeHtml(label)}
      </span>
    `;
  }

  function renderParticipantLoadingStates() {
    $("#participantListLoading")
      ?.classList.toggle(
        "is-hidden",
        !state.participantLoading
      );

    $("#postingParticipantCurrentLoading")
      ?.classList.toggle(
        "is-hidden",
        !state.participantLoading
      );

    $("#postingParticipantCandidateLoading")
      ?.classList.toggle(
        "is-hidden",
        !state.participantLoading
      );
  }

  function renderParticipantList() {
    const list = $("#participantList");
    const empty = $("#participantListEmpty");

    if (!list) {
      return;
    }

    if (
      state.participantError ||
      state.participantLoading
    ) {
      list.innerHTML = "";
      empty?.classList.add("is-hidden");
      return;
    }

    const selectedIds =
      new Set(
        state.draft.participantIds ||
        []
      );

    const participants =
      [...state.postingParticipants].sort(
        (a, b) =>
          String(a.name || "").localeCompare(
            String(b.name || ""),
            "ja"
          )
      );

    list.innerHTML =
      participants
        .map(
          (person) => `
            <label class="checkbox-row ${
              selectedIds.has(person.personId)
                ? "is-selected"
                : ""
            }">
              <input
                type="checkbox"
                value="${escapeHtml(
                  person.personId
                )}"
                ${
                  selectedIds.has(person.personId)
                    ? "checked"
                    : ""
                }
              >
              <span
                style="
                  display:flex;
                  align-items:center;
                  justify-content:space-between;
                  gap:10px;
                  width:100%;
                "
              >
                <span>
                  ${escapeHtml(person.name)}
                </span>

                ${phaseLabelHtml(person)}
              </span>
            </label>
          `
        )
        .join("");

    empty?.classList.toggle(
      "is-hidden",
      participants.length > 0
    );
  }

  function renderParticipantManagerCurrent() {
    const list =
      $("#postingParticipantCurrentList");

    const empty =
      $("#postingParticipantCurrentEmpty");

    const count =
      $("#postingParticipantCount");

    if (!list) {
      return;
    }

    const participants =
      [...state.postingParticipants].sort(
        (a, b) =>
          String(a.name || "").localeCompare(
            String(b.name || ""),
            "ja"
          )
      );

    if (count) {
      count.textContent =
        `${participants.length}名`;
    }

    list.innerHTML =
      participants
        .map(
          (person) => `
            <div
              class="checkbox-row"
              style="
                display:flex;
                align-items:center;
                justify-content:space-between;
                gap:10px;
              "
            >
              <span
                style="
                  min-width:0;
                  flex:1;
                  display:flex;
                  align-items:center;
                  justify-content:space-between;
                  gap:8px;
                "
              >
                <span>
                  ${escapeHtml(person.name)}
                </span>

                ${phaseLabelHtml(person)}
              </span>

              <button
                class="button button--secondary js-remove-posting-participant"
                type="button"
                data-person-id="${escapeHtml(
                  person.personId
                )}"
                style="
                  flex:none;
                  width:auto;
                  padding:8px 10px;
                  margin:0;
                  font-size:12px;
                "
              >
                非表示
              </button>
            </div>
          `
        )
        .join("");

    empty?.classList.toggle(
      "is-hidden",
      participants.length > 0
    );
  }

  function renderParticipantManagerCandidates() {
    const list =
      $("#postingParticipantCandidateList");

    const empty =
      $("#postingParticipantCandidateEmpty");

    const error =
      $("#postingParticipantCandidateError");

    if (!list) {
      return;
    }

    error?.classList.toggle(
      "is-hidden",
      !state.participantError
    );

    if (
      state.participantLoading ||
      state.participantError
    ) {
      list.innerHTML = "";
      empty?.classList.add("is-hidden");
      return;
    }

    const searchText =
      ($("#postingParticipantSearch")
        ?.value || "")
        .trim()
        .toLocaleLowerCase("ja");

    const candidates =
      state.participantCandidates
        .filter(
          (person) => {
            if (
              person.postingEnabled === true
            ) {
              return false;
            }

            if (!searchText) {
              return true;
            }

            return String(
              person.name || ""
            )
              .toLocaleLowerCase("ja")
              .includes(searchText);
          }
        )
        .sort(
          (a, b) =>
            String(a.name || "").localeCompare(
              String(b.name || ""),
              "ja"
            )
        );

    list.innerHTML =
      candidates
        .map(
          (person) => `
            <article
              class="history-item"
              style="
                display:flex;
                align-items:center;
                justify-content:space-between;
                gap:12px;
              "
            >
              <div
                style="
                  min-width:0;
                  flex:1;
                "
              >
                <b
                  style="
                    display:block;
                    margin-bottom:5px;
                  "
                >
                  ${escapeHtml(person.name)}
                </b>

                ${phaseLabelHtml(person)}
              </div>

              <button
                class="button button--primary js-add-posting-participant"
                type="button"
                data-person-id="${escapeHtml(
                  person.personId
                )}"
                style="
                  flex:none;
                  width:auto;
                  padding:9px 12px;
                  margin:0;
                  font-size:13px;
                "
              >
                追加
              </button>
            </article>
          `
        )
        .join("");

    empty?.classList.toggle(
      "is-hidden",
      candidates.length > 0
    );
  }

  function renderAchievementParticipantSelect() {
    const select =
      $("#achievementParticipantSelect");

    if (!select) {
      return;
    }

    const previous =
      select.value;

    const idsInHistory =
      new Set(
        dataRepository
          .load()
          .flatMap(
            (record) =>
              (record.participants || [])
                .map(
                  (participant) =>
                    participant.participantId
                )
          )
      );

    const combined =
      new Map();

    state.participantCandidates.forEach(
      (person) => {
        combined.set(
          person.personId,
          person
        );
      }
    );

    idsInHistory.forEach(
      (personId) => {
        if (!combined.has(personId)) {
          combined.set(
            personId,
            {
              personId,
              name:
                legacyParticipantNames[
                  personId
                ] || personId
            }
          );
        }
      }
    );

    const participants =
      [...combined.values()].sort(
        (a, b) =>
          String(a.name || "").localeCompare(
            String(b.name || ""),
            "ja"
          )
      );

    select.innerHTML =
      participants
        .map(
          (person) =>
            `<option value="${escapeHtml(
              person.personId
            )}">${escapeHtml(
              person.name
            )}</option>`
        )
        .join("");

    if (
      previous &&
      participants.some(
        (person) =>
          person.personId ===
          previous
      )
    ) {
      select.value = previous;
    }
  }

  function renderParticipantUI() {
    renderParticipantList();
    renderParticipantManagerCurrent();
    renderParticipantManagerCandidates();
    renderAchievementParticipantSelect();
  }

  async function openParticipantManager() {
    if (!state.authState.authorized) {
      alert(
        "Googleログインが必要です。"
      );
      return;
    }

    syncStep1();

    navigate(
      "participant-manager"
    );

    await participantRepository.reload();
  }

  async function handleParticipantToggle(
    personId,
    enabled,
    button
  ) {
    if (!personId) {
      return;
    }

    const originalText =
      button?.textContent || "";

    if (button) {
      button.disabled = true;
      button.textContent =
        enabled
          ? "追加中…"
          : "変更中…";
    }

    try {
      await participantRepository
        .setEnabled(
          personId,
          enabled
        );

      if (!enabled) {
        state.draft.participantIds =
          (
            state.draft
              .participantIds ||
            []
          ).filter(
            (id) =>
              id !==
              personId
          );

        delete state.draft
          .participantSteps[
            personId
          ];
      }

      renderParticipantUI();