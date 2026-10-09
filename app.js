(() => {
  "use strict";

  // ============================================================
  // SeedStudio Posting
  // app.js
  // MVP - Firestore masters + resilient sync
  // ============================================================

  const STORAGE_KEY = "seedstudio-posting-v0.1-records";
  const PENDING_STORAGE_KEY = "seedstudio-posting-v0.1-pending";

  const DEFAULT_CENTER = {
    lat: 35.6074,
    lng: 140.1065
  };

  const DEFAULT_ZOOM = 14;

  // ============================================================
  // Firestore masters
  //
  // Phase 4:
  // staff / flyers は Firestore の
  // postingStaff / postingFlyers を正本として使用する。
  //
  // Participants は Phase 2 から
  // users + postingParticipants を使用。
  // ============================================================

  const master = {
    staff: [],
    flyers: []
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

  // 過去履歴表示用の最低限の互換ラベル。
  // 新規登録の候補には使用しない。
  const legacyFlyerNames = {
    F0001: "SeedStudio 事業所案内 2026-10"
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

    // 履歴・成果の氏名解決用。利用終了者も含む users 全件。
    participantDirectory: [],

    // postingEnabled === true の利用者
    postingParticipants: [],

    participantLoading: false,
    participantError: null,

    masterLoading: false,
    masterReady: false,
    masterError: null,

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

  function caloriesFromSteps(steps) {
    return Math.round(
      Number(steps || 0) * 0.05
    );
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
      state.participantDirectory.find(
        (item) => item.personId === id
      ) ||
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
        legacyFlyerNames[id] ||
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

      setRegistrationAvailability(
        state.masterReady
      );
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

    loadPending() {
      const raw =
        localStorage.getItem(
          PENDING_STORAGE_KEY
        );

      if (!raw) {
        return [];
      }

      try {
        const records =
          JSON.parse(raw);

        return Array.isArray(records)
          ? records
          : [];
      } catch (error) {
        console.warn(
          "Pending data parse failed.",
          error
        );

        return [];
      }
    },

    savePending(records) {
      localStorage.setItem(
        PENDING_STORAGE_KEY,
        JSON.stringify(
          Array.isArray(records)
            ? records
            : []
        )
      );
    },

    upsertCache(record) {
      const index =
        this.cache.findIndex(
          (item) =>
            item.id ===
            record.id
        );

      if (index >= 0) {
        this.cache[index] =
          record;
      } else {
        this.cache.push(
          record
        );
      }

      this.cache.sort(
        (a, b) =>
          (b.postingDate || "")
            .localeCompare(
              a.postingDate || ""
            )
      );
    },

    mergeRecords(
      primary,
      secondary
    ) {
      const map =
        new Map();

      [
        ...(primary || []),
        ...(secondary || [])
      ].forEach(
        (record) => {
          if (
            record?.id
          ) {
            map.set(
              record.id,
              record
            );
          }
        }
      );

      return [...map.values()]
        .sort(
          (a, b) =>
            (b.postingDate || "")
              .localeCompare(
                a.postingDate || ""
              )
        );
    },

    addPending(record) {
      const pending =
        this.loadPending();

      const index =
        pending.findIndex(
          (item) =>
            item.id ===
            record.id
        );

      if (index >= 0) {
        pending[index] =
          record;
      } else {
        pending.push(
          record
        );
      }

      this.savePending(
        pending
      );
    },

    async syncPending() {
      if (
        !state.authState.authorized ||
        !window.SeedStudioFirestore
      ) {
        return {
          synced: 0,
          remaining:
            this.loadPending()
              .length
        };
      }

      const pending =
        this.loadPending();

      if (!pending.length) {
        this.mode =
          "firestore";

        return {
          synced: 0,
          remaining: 0
        };
      }

      const remaining = [];
      let synced = 0;

      for (
        const record of pending
      ) {
        try {
          const saved =
            await window.SeedStudioFirestore
              .savePostingRecord(
                record
              );

          this.upsertCache(
            saved
          );

          synced += 1;
        } catch (error) {
          console.warn(
            "Pending Posting sync failed.",
            record?.id,
            error
          );

          remaining.push(
            record
          );
        }
      }

      this.savePending(
        remaining
      );

      this.saveLocal(
        this.cache
      );

      this.mode =
        remaining.length
          ? "pending"
          : "firestore";

      return {
        synced,
        remaining:
          remaining.length
      };
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
          participantRepository.reload(),
          masterRepository.reload()
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
        await window.SeedStudioFirestore
          .listPostingRecords();

      const pending =
        this.loadPending();

      // Firestore再読込時も未同期レコードを消さない。
      // 同じIDの場合は pending 側を優先する。
      this.cache =
        this.mergeRecords(
          records,
          pending
        );

      this.mode =
        pending.length
          ? "pending"
          : "firestore";

      this.saveLocal(
        this.cache
      );

      // 通信が復旧していれば、その場で再送する。
      await this.syncPending();
    },

    async add(record) {
      if (!state.authState.authorized) {
        throw new Error(
          "LOGIN_REQUIRED"
        );
      }

      try {
        const saved =
          await window.SeedStudioFirestore
            .savePostingRecord(
              record
            );

        this.upsertCache(
          saved
        );

        this.saveLocal(
          this.cache
        );

        this.mode =
          this.loadPending().length
            ? "pending"
            : "firestore";

        return {
          mode: "firestore",
          record: saved
        };
      } catch (error) {
        console.error(
          "Firestore save failed.",
          error
        );

        // 保存失敗時は通常キャッシュとは別の
        // 未同期キューにも必ず保持する。
        this.addPending(
          record
        );

        this.upsertCache(
          record
        );

        this.saveLocal(
          this.cache
        );

        this.mode =
          "pending";

        return {
          mode: "pending",
          record
        };
      }
    }
  };

  // ============================================================
  // Posting master repository
  // ============================================================

  const masterRepository = {
    async reload() {
      if (!state.authState.authorized) {
        state.masterReady = false;
        return;
      }

      state.masterLoading = true;
      state.masterError = null;
      state.masterReady = false;

      try {
        const [
          staff,
          flyers
        ] =
          await Promise.all([
            window.SeedStudioFirestore
              .listPostingStaff(),

            window.SeedStudioFirestore
              .listPostingFlyers()
          ]);

        master.staff =
          (Array.isArray(staff)
            ? staff
            : []
          ).map(
            (item) => ({
              id:
                item.staffId,

              name:
                item.name,

              active:
                item.active === true,

              displayOrder:
                Number(
                  item.displayOrder ||
                  0
                )
            })
          );

        master.flyers =
          (Array.isArray(flyers)
            ? flyers
            : []
          ).map(
            (item) => ({
              id:
                item.flyerId,

              name:
                item.name,

              active:
                item.active === true,

              displayOrder:
                Number(
                  item.displayOrder ||
                  0
                )
            })
          );

        const hasActiveStaff =
          master.staff.some(
            (item) =>
              item.active
          );

        const hasActiveFlyer =
          master.flyers.some(
            (item) =>
              item.active
          );

        state.masterReady =
          hasActiveStaff &&
          hasActiveFlyer;

        renderMasters();
        renderAuthState();

      } catch (error) {
        console.error(
          "Posting master load failed.",
          error
        );

        master.staff = [];
        master.flyers = [];

        state.masterError =
          error;

        state.masterReady =
          false;

        renderMasters();
        renderAuthState();

        throw error;

      } finally {
        state.masterLoading =
          false;
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
        const [
          candidates,
          directory
        ] =
          await Promise.all([
            window.SeedStudioFirestore
              .listPostingParticipantCandidates(),

            window.SeedStudioFirestore
              .listAllUsers()
          ]);

        state.participantCandidates =
          Array.isArray(candidates)
            ? [...candidates]
            : [];

        state.participantDirectory =
          Array.isArray(directory)
            ? [...directory]
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
        state.participantDirectory = [];
        state.postingParticipants = [];

        renderParticipantUI();
      } finally {
        state.participantLoading = false;
        renderParticipantLoadingStates();

        // 読み込み完了後に候補一覧を再描画する。
        // これにより、検索操作をしなくても未登録利用者が最初から表示される。
        renderParticipantUI();
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

    // 管理画面を開くたびに検索条件をクリアし、
    // 未登録利用者を最初から一覧表示する。
    const searchInput =
      $("#postingParticipantSearch");

    if (searchInput) {
      searchInput.value = "";
    }

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
    } catch (error) {
      console.error(
        "Posting participant update failed.",
        error
      );

      alert(
        "参加者設定を更新できませんでした。"
      );

      if (button) {
        button.disabled = false;
        button.textContent = originalText;
      }
    }
  }

  // ============================================================
  // Google Maps
  // ============================================================

  function getMapsApiKey() {
    return (
      window.SEEDSTUDIO_CONFIG
        ?.googleMapsApiKey ||
      ""
    );
  }

  function isConfiguredMapsKey(key) {
    return (
      !!key &&
      !key.includes(
        "PASTE_YOUR_GOOGLE_MAPS_API_KEY_HERE"
      )
    );
  }

  function setMapStatus(
    selector,
    message,
    isError = false
  ) {
    const element = $(selector);

    if (!element) {
      return;
    }

    element.textContent = message;
    element.classList.toggle(
      "is-error",
      isError
    );
    element.classList.remove(
      "is-hidden"
    );
  }

  function hideMapStatus(selector) {
    $(selector)?.classList.add(
      "is-hidden"
    );
  }

  function loadGoogleMaps() {
    if (window.google?.maps) {
      return Promise.resolve(
        window.google.maps
      );
    }

    if (state.mapsPromise) {
      return state.mapsPromise;
    }

    const key = getMapsApiKey();

    if (!isConfiguredMapsKey(key)) {
      state.mapsPromise =
        Promise.reject(
          new Error(
            "Google Maps APIキーが未設定です。"
          )
        );

      return state.mapsPromise;
    }

    state.mapsPromise =
      new Promise(
        (resolve, reject) => {
          window.__seedStudioMapsReady =
            () => {
              resolve(
                window.google.maps
              );
            };

          const script =
            document.createElement(
              "script"
            );

          script.src =
            "https://maps.googleapis.com/maps/api/js" +
            "?key=" +
            encodeURIComponent(key) +
            "&callback=__seedStudioMapsReady" +
            "&v=weekly";

          script.async = true;
          script.defer = true;

          script.onerror =
            () => {
              reject(
                new Error(
                  "Google Mapsを読み込めませんでした。"
                )
              );
            };

          document.head.appendChild(
            script
          );
        }
      );

    return state.mapsPromise;
  }

  function toLatLngPath(coordinates) {
    return (
      coordinates || []
    ).map(
      ([lng, lat]) => ({
        lat,
        lng
      })
    );
  }

  function fitMapToCoordinates(
    map,
    coordinates,
    fallbackCenter =
      DEFAULT_CENTER
  ) {
    if (!map) {
      return;
    }

    if (!coordinates?.length) {
      map.setCenter(
        fallbackCenter
      );
      map.setZoom(
        DEFAULT_ZOOM
      );
      return;
    }

    const bounds =
      new google.maps.LatLngBounds();

    coordinates.forEach(
      ([lng, lat]) => {
        bounds.extend({
          lat,
          lng
        });
      }
    );

    if (coordinates.length === 1) {
      map.setCenter({
        lat:
          coordinates[0][1],
        lng:
          coordinates[0][0]
      });

      map.setZoom(17);
    } else {
      map.fitBounds(
        bounds,
        36
      );
    }
  }

  function getGeoRecords() {
    return dataRepository
      .load()
      .filter(
        (record) =>
          record.area?.type ===
            "Polygon" &&
          Array.isArray(
            record.area.coordinates
          ) &&
          record.area.coordinates
            .length >= 3
      );
  }

  // ============================================================
  // Draft
  // ============================================================

  function resetDraft() {
    state.mapPoints = [];

    const activeStaff =
      master.staff.filter(
        (item) =>
          item.active
      );

    const preferredStaff =
      activeStaff.find(
        (item) =>
          item.id ===
          "S0006"
      ) ||
      activeStaff[0] ||
      null;

    const activeFlyers =
      master.flyers.filter(
        (item) =>
          item.active
      );

    state.draft = {
      postingDate:
        todayIso(),

      staffId:
        preferredStaff
          ?.id ||
        "",

      flyerId:
        activeFlyers[0]
          ?.id ||
        "",

      participantIds:
        [],

      area:
        null,

      quantity:
        0,

      participantSteps:
        {}
    };

    if ($("#postingDate")) {
      $("#postingDate").value =
        state.draft.postingDate;
    }

    if ($("#staffSelect")) {
      $("#staffSelect").value =
        state.draft.staffId;
    }

    if ($("#flyerSelect")) {
      $("#flyerSelect").value =
        state.draft.flyerId;
    }

    if ($("#quantityInput")) {
      $("#quantityInput").value =
        "";
    }

    renderParticipantList();
    clearDraftMapGraphics();
  }

  // ============================================================
  // Navigation
  // ============================================================

  function navigate(view) {
    state.currentView = view;

    $$(".view").forEach(
      (element) => {
        element.classList.toggle(
          "is-active",
          element.dataset.view ===
            view
        );
      }
    );

    const backButton =
      $("#backButton");

    backButton?.classList.toggle(
      "is-hidden",
      view === "home"
    );

    const titles = {
      home:
        "SeedStudio Posting",

      "register-basic":
        "配布実績を登録",

      "participant-manager":
        "ポスティング参加者",

      "register-map":
        "配布実績を登録",

      "register-result":
        "配布実績を登録",

      success:
        "登録完了",

      map:
        "配布状況",

      achievements:
        "みんなの成果",

      "monthly-report":
        "月間成果レポート",

      history:
        "配布履歴"
    };

    if ($("#pageTitle")) {
      $("#pageTitle").textContent =
        titles[view] ||
        "SeedStudio Posting";
    }

    if (view === "home") {
      renderHome();
    }

    if (view === "register-basic") {
      renderParticipantList();
    }

    if (
      view ===
      "participant-manager"
    ) {
      renderParticipantUI();
    }

    if (view === "register-map") {
      window.setTimeout(
        initPostingMap,
        0
      );
    }

    if (
      view ===
      "register-result"
    ) {
      renderResultStep();
    }

    if (view === "success") {
      renderSuccess();
    }

    if (
      view ===
      "achievements"
    ) {
      renderAchievementParticipantSelect();
      renderAchievements();
    }

    if (
      view ===
      "monthly-report"
    ) {
      initializeMonthlyReportSelection();
    }

    if (view === "history") {
      renderHistory();
    }

    if (view === "map") {
      window.setTimeout(
        renderMapStatus,
        0
      );
    }

    window.scrollTo(0, 0);
  }

  function goBack() {
    const fallback = {
      "register-basic":
        "home",

      "participant-manager":
        "register-basic",

      "register-map":
        "register-basic",

      "register-result":
        "register-map",

      success:
        "home",

      map:
        "home",

      achievements:
        "home",

      "monthly-report":
        "home",

      history:
        "home"
    };

    navigate(
      fallback[
        state.currentView
      ] ||
      "home"
    );
  }

  // ============================================================
  // Masters
  // ============================================================

  function renderMasters() {
    const staffSelect =
      $("#staffSelect");

    const activeStaff =
      master.staff.filter(
        (item) =>
          item.active
      );

    if (staffSelect) {
      if (
        activeStaff.length
      ) {
        staffSelect.innerHTML =
          activeStaff
            .map(
              (item) =>
                `<option value="${escapeHtml(
                  item.id
                )}">${escapeHtml(
                  item.name
                )}</option>`
            )
            .join("");
      } else {
        staffSelect.innerHTML =
          `<option value="">${state.masterLoading
            ? "職員マスターを読み込み中..."
            : "担当職員を読み込めません"}</option>`;
      }
    }

    const flyerSelect =
      $("#flyerSelect");

    const activeFlyers =
      master.flyers.filter(
        (item) =>
          item.active
      );

    if (flyerSelect) {
      if (
        activeFlyers.length
      ) {
        flyerSelect.innerHTML =
          activeFlyers
            .map(
              (item) =>
                `<option value="${escapeHtml(
                  item.id
                )}">${escapeHtml(
                  item.name
                )}</option>`
            )
            .join("");
      } else {
        flyerSelect.innerHTML =
          `<option value="">${state.masterLoading
            ? "チラシマスターを読み込み中..."
            : "チラシを読み込めません"}</option>`;
      }
    }

    renderParticipantUI();
  }

  // ============================================================
  // Home
  // ============================================================

  function renderHome() {
    const ym = currentYm();

    const records =
      dataRepository
        .load()
        .filter(
          (record) =>
            (
              record.postingDate ||
              ""
            ).startsWith(ym)
        );

    const quantity =
      records.reduce(
        (total, record) =>
          total +
          Number(
            record.quantity ||
            0
          ),
        0
      );

    const steps =
      records.reduce(
        (total, record) =>
          total +
          (
            record.participants ||
            []
          ).reduce(
            (
              participantTotal,
              participant
            ) =>
              participantTotal +
              Number(
                participant.steps ||
                0
              ),
            0
          ),
        0
      );

    const participations =
      records.reduce(
        (total, record) =>
          total +
          (
            record.participants ||
            []
          ).length,
        0
      );

    if ($("#summaryMonth")) {
      $("#summaryMonth").textContent =
        `${Number(
          ym.slice(5, 7)
        )}月`;
    }

    if ($("#homeTotalQuantity")) {
      $("#homeTotalQuantity").textContent =
        `${formatNumber(
          quantity
        )}部`;
    }

    if ($("#homeTotalSteps")) {
      $("#homeTotalSteps").textContent =
        `${formatNumber(
          steps
        )}歩`;
    }

    if ($("#homeParticipationCount")) {
      $("#homeParticipationCount").textContent =
        `${formatNumber(
          participations
        )}回`;
    }
  }

  // ============================================================
  // Step 1
  // ============================================================

  function syncStep1() {
    if ($("#postingDate")) {
      state.draft.postingDate =
        $("#postingDate").value;
    }

    if ($("#staffSelect")) {
      state.draft.staffId =
        $("#staffSelect").value;
    }

    if ($("#flyerSelect")) {
      state.draft.flyerId =
        $("#flyerSelect").value;
    }

    state.draft.participantIds =
      $$(
        "#participantList input:checked"
      ).map(
        (input) =>
          input.value
      );
  }

  function validateStep1() {
    syncStep1();

    const participantOk =
      state.draft.participantIds
        .length > 0;

    $("#participantError")
      ?.classList.toggle(
        "is-hidden",
        participantOk
      );

    if (
      !state.masterReady ||
      !state.draft.staffId ||
      !state.draft.flyerId
    ) {
      alert(
        "担当職員またはチラシのマスターを読み込めません。画面を再読み込みしてください。"
      );

      return false;
    }

    return participantOk;
  }

  // ============================================================
  // Posting map
  // ============================================================

  function clearDraftMapGraphics() {
    state.postingMarkers.forEach(
      (marker) =>
        marker.setMap(null)
    );

    state.postingMarkers = [];

    if (state.postingPolygon) {
      state.postingPolygon.setMap(
        null
      );

      state.postingPolygon = null;
    }

    const confirmButton =
      $("#confirmMapButton");

    if (confirmButton) {
      confirmButton.disabled = true;
    }

    $("#overlapWarning")
      ?.classList.add(
        "is-hidden"
      );
  }

  function drawDraftPolygon() {
    if (
      !state.postingMap ||
      !window.google?.maps
    ) {
      return;
    }

    state.postingMarkers.forEach(
      (marker) =>
        marker.setMap(null)
    );

    state.postingMarkers = [];

    if (state.postingPolygon) {
      state.postingPolygon.setMap(
        null
      );
    }

    const path =
      toLatLngPath(
        state.mapPoints
      );

    if (path.length >= 2) {
      state.postingPolygon =
        new google.maps.Polygon({
          paths: path,
          strokeColor: "#2F6D4F",
          strokeOpacity: 1,
          strokeWeight: 3,
          fillColor: "#2F6D4F",
          fillOpacity:
            path.length >= 3
              ? 0.22
              : 0.08,
          map: state.postingMap,
          clickable: false
        });
    } else {
      state.postingPolygon =
        null;
    }

    path.forEach(
      (position, index) => {
        const marker =
          new google.maps.Marker({
            position,
            map:
              state.postingMap,

            label: {
              text: String(
                index + 1
              ),
              color: "#ffffff",
              fontWeight: "700"
            },

            title:
              `頂点 ${index + 1}`
          });

        state.postingMarkers.push(
          marker
        );
      }
    );

    if ($("#confirmMapButton")) {
      $("#confirmMapButton").disabled =
        state.mapPoints.length <
        3;
    }

    updateOverlapWarning();
  }

  function renderPostingHistoryPolygons() {
    state.postingHistoryPolygons.forEach(
      (polygon) =>
        polygon.setMap(null)
    );

    state.postingHistoryPolygons = [];

    if (
      !state.postingMap ||
      !window.google?.maps
    ) {
      return;
    }

    getGeoRecords().forEach(
      (record, index) => {
        const opacity =
          Math.max(
            0.08,
            0.18 -
              index * 0.01
          );

        const polygon =
          new google.maps.Polygon({
            paths:
              toLatLngPath(
                record.area.coordinates
              ),

            strokeColor:
              "#6F7F72",

            strokeOpacity:
              0.55,

            strokeWeight:
              2,

            fillColor:
              "#8BA294",

            fillOpacity:
              opacity,

            map:
              state.postingMap,

            clickable:
              false
          });

        state.postingHistoryPolygons.push(
          polygon
        );
      }
    );
  }

  async function initPostingMap() {
    const statusId =
      "#postingMapStatus";

    try {
      setMapStatus(
        statusId,
        "Google Mapsを読み込み中…"
      );

      await loadGoogleMaps();

      if (!state.postingMap) {
        state.postingMap =
          new google.maps.Map(
            $("#postingGoogleMap"),
            {
              center:
                DEFAULT_CENTER,

              zoom:
                DEFAULT_ZOOM,

              mapTypeControl:
                false,

              streetViewControl:
                false,

              fullscreenControl:
                false,

              clickableIcons:
                false,

              gestureHandling:
                "greedy"
            }
          );

        state.postingMap.addListener(
          "click",
          (event) => {
            state.mapPoints.push([
              event.latLng.lng(),
              event.latLng.lat()
            ]);

            drawDraftPolygon();
          }
        );
      }

      renderPostingHistoryPolygons();
      drawDraftPolygon();

      hideMapStatus(statusId);

      if (!state.mapPoints.length) {
        locateCurrentPosition(false);
      } else {
        fitMapToCoordinates(
          state.postingMap,
          state.mapPoints
        );
      }

      window.setTimeout(
        () =>
          google.maps.event.trigger(
            state.postingMap,
            "resize"
          ),
        50
      );
    } catch (error) {
      console.error(
        "Posting map error.",
        error
      );

      setMapStatus(
        statusId,
        "Google Mapsを表示できませんでした。",
        true
      );

      if ($("#confirmMapButton")) {
        $("#confirmMapButton").disabled =
          true;
      }
    }
  }

  function locateCurrentPosition(
    showError = true
  ) {
    if (
      !navigator.geolocation ||
      !state.postingMap
    ) {
      if (showError) {
        alert(
          "この端末では現在地を取得できません。"
        );
      }

      return;
    }

    const button =
      $("#locateButton");

    if (button) {
      button.disabled = true;
      button.textContent =
        "取得中…";
    }

    navigator.geolocation
      .getCurrentPosition(
        (position) => {
          state.postingMap.setCenter({
            lat:
              position.coords.latitude,

            lng:
              position.coords.longitude
          });

          state.postingMap.setZoom(
            17
          );

          if (button) {
            button.disabled = false;
            button.textContent =
              "◎ 現在地へ";
          }
        },

        () => {
          if (button) {
            button.disabled = false;
            button.textContent =
              "◎ 現在地へ";
          }

          if (showError) {
            alert(
              "現在地を取得できませんでした。位置情報の許可を確認してください。"
            );
          }
        },

        {
          enableHighAccuracy:
            true,

          timeout: 8000,

          maximumAge:
            60000
        }
      );
  }

  // ============================================================
  // Polygon overlap
  // ============================================================

  function pointInPolygon(
    point,
    polygon
  ) {
    const [x, y] = point;

    let inside = false;

    for (
      let i = 0,
        j = polygon.length - 1;
      i < polygon.length;
      j = i++
    ) {
      const [xi, yi] =
        polygon[i];

      const [xj, yj] =
        polygon[j];

      const intersects =
        (
          (yi > y) !==
          (yj > y)
        ) &&
        (
          x <
          ((xj - xi) *
            (y - yi)) /
            (
              (yj - yi) ||
              Number.EPSILON
            ) +
            xi
        );

      if (intersects) {
        inside = !inside;
      }
    }

    return inside;
  }

  function orientation(a, b, c) {
    const value =
      (b[1] - a[1]) *
        (c[0] - b[0]) -
      (b[0] - a[0]) *
        (c[1] - b[1]);

    if (
      Math.abs(value) <
      1e-12
    ) {
      return 0;
    }

    return value > 0
      ? 1
      : 2;
  }

  function segmentsIntersect(
    p1,
    q1,
    p2,
    q2
  ) {
    const o1 =
      orientation(
        p1,
        q1,
        p2
      );

    const o2 =
      orientation(
        p1,
        q1,
        q2
      );

    const o3 =
      orientation(
        p2,
        q2,
        p1
      );

    const o4 =
      orientation(
        p2,
        q2,
        q1
      );

    return (
      o1 !== o2 &&
      o3 !== o4
    );
  }

  function polygonsOverlap(a, b) {
    if (
      a.some(
        (point) =>
          pointInPolygon(
            point,
            b
          )
      ) ||
      b.some(
        (point) =>
          pointInPolygon(
            point,
            a
          )
      )
    ) {
      return true;
    }

    for (
      let i = 0;
      i < a.length;
      i++
    ) {
      const a1 = a[i];

      const a2 =
        a[
          (i + 1) %
            a.length
        ];

      for (
        let j = 0;
        j < b.length;
        j++
      ) {
        const b1 = b[j];

        const b2 =
          b[
            (j + 1) %
              b.length
          ];

        if (
          segmentsIntersect(
            a1,
            a2,
            b1,
            b2
          )
        ) {
          return true;
        }
      }
    }

    return false;
  }

  function updateOverlapWarning() {
    const warning =
      $("#overlapWarning");

    if (!warning) {
      return;
    }

    if (
      state.mapPoints.length <
      3
    ) {
      warning.classList.add(
        "is-hidden"
      );
      return;
    }

    const overlapped =
      getGeoRecords().find(
        (record) =>
          polygonsOverlap(
            state.mapPoints,
            record.area.coordinates
          )
      );

    if (overlapped) {
      warning.innerHTML =
        `⚠ この範囲は過去の配布履歴と重なっています` +
        `<br>` +
        `<small>` +
        `${escapeHtml(
          overlapped.postingDate
        )}・` +
        `${formatNumber(
          overlapped.quantity
        )}部` +
        `</small>`;

      warning.classList.remove(
        "is-hidden"
      );
    } else {
      warning.classList.add(
        "is-hidden"
      );
    }
  }

  // ============================================================
  // Step 3
  // ============================================================

  function renderResultStep() {
    const participantSteps =
      $("#participantSteps");

    if (!participantSteps) {
      return;
    }

    participantSteps.innerHTML =
      state.draft.participantIds
        .map(
          (id) => `
            <div class="participant-step-card">
              <strong>
                ${escapeHtml(
                  names.participant(id)
                )}
              </strong>

              <div class="number-input">
                <input
                  class="input js-step-input"
                  type="number"
                  min="1"
                  inputmode="numeric"
                  placeholder="歩数"
                  data-id="${escapeHtml(
                    id
                  )}"
                  value="${
                    state.draft
                      .participantSteps[
                        id
                      ] ||
                    ""
                  }"
                >

                <span>
                  歩
                </span>
              </div>
            </div>
          `
        )
        .join("");

    $$(".js-step-input").forEach(
      (input) => {
        input.addEventListener(
          "input",
          () => {
            state.draft
              .participantSteps[
                input.dataset.id
              ] =
              Number(
                input.value ||
                0
              );

            renderConfirm();
          }
        );
      }
    );

    if ($("#quantityInput")) {
      $("#quantityInput").value =
        state.draft.quantity ||
        "";
    }

    renderConfirm();
  }

  function renderConfirm() {
    if ($("#quantityInput")) {
      state.draft.quantity =
        Number(
          $("#quantityInput").value ||
          0
        );
    }

    const steps =
      state.draft.participantIds
        .map(
          (id) =>
            `${escapeHtml(
              names.participant(id)
            )} ` +
            `${formatNumber(
              state.draft
                .participantSteps[
                  id
                ] ||
              0
            )}歩`
        )
        .join("<br>");

    const confirmContent =
      $("#confirmContent");

    if (confirmContent) {
      confirmContent.innerHTML =
        `
          <div class="confirm-row">
            <span>配布日</span>
            <b>
              ${escapeHtml(
                state.draft.postingDate
              )}
            </b>
          </div>

          <div class="confirm-row">
            <span>担当職員</span>
            <b>
              ${escapeHtml(
                names.staff(
                  state.draft.staffId
                )
              )}
            </b>
          </div>

          <div class="confirm-row">
            <span>参加利用者</span>
            <b>
              ${
                state.draft
                  .participantIds
                  .map(
                    (id) =>
                      escapeHtml(
                        names.participant(
                          id
                        )
                      )
                  )
                  .join("・")
              }
            </b>
          </div>

          <div class="confirm-row">
            <span>チラシ</span>
            <b>
              ${escapeHtml(
                names.flyer(
                  state.draft.flyerId
                )
              )}
            </b>
          </div>

          <div class="confirm-row">
            <span>配布部数</span>
            <b>
              ${formatNumber(
                state.draft.quantity
              )}部
            </b>
          </div>

          <div class="confirm-row">
            <span>歩数</span>
            <b>
              ${steps}
            </b>
          </div>
        `;
    }

    window.setTimeout(
      renderConfirmMapPreview,
      0
    );
  }

  async function renderConfirmMapPreview() {
    if (
      !state.draft.area
        ?.coordinates
        ?.length
    ) {
      return;
    }

    try {
      await loadGoogleMaps();

      if (!state.confirmMap) {
        state.confirmMap =
          new google.maps.Map(
            $("#confirmGoogleMap"),
            {
              center:
                DEFAULT_CENTER,

              zoom:
                DEFAULT_ZOOM,

              disableDefaultUI:
                true,

              gestureHandling:
                "none",

              clickableIcons:
                false
            }
          );
      }

      if (state.confirmPolygon) {
        state.confirmPolygon.setMap(
          null
        );
      }

      state.confirmPolygon =
        new google.maps.Polygon({
          paths:
            toLatLngPath(
              state.draft.area
                .coordinates
            ),

          strokeColor:
            "#2F6D4F",

          strokeOpacity:
            1,

          strokeWeight:
            2,

          fillColor:
            "#2F6D4F",

          fillOpacity:
            0.22,

          map:
            state.confirmMap,

          clickable:
            false
        });

      fitMapToCoordinates(
        state.confirmMap,
        state.draft.area.coordinates
      );

      window.setTimeout(
        () =>
          google.maps.event.trigger(
            state.confirmMap,
            "resize"
          ),
        50
      );
    } catch (error) {
      console.error(
        "Confirm map error.",
        error
      );
    }
  }

  // ============================================================
  // Save
  // ============================================================

  async function saveRecord() {
    const saveButton =
      $("#saveRecordButton");

    if (
      !saveButton ||
      saveButton.disabled
    ) {
      return;
    }

    saveButton.disabled = true;
    saveButton.textContent =
      "保存しています…";

    state.draft.quantity =
      Number(
        $("#quantityInput")?.value ||
        0
      );

    const validQuantity =
      state.draft.quantity > 0;

    const validSteps =
      state.draft.participantIds
        .every(
          (id) =>
            Number(
              state.draft
                .participantSteps[
                  id
                ] ||
              0
            ) > 0
        );

    if (
      !validQuantity ||
      !validSteps
    ) {
      alert(
        "配布部数と参加した人全員の歩数を入力してください。"
      );

      saveButton.disabled = false;
      saveButton.textContent =
        "この内容で登録する";

      return;
    }

    const record = {
      id:
        "P-" +
        Date.now(),

      postingDate:
        state.draft.postingDate,

      staffId:
        state.draft.staffId,

      flyerId:
        state.draft.flyerId,

      quantity:
        state.draft.quantity,

      participants:
        state.draft.participantIds
          .map(
            (id) => ({
              participantId:
                id,

              steps:
                Number(
                  state.draft
                    .participantSteps[
                      id
                    ]
                )
            })
          ),

      area:
        state.draft.area,

      createdAt:
        new Date().toISOString()
    };

    try {
      const result =
        await dataRepository.add(
          record
        );

      result.record.storageMode =
        result.mode;

      state.lastSavedRecord =
        result.record;

      navigate("success");
    } catch (error) {
      console.error(
        "Save failed.",
        error
      );

      if (
        error.message ===
        "LOGIN_REQUIRED"
      ) {
        alert(
          "Googleログインが必要です。"
        );
      } else {
        alert(
          "保存中にエラーが発生しました。"
        );
      }
    }

    saveButton.disabled = false;
    saveButton.textContent =
      "この内容で登録する";
  }

  // ============================================================
  // Success
  // ============================================================

  function renderSuccess() {
    const record =
      state.lastSavedRecord;

    if (!record) {
      return;
    }

    if ($("#successQuantity")) {
      $("#successQuantity").textContent =
        `${formatNumber(
          record.quantity
        )}部`;
    }

    const savedAt =
      new Date(
        record.createdAt
      );

    const savedAtText =
      Number.isNaN(
        savedAt.getTime()
      )
        ? ""
        : savedAt.toLocaleString(
            "ja-JP",
            {
              year: "numeric",
              month: "numeric",
              day: "numeric",
              hour: "2-digit",
              minute: "2-digit"
            }
          );

    if ($("#successMeta")) {
      $("#successMeta").innerHTML =
        `
          <div class="confirm-row">
            <span>保存状態</span>
            <b>✓ 保存済み</b>
          </div>

          <div class="confirm-row">
            <span>保存先</span>
            <b>
              ${
                record.storageMode ===
                "firestore"
                  ? "Firestore（共有）"
                  : "この端末（一時保存・同期待ち）"
              }
            </b>
          </div>

          <div class="confirm-row">
            <span>配布日</span>
            <b>
              ${escapeHtml(
                record.postingDate
              )}
            </b>
          </div>

          <div class="confirm-row">
            <span>担当職員</span>
            <b>
              ${escapeHtml(
                names.staff(
                  record.staffId
                )
              )}
            </b>
          </div>

          <div class="confirm-row">
            <span>チラシ</span>
            <b>
              ${escapeHtml(
                names.flyer(
                  record.flyerId
                )
              )}
            </b>
          </div>

          <div class="confirm-row">
            <span>保存日時</span>
            <b>
              ${escapeHtml(
                savedAtText
              )}
            </b>
          </div>
        `;
    }

    if ($("#successParticipants")) {
      $("#successParticipants").innerHTML =
        (
          record.participants ||
          []
        )
          .map(
            (participant) =>
              `
                <div class="participant-result">
                  ${escapeHtml(
                    names.participant(
                      participant.participantId
                    )
                  )}

                  <b>
                    🚶
                    ${formatNumber(
                      participant.steps
                    )}歩
                  </b>
                </div>
              `
          )
          .join("");
    }
  }

  // ============================================================
  // History
  // ============================================================

  function renderHistory() {
    const records =
      dataRepository
        .load()
        .sort(
          (a, b) =>
            (b.postingDate || "")
              .localeCompare(
                a.postingDate || ""
              )
        );

    $("#historyEmpty")
      ?.classList.toggle(
        "is-hidden",
        records.length > 0
      );

    if ($("#historyList")) {
      $("#historyList").innerHTML =
        records
          .map(
            (record) => `
              <article class="history-item">
                <b>
                  ${escapeHtml(
                    record.postingDate
                  )}
                  　
                  ${formatNumber(
                    record.quantity
                  )}部
                </b>

                <small>
                  ${escapeHtml(
                    names.staff(
                      record.staffId
                    )
                  )}
                  <br>

                  ${
                    (
                      record.participants ||
                      []
                    )
                      .map(
                        (participant) =>
                          escapeHtml(
                            names.participant(
                              participant
                                .participantId
                            )
                          )
                      )
                      .join("・")
                  }

                  <br>

                  ${escapeHtml(
                    names.flyer(
                      record.flyerId
                    )
                  )}
                </small>
              </article>
            `
          )
          .join("");
    }
  }

  // ============================================================
  // Distribution status
  // ============================================================

  async function renderMapStatus() {
    const records =
      dataRepository.load();

    if ($("#mapStatusList")) {
      $("#mapStatusList").innerHTML =
        records
          .map(
            (record) => `
              <article class="history-item">
                <b>
                  ${escapeHtml(
                    record.postingDate
                  )}
                  　
                  ${formatNumber(
                    record.quantity
                  )}部
                </b>

                <small>
                  ${escapeHtml(
                    names.flyer(
                      record.flyerId
                    )
                  )}
                </small>
              </article>
            `
          )
          .join("");
    }

    const statusId =
      "#historyMapStatus";

    try {
      setMapStatus(
        statusId,
        "Google Mapsを読み込み中…"
      );

      await loadGoogleMaps();

      if (!state.historyMap) {
        state.historyMap =
          new google.maps.Map(
            $("#historyGoogleMap"),
            {
              center:
                DEFAULT_CENTER,

              zoom:
                DEFAULT_ZOOM,

              mapTypeControl:
                false,

              streetViewControl:
                false,

              fullscreenControl:
                false,

              clickableIcons:
                false
            }
          );
      }

      state.historyPolygons.forEach(
        (polygon) =>
          polygon.setMap(null)
      );

      state.historyPolygons = [];

      const geoRecords =
        getGeoRecords();

      const allCoordinates = [];

      geoRecords.forEach(
        (record, index) => {
          allCoordinates.push(
            ...record.area.coordinates
          );

          const opacity =
            Math.max(
              0.08,
              0.24 -
                index * 0.015
            );

          const polygon =
            new google.maps.Polygon({
              paths:
                toLatLngPath(
                  record.area.coordinates
                ),

              strokeColor:
                "#2F6D4F",

              strokeOpacity:
                0.85,

              strokeWeight:
                2,

              fillColor:
                "#2F6D4F",

              fillOpacity:
                opacity,

              map:
                state.historyMap,

              clickable:
                false
            });

          state.historyPolygons.push(
            polygon
          );
        }
      );

      if (allCoordinates.length) {
        fitMapToCoordinates(
          state.historyMap,
          allCoordinates
        );
      }

      hideMapStatus(statusId);

      window.setTimeout(
        () =>
          google.maps.event.trigger(
            state.historyMap,
            "resize"
          ),
        50
      );
    } catch (error) {
      console.error(
        "History map error.",
        error
      );

      setMapStatus(
        statusId,
        "Google Mapsを表示できませんでした。",
        true
      );
    }
  }

  // ============================================================
  // Monthly report selector / preview
  // Phase MR-2
  // ============================================================

  function formatYmJa(ym) {
    if (
      typeof ym !== "string" ||
      !/^\d{4}-\d{2}$/.test(ym)
    ) {
      return ym || "";
    }

    return `${Number(
      ym.slice(0, 4)
    )}年${Number(
      ym.slice(5, 7)
    )}月`;
  }

  function getMonthlyReportParticipants(
    targetYm
  ) {
    const monthlyReport =
      window.SeedStudioMonthlyReport;

    if (
      !monthlyReport ||
      !targetYm
    ) {
      return [];
    }

    const ids =
      new Set();

    dataRepository
      .load()
      .forEach(
        (record) => {
          if (
            !monthlyReport
              .isValidIsoDate(
                record?.postingDate
              ) ||
            record.postingDate
              .slice(0, 7) !==
              targetYm
          ) {
            return;
          }

          (
            Array.isArray(
              record.participants
            )
              ? record.participants
              : []
          ).forEach(
            (participant) => {
              const participantId =
                participant
                  ?.participantId;

              if (
                typeof participantId ===
                  "string" &&
                participantId.trim()
              ) {
                ids.add(
                  participantId.trim()
                );
              }
            }
          );
        }
      );

    return [...ids]
      .map(
        (participantId) => ({
          participantId,

          name:
            names.participant(
              participantId
            )
        })
      )
      .sort(
        (a, b) =>
          String(
            a.name || ""
          ).localeCompare(
            String(
              b.name || ""
            ),
            "ja"
          )
      );
  }

  function hideMonthlyReportPreview() {
    $("#monthlyReportPreview")
      ?.classList.add(
        "is-hidden"
      );
  }

  function renderMonthlyReportParticipantSelect() {
    const monthInput =
      $("#monthlyReportMonthInput");

    const select =
      $("#monthlyReportParticipantSelect");

    const empty =
      $("#monthlyReportParticipantEmpty");

    const previewButton =
      $("#monthlyReportPreviewButton");

    if (
      !monthInput ||
      !select
    ) {
      return;
    }

    const targetYm =
      monthInput.value ||
      currentYm();

    if (!monthInput.value) {
      monthInput.value =
        targetYm;
    }

    const previous =
      select.value;

    const participants =
      getMonthlyReportParticipants(
        targetYm
      );

    select.innerHTML =
      participants
        .map(
          (person) =>
            `<option value="${escapeHtml(
              person.participantId
            )}">${escapeHtml(
              person.name
            )}</option>`
        )
        .join("");

    if (
      previous &&
      participants.some(
        (person) =>
          person.participantId ===
          previous
      )
    ) {
      select.value =
        previous;
    }

    const hasParticipants =
      participants.length > 0;

    select.disabled =
      !hasParticipants;

    if (previewButton) {
      previewButton.disabled =
        !hasParticipants;
    }

    empty?.classList.toggle(
      "is-hidden",
      hasParticipants
    );

    hideMonthlyReportPreview();
  }

  function initializeMonthlyReportSelection() {
    const monthInput =
      $("#monthlyReportMonthInput");

    if (!monthInput) {
      return;
    }

    if (!monthInput.value) {
      monthInput.value =
        currentYm();
    }

    renderMonthlyReportParticipantSelect();
  }

  function renderMonthlyReportPreview() {
    const monthlyReport =
      window.SeedStudioMonthlyReport;

    const targetYm =
      $("#monthlyReportMonthInput")
        ?.value ||
      "";

    const participantId =
      $("#monthlyReportParticipantSelect")
        ?.value ||
      "";

    if (
      !monthlyReport ||
      !targetYm ||
      !participantId
    ) {
      hideMonthlyReportPreview();
      return;
    }

    let stats;

    try {
      stats =
        monthlyReport
          .buildMonthlyReportStats(
            dataRepository.load(),
            participantId,
            targetYm
          );
    } catch (error) {
      console.error(
        "Monthly report aggregation failed.",
        error
      );

      alert(
        "月間成果を集計できませんでした。"
      );

      return;
    }

    if (
      stats.monthly
        .participationDays <=
      0
    ) {
      hideMonthlyReportPreview();

      alert(
        "この月のポスティング実績はありません。"
      );

      return;
    }

    const participantName =
      names.participant(
        participantId
      );

    if ($("#monthlyReportPreviewTitle")) {
      $("#monthlyReportPreviewTitle").textContent =
        `${participantName}さん・${formatYmJa(
          targetYm
        )}`;
    }

    if ($("#monthlyReportSteps")) {
      $("#monthlyReportSteps").textContent =
        `${formatNumber(
          stats.monthly.steps
        )}歩`;
    }

    if ($("#monthlyReportDays")) {
      $("#monthlyReportDays").textContent =
        `${formatNumber(
          stats.monthly
            .participationDays
        )}日`;
    }

    if ($("#monthlyReportAverage")) {
      $("#monthlyReportAverage").textContent =
        `${formatNumber(
          stats.monthly
            .averageDailySteps
        )}歩`;
    }

    if ($("#monthlyReportBest")) {
      $("#monthlyReportBest").textContent =
        `${formatNumber(
          stats.monthly
            .bestDailySteps
        )}歩`;
    }

    if ($("#monthlyReportCalories")) {
      $("#monthlyReportCalories").textContent =
        `約${formatNumber(
          stats.monthly.calories
        )}kcal`;
    }

    if ($("#monthlyReportQuantity")) {
      $("#monthlyReportQuantity").textContent =
        `${formatNumber(
          stats.monthly
            .relatedQuantity
        )}部`;
    }

    const previousRow =
      $("#monthlyReportPreviousRow");

    if (previousRow) {
      if (
        stats.previousMonth
          .hasActivity
      ) {
        const difference =
          stats.previousMonth
            .difference;

        previousRow.textContent =
          `前月比：${
            difference > 0
              ? "+"
              : ""
          }${formatNumber(
            difference
          )}歩`;

        previousRow.classList.remove(
          "is-hidden"
        );
      } else {
        previousRow.classList.add(
          "is-hidden"
        );
      }
    }

    if ($("#monthlyReportLifetimeRow")) {
      $("#monthlyReportLifetimeRow").textContent =
        `対象月末までの累計：${formatNumber(
          stats.lifetime.steps
        )}歩・${formatNumber(
          stats.lifetime
            .participationDays
        )}日参加`;
    }

    if ($("#monthlyReportMilestoneRow")) {
      const newlyAchieved =
        stats.milestones
          .newlyAchieved;

      if (
        newlyAchieved.length
      ) {
        $("#monthlyReportMilestoneRow").textContent =
          `今月達成：${newlyAchieved
            .map(
              (goal) =>
                `${formatNumber(
                  goal
                )}歩`
            )
            .join("・")}`;
      } else if (
        stats.milestones
          .nextGoal
      ) {
        $("#monthlyReportMilestoneRow").textContent =
          `次の目標：${formatNumber(
            stats.milestones
              .nextGoal
          )}歩`;
      } else {
        $("#monthlyReportMilestoneRow").textContent =
          "すべてのマイルストーンを達成しています！";
      }
    }

    $("#monthlyReportPreview")
      ?.classList.remove(
        "is-hidden"
      );
  }



  // ============================================================
  // Achievements
  // ============================================================

  function renderAchievements() {
    const select =
      $("#achievementParticipantSelect");

    const participantId =
      select?.value ||
      state.postingParticipants[0]
        ?.personId ||
      state.participantCandidates[0]
        ?.personId ||
      "";

    const ym =
      currentYm();

    const records =
      dataRepository
        .load()
        .filter(
          (record) =>
            (
              record.participants ||
              []
            ).some(
              (participant) =>
                participant.participantId ===
                participantId
            )
        );

    const totalSteps =
      records.reduce(
        (total, record) => {
          const participant =
            (
              record.participants ||
              []
            ).find(
              (item) =>
                item.participantId ===
                participantId
            );

          return (
            total +
            Number(
              participant?.steps ||
              0
            )
          );
        },
        0
      );

    const monthSteps =
      records
        .filter(
          (record) =>
            (
              record.postingDate ||
              ""
            ).startsWith(ym)
        )
        .reduce(
          (total, record) => {
            const participant =
              (
                record.participants ||
                []
              ).find(
                (item) =>
                  item.participantId ===
                  participantId
              );

            return (
              total +
              Number(
                participant?.steps ||
                0
              )
            );
          },
          0
        );

    const totalCalories =
      caloriesFromSteps(
        totalSteps
      );

    const monthCalories =
      caloriesFromSteps(
        monthSteps
      );

    const totalQuantity =
      records.reduce(
        (total, record) =>
          total +
          Number(
            record.quantity ||
            0
          ),
        0
      );

    const best =
      Math.max(
        0,
        ...records.map(
          (record) =>
            Number(
              (
                record.participants ||
                []
              ).find(
                (participant) =>
                  participant.participantId ===
                  participantId
              )?.steps ||
              0
            )
        )
      );

    const nextGoal =
      milestoneSteps.find(
        (goal) =>
          goal > totalSteps
      ) ||
      milestoneSteps[
        milestoneSteps.length - 1
      ];

    const previousGoal =
      [...milestoneSteps]
        .reverse()
        .find(
          (goal) =>
            goal <= totalSteps
        ) ||
      0;

    const progress =
      Math.min(
        100,
        Math.max(
          0,
          (
            (totalSteps -
              previousGoal) /
            Math.max(
              1,
              nextGoal -
                previousGoal
            )
          ) *
            100
        )
      );

    const remaining =
      Math.max(
        0,
        nextGoal - totalSteps
      );

    if ($("#achievementMonthSteps")) {
      $("#achievementMonthSteps").textContent =
        formatNumber(
          monthSteps
        );
    }

    if ($("#achievementMonthCalories")) {
      $("#achievementMonthCalories").textContent =
        formatNumber(
          monthCalories
        );
    }

    if ($("#achievementTotalSteps")) {
      $("#achievementTotalSteps").textContent =
        `${formatNumber(
          totalSteps
        )}歩`;
    }

    if ($("#achievementTotalCalories")) {
      $("#achievementTotalCalories").textContent =
        `約${formatNumber(
          totalCalories
        )}kcal`;
    }

    if ($("#achievementCount")) {
      $("#achievementCount").textContent =
        `${records.length}回`;
    }

    if ($("#achievementQuantity")) {
      $("#achievementQuantity").textContent =
        `${formatNumber(
          totalQuantity
        )}部`;
    }

    if ($("#achievementBest")) {
      $("#achievementBest").textContent =
        `${formatNumber(
          best
        )}歩`;
    }

    if ($("#achievementGoalMessage")) {
      $("#achievementGoalMessage").textContent =
        `🌳 ${formatNumber(
          nextGoal
        )}歩まであと${formatNumber(
          remaining
        )}歩！`;
    }

    if ($("#achievementProgressFill")) {
      $("#achievementProgressFill").style.width =
        `${progress}%`;
    }

    if ($("#achievementPercent")) {
      $("#achievementPercent").textContent =
        `${Math.round(
          progress
        )}%`;
    }

    const dailyList =
      $("#achievementDailyList");

    const dailyEmpty =
      $("#achievementDailyEmpty");

    const dailyRecords =
      [...records].sort(
        (a, b) =>
          (b.postingDate || "")
            .localeCompare(
              a.postingDate || ""
            )
      );

    if (dailyList) {
      dailyList.innerHTML =
        dailyRecords
          .map(
            (record) => {
              const participant =
                (
                  record.participants ||
                  []
                ).find(
                  (item) =>
                    item.participantId ===
                    participantId
                );

              const steps =
                Number(
                  participant?.steps ||
                  0
                );

              const calories =
                caloriesFromSteps(
                  steps
                );

              return `
                <article class="history-item">
                  <b>
                    ${escapeHtml(
                      record.postingDate
                    )}
                  </b>

                  <small
                    style="
                      display:block;
                      margin-top:5px;
                    "
                  >
                    👣 ${formatNumber(
                      steps
                    )}歩
                    　
                    🔥 約${formatNumber(
                      calories
                    )}kcal
                  </small>
                </article>
              `;
            }
          )
          .join("");
    }

    dailyEmpty?.classList.toggle(
      "is-hidden",
      dailyRecords.length > 0
    );

    if ($("#milestoneRow")) {
      $("#milestoneRow").innerHTML =
        milestoneSteps
          .map(
            (goal) => `
              <div
                class="
                  milestone
                  ${
                    totalSteps >= goal
                      ? "is-achieved"
                      : "is-locked"
                  }
                "
              >
                <div>
                  ${
                    totalSteps >= goal
                      ? "🌱"
                      : "○"
                  }
                </div>

                <div>
                  ${formatNumber(
                    goal
                  )}歩
                </div>
              </div>
            `
          )
          .join("");
    }
  }

  // ============================================================
  // Authentication actions
  // ============================================================

  async function handleLogin() {
    try {
      if (!window.SeedStudioAuth) {
        throw new Error(
          "Firebase Auth is not ready."
        );
      }

      const authState =
        await window.SeedStudioAuth
          .signIn();

      state.authState =
        authState;

      renderAuthState();

      if (!authState.authorized) {
        alert(
          "Googleログインはできましたが、このアカウントはSeedStudio職員として登録されていません。"
        );

        return;
      }

      try {
        await Promise.all([
          dataRepository
            .reloadFromFirestore(),

          participantRepository
            .reload(),

          masterRepository
            .reload()
        ]);

        renderHome();

        alert(
          "Googleログインが完了しました。"
        );
      } catch (error) {
        console.error(
          "Firestore read failed.",
          error
        );

        alert(
          "Googleログインは成功しました。Firestoreの読み取り権限を確認してください。"
        );
      }
    } catch (error) {
      console.error(
        "Login failed.",
        error
      );

      alert(
        "Googleログインを完了できませんでした。"
      );
    }
  }

  async function handleLogout() {
    try {
      if (window.SeedStudioAuth) {
        await window.SeedStudioAuth.signOut();
      }
    } catch (error) {
      console.error(
        "Logout failed.",
        error
      );
    }

    state.authState = {
      signedIn: false,
      authorized: false,
      user: null,
      staff: null
    };

    state.participantCandidates = [];
    state.participantDirectory = [];
    state.postingParticipants = [];
    state.masterReady = false;
    state.masterError = null;

    dataRepository.mode =
      "auth-required";

    dataRepository.cache =
      dataRepository.loadLocal();

    renderAuthState();
    renderParticipantUI();
    renderHome();
    navigate("home");
  }

  // ============================================================
  // Events
  // ============================================================

  function bindEvents() {
    $("#googleLoginButton")
      ?.addEventListener(
        "click",
        handleLogin
      );

    $("#googleLogoutButton")
      ?.addEventListener(
        "click",
        handleLogout
      );

    $$("[data-nav]").forEach(
      (button) => {
        button.addEventListener(
          "click",
          () => {
            if (button.disabled) {
              return;
            }

            if (
              button.dataset.nav ===
              "register-basic"
            ) {
              resetDraft();
            }

            navigate(
              button.dataset.nav
            );
          }
        );
      }
    );

    $("#backButton")
      ?.addEventListener(
        "click",
        goBack
      );

    $("#participantList")
      ?.addEventListener(
        "change",
        (event) => {
          if (
            !event.target.matches(
              "input"
            )
          ) {
            return;
          }

          event.target
            .closest(
              ".checkbox-row"
            )
            ?.classList.toggle(
              "is-selected",
              event.target.checked
            );

          syncStep1();
        }
      );

    $("#addPostingParticipantButton")
      ?.addEventListener(
        "click",
        openParticipantManager
      );

    $("#closePostingParticipantManagerButton")
      ?.addEventListener(
        "click",
        () => {
          renderParticipantList();
          navigate(
            "register-basic"
          );
        }
      );

    $("#postingParticipantSearch")
      ?.addEventListener(
        "input",
        renderParticipantManagerCandidates
      );

    $("#postingParticipantCandidateList")
      ?.addEventListener(
        "click",
        async (event) => {
          const button =
            event.target.closest(
              ".js-add-posting-participant"
            );

          if (!button) {
            return;
          }

          await handleParticipantToggle(
            button.dataset.personId,
            true,
            button
          );
        }
      );

    $("#postingParticipantCurrentList")
      ?.addEventListener(
        "click",
        async (event) => {
          const button =
            event.target.closest(
              ".js-remove-posting-participant"
            );

          if (!button) {
            return;
          }

          await handleParticipantToggle(
            button.dataset.personId,
            false,
            button
          );
        }
      );

    $("#goToMapButton")
      ?.addEventListener(
        "click",
        () => {
          if (validateStep1()) {
            navigate(
              "register-map"
            );
          }
        }
      );

    $("#locateButton")
      ?.addEventListener(
        "click",
        () =>
          locateCurrentPosition(
            true
          )
      );

    $("#undoPointButton")
      ?.addEventListener(
        "click",
        () => {
          state.mapPoints.pop();
          drawDraftPolygon();
        }
      );

    $("#resetMapButton")
      ?.addEventListener(
        "click",
        () => {
          state.mapPoints = [];
          clearDraftMapGraphics();
        }
      );

    $("#confirmMapButton")
      ?.addEventListener(
        "click",
        () => {
          if (
            state.mapPoints.length <
            3
          ) {
            return;
          }

          state.draft.area = {
            type:
              "Polygon",

            coordinates:
              state.mapPoints.map(
                ([lng, lat]) => [
                  lng,
                  lat
                ]
              )
          };

          navigate(
            "register-result"
          );
        }
      );

    $("#quantityInput")
      ?.addEventListener(
        "input",
        renderConfirm
      );

    $("#saveRecordButton")
      ?.addEventListener(
        "click",
        saveRecord
      );

    $("#viewHistoryButton")
      ?.addEventListener(
        "click",
        () =>
          navigate("history")
      );

    $("#registerAnotherButton")
      ?.addEventListener(
        "click",
        () => {
          resetDraft();
          navigate(
            "register-basic"
          );
        }
      );

    $("#achievementParticipantSelect")
      ?.addEventListener(
        "change",
        renderAchievements
      );

    $("#monthlyReportMonthInput")
      ?.addEventListener(
        "change",
        renderMonthlyReportParticipantSelect
      );

    $("#monthlyReportParticipantSelect")
      ?.addEventListener(
        "change",
        hideMonthlyReportPreview
      );

    $("#monthlyReportPreviewButton")
      ?.addEventListener(
        "click",
        renderMonthlyReportPreview
      );



    window.addEventListener(
      "online",
      async () => {
        if (
          !state.authState.authorized
        ) {
          return;
        }

        try {
          const result =
            await dataRepository
              .syncPending();

          if (
            result.synced > 0
          ) {
            renderHome();
            renderHistory();
            renderAchievements();
          }
        } catch (error) {
          console.warn(
            "Online pending sync failed.",
            error
          );
        }
      }
    );
  }

  // ============================================================
  // Auth observer
  // ============================================================

  function startAuthObserver() {
    if (!window.SeedStudioAuth) {
      return;
    }

    window.SeedStudioAuth.observe(
      async (authState) => {
        const previousUid =
          state.authState
            ?.user
            ?.uid;

        state.authState =
          authState;

        renderAuthState();

        if (
          authState.authorized &&
          authState.user?.uid &&
          authState.user.uid !==
            previousUid
        ) {
          try {
            await Promise.all([
              dataRepository
                .reloadFromFirestore(),

              participantRepository
                .reload(),

              masterRepository
                .reload()
            ]);

            renderHome();
          } catch (error) {
            console.warn(
              "Firestore reload after auth failed.",
              error
            );
          }
        }
      }
    );
  }

  // ============================================================
  // Initialization
  // ============================================================

  async function init() {
    console.log(
      "SeedStudio Posting initializing..."
    );

    renderMasters();
    resetDraft();
    bindEvents();

    setRegistrationAvailability(
      false
    );

    try {
      await dataRepository.initialize();
    } catch (error) {
      console.error(
        "Repository initialization error.",
        error
      );

      showAuthError(
        "認証状態の確認に失敗しました。"
      );
    }

    startAuthObserver();

    renderAuthState();
    renderParticipantUI();
    renderHome();
    navigate("home");

    console.log(
      "SeedStudio Posting ready."
    );
  }

  document.addEventListener(
    "DOMContentLoaded",
    () => {
      init().catch(
        (error) => {
          console.error(
            "SeedStudio Posting initialization failed.",
            error
          );

          state.authState = {
            signedIn: false,
            authorized: false,
            user: null,
            staff: null
          };

          showAuthError(
            "初期化に失敗しました。"
          );

          renderHome();
          navigate("home");
        }
      );
    }
  );
})();