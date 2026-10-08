(() => {
  "use strict";

  // ============================================================
  // SeedStudio Posting
  // app.js
  // ============================================================

  const STORAGE_KEY =
    "seedstudio-posting-v0.1-records";

  const DEFAULT_CENTER = {
    lat: 35.6074,
    lng: 140.1065
  };

  const DEFAULT_ZOOM = 14;


  // ============================================================
  // Temporary master data
  // Later: move to Firestore master collections
  // ============================================================

  const master = {
    staff: [
      {
        id: "S0001",
        name: "大久保 和恵"
      },
      {
        id: "S0002",
        name: "宮 麻衣子"
      },
      {
        id: "S0003",
        name: "鈴木 由香"
      },
      {
        id: "S0004",
        name: "小野 瑞季"
      },
      {
        id: "S0005",
        name: "番場 みづい"
      }
    ],

    participants: [
      {
        id: "U0001",
        name: "Aさん"
      },
      {
        id: "U0002",
        name: "Bさん"
      },
      {
        id: "U0003",
        name: "Cさん"
      }
    ],

    flyers: [
      {
        id: "F0001",
        name: "SeedStudio 事業所案内 2026-10"
      }
    ]
  };


  // ============================================================
  // State
  // ============================================================

  const state = {
    currentView: "home",

    authState: {
      signedIn: false,
      authorized: false,
      user: null,
      staff: null
    },

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


  // ============================================================
  // DOM helpers
  // ============================================================

  const $ = (selector) =>
    document.querySelector(selector);

  const $$ = (selector) =>
    [...document.querySelectorAll(selector)];


  // ============================================================
  // Name helpers
  // ============================================================

  const names = {
    staff(id) {
      return (
        master.staff.find(
          (item) => item.id === id
        )?.name || id
      );
    },

    participant(id) {
      return (
        master.participants.find(
          (item) => item.id === id
        )?.name || id
      );
    },

    flyer(id) {
      return (
        master.flyers.find(
          (item) => item.id === id
        )?.name || id
      );
    }
  };


  // ============================================================
  // Generic helpers
  // ============================================================

  function todayIso() {
    const now = new Date();

    const local =
      new Date(
        now.getTime() -
        now.getTimezoneOffset() * 60000
      );

    return local
      .toISOString()
      .slice(0, 10);
  }


  function currentYm() {
    return todayIso().slice(0, 7);
  }


  function formatNumber(value) {
    return Number(
      value || 0
    ).toLocaleString("ja-JP");
  }


  function sleep(ms) {
    return new Promise(
      (resolve) =>
        setTimeout(resolve, ms)
    );
  }


  // ============================================================
  // Authentication UI
  // ============================================================

  function setRegistrationAvailability(
    enabled
  ) {
    const button =
      document.querySelector(
        '[data-nav="register-basic"]'
      );

    if (!button) {
      return;
    }

    button.disabled =
      !enabled;

    button.style.opacity =
      enabled
        ? "1"
        : "0.55";
  }


  function renderAuthState() {
    const auth =
      state.authState;

    const loading =
      $("#authLoading");

    const signedOut =
      $("#authSignedOut");

    const signedIn =
      $("#authSignedIn");

    if (
      !loading ||
      !signedOut ||
      !signedIn
    ) {
      return;
    }

    loading.classList.add(
      "is-hidden"
    );

    if (!auth.signedIn) {
      signedOut.classList.remove(
        "is-hidden"
      );

      signedIn.classList.add(
        "is-hidden"
      );

      setRegistrationAvailability(
        false
      );

      return;
    }

    signedOut.classList.add(
      "is-hidden"
    );

    signedIn.classList.remove(
      "is-hidden"
    );

    const userName =
      $("#authUserName");

    const userEmail =
      $("#authUserEmail");

    const permissionStatus =
      $("#authPermissionStatus");

    if (userName) {
      userName.textContent =
        auth.user?.displayName ||
        auth.user?.email ||
        "ログイン中";
    }

    if (userEmail) {
      userEmail.textContent =
        auth.user?.email || "";
    }

    if (!permissionStatus) {
      return;
    }

    if (auth.authorized) {
      permissionStatus.textContent =
        "✓ SeedStudio職員として認証済み";

      permissionStatus.style.color =
        "#2F6D4F";

      setRegistrationAvailability(
        true
      );

    } else {
      permissionStatus.textContent =
        "このGoogleアカウントはSeedStudio職員として登録されていません";

      permissionStatus.style.color =
        "#B54848";

      setRegistrationAvailability(
        false
      );
    }
  }


  function showAuthError(
    message
  ) {
    const loading =
      $("#authLoading");

    const signedOut =
      $("#authSignedOut");

    if (loading) {
      loading.classList.add(
        "is-hidden"
      );
    }

    if (signedOut) {
      signedOut.classList.remove(
        "is-hidden"
      );
    }

    setRegistrationAvailability(
      false
    );

    console.error(message);
  }


  // ============================================================
  // Repository
  // ============================================================

  const dataRepository = {
    cache: [],

    mode: "loading",


    loadLocal() {
      const raw =
        localStorage.getItem(
          STORAGE_KEY
        );

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


    async waitForFirebaseBridge(
      timeoutMs = 10000
    ) {
      const started =
        Date.now();

      while (
        !window.SeedStudioFirestore ||
        !window.SeedStudioAuth
      ) {
        if (
          Date.now() - started >
          timeoutMs
        ) {
          throw new Error(
            "Firebase bridge timeout"
          );
        }

        await sleep(100);
      }
    },


    async initialize() {
      try {
        await this
          .waitForFirebaseBridge();

        const authState =
          await window
            .SeedStudioAuth
            .waitUntilReady();

        state.authState =
          authState;

        renderAuthState();

        if (
          !authState.authorized
        ) {
          this.cache =
            this.loadLocal();

          this.mode =
            "auth-required";

          return;
        }

        await this
          .reloadFromFirestore();

      } catch (error) {
        console.error(
          "Firebase initialization failed.",
          error
        );

        this.cache =
          this.loadLocal();

        this.mode =
          "local";

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
      return [
        ...this.cache
      ];
    },


    async reloadFromFirestore() {
      if (
        !state.authState.authorized
      ) {
        return;
      }

      const records =
        await window
          .SeedStudioFirestore
          .listPostingRecords();

      this.cache =
        records.sort(
          (a, b) =>
            (
              b.postingDate || ""
            ).localeCompare(
              a.postingDate || ""
            )
        );

      this.mode =
        "firestore";

      this.saveLocal(
        this.cache
      );
    },


    async add(record) {
      if (
        !state.authState.authorized
      ) {
        throw new Error(
          "LOGIN_REQUIRED"
        );
      }

      try {
        const saved =
          await window
            .SeedStudioFirestore
            .savePostingRecord(
              record
            );

        this.cache.push(
          saved
        );

        this.cache.sort(
          (a, b) =>
            (
              b.postingDate || ""
            ).localeCompare(
              a.postingDate || ""
            )
        );

        this.saveLocal(
          this.cache
        );

        this.mode =
          "firestore";

        return {
          mode: "firestore",
          record: saved
        };

      } catch (error) {
        console.error(
          "Firestore save failed.",
          error
        );

        this.cache.push(
          record
        );

        this.saveLocal(
          this.cache
        );

        this.mode =
          "local";

        return {
          mode: "local",
          record
        };
      }
    }
  };


  // ============================================================
  // Google Maps
  // ============================================================

  function getMapsApiKey() {
    return (
      window
        .SEEDSTUDIO_CONFIG
        ?.googleMapsApiKey ||
      ""
    );
  }


  function isConfiguredMapsKey(
    key
  ) {
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
    const element =
      $(selector);

    if (!element) {
      return;
    }

    element.textContent =
      message;

    element.classList.toggle(
      "is-error",
      isError
    );

    element.classList.remove(
      "is-hidden"
    );
  }


  function hideMapStatus(
    selector
  ) {
    const element =
      $(selector);

    if (element) {
      element.classList.add(
        "is-hidden"
      );
    }
  }


  function loadGoogleMaps() {
    if (
      window.google?.maps
    ) {
      return Promise.resolve(
        window.google.maps
      );
    }

    if (state.mapsPromise) {
      return state.mapsPromise;
    }

    const key =
      getMapsApiKey();

    if (
      !isConfiguredMapsKey(
        key
      )
    ) {
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

          window
            .__seedStudioMapsReady =
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

          script.async =
            true;

          script.defer =
            true;

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


  function toLatLngPath(
    coordinates
  ) {
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

    if (
      !coordinates?.length
    ) {
      map.setCenter(
        fallbackCenter
      );

      map.setZoom(
        DEFAULT_ZOOM
      );

      return;
    }

    const bounds =
      new google.maps
        .LatLngBounds();

    coordinates.forEach(
      ([lng, lat]) => {
        bounds.extend({
          lat,
          lng
        });
      }
    );

    if (
      coordinates.length === 1
    ) {
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
          record.area
            .coordinates
            .length >= 3
      );
  }


  // ============================================================
  // Draft
  // ============================================================

  function resetDraft() {
    state.mapPoints = [];

    state.draft = {
      postingDate:
        todayIso(),

      staffId:
        master.staff[0].id,

      flyerId:
        master.flyers[0].id,

      participantIds: [],

      area: null,

      quantity: 0,

      participantSteps: {}
    };

    const postingDate =
      $("#postingDate");

    const staffSelect =
      $("#staffSelect");

    const flyerSelect =
      $("#flyerSelect");

    const quantityInput =
      $("#quantityInput");

    if (postingDate) {
      postingDate.value =
        state.draft
          .postingDate;
    }

    if (staffSelect) {
      staffSelect.value =
        state.draft
          .staffId;
    }

    if (flyerSelect) {
      flyerSelect.value =
        state.draft
          .flyerId;
    }

    if (quantityInput) {
      quantityInput.value =
        "";
    }

    $$("#participantList input")
      .forEach(
        (input) => {
          input.checked =
            false;

          input
            .closest(
              ".checkbox-row"
            )
            ?.classList
            .remove(
              "is-selected"
            );
        }
      );

    clearDraftMapGraphics();
  }


  // ============================================================
  // Navigation
  // ============================================================

  function navigate(
    view
  ) {
    state.currentView =
      view;

    $$(".view").forEach(
      (element) => {
        element
          .classList
          .toggle(
            "is-active",
            element.dataset.view ===
              view
          );
      }
    );

    const backButton =
      $("#backButton");

    if (backButton) {
      backButton.classList.toggle(
        "is-hidden",
        view === "home"
      );
    }

    const titles = {
      home:
        "SeedStudio Posting",

      "register-basic":
        "配布実績を登録",

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

      history:
        "配布履歴"
    };

    const pageTitle =
      $("#pageTitle");

    if (pageTitle) {
      pageTitle.textContent =
        titles[view] ||
        "SeedStudio Posting";
    }

    if (
      view === "home"
    ) {
      renderHome();
    }

    if (
      view ===
      "register-map"
    ) {
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

    if (
      view === "success"
    ) {
      renderSuccess();
    }

    if (
      view ===
      "achievements"
    ) {
      renderAchievements();
    }

    if (
      view === "history"
    ) {
      renderHistory();
    }

    if (
      view === "map"
    ) {
      window.setTimeout(
        renderMapStatus,
        0
      );
    }

    window.scrollTo(
      0,
      0
    );
  }


  function goBack() {
    const fallback = {
      "register-basic":
        "home",

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
    $("#staffSelect")
      .innerHTML =
      master.staff
        .map(
          (item) =>
            `<option value="${item.id}">${item.name}</option>`
        )
        .join("");


    $("#flyerSelect")
      .innerHTML =
      master.flyers
        .map(
          (item) =>
            `<option value="${item.id}">${item.name}</option>`
        )
        .join("");


    $("#participantList")
      .innerHTML =
      master.participants
        .map(
          (item) => `
            <label class="checkbox-row">
              <input
                type="checkbox"
                value="${item.id}"
              >
              <span>
                ${item.name}
              </span>
            </label>
          `
        )
        .join("");


    $("#achievementParticipantSelect")
      .innerHTML =
      master.participants
        .map(
          (item) =>
            `<option value="${item.id}">${item.name}</option>`
        )
        .join("");
  }


  // ============================================================
  // Home
  // ============================================================

  function renderHome() {
    const ym =
      currentYm();

    const records =
      dataRepository
        .load()
        .filter(
          (record) =>
            (
              record.postingDate ||
              ""
            ).startsWith(
              ym
            )
        );

    const quantity =
      records.reduce(
        (
          total,
          record
        ) =>
          total +
          Number(
            record.quantity ||
            0
          ),
        0
      );

    const steps =
      records.reduce(
        (
          total,
          record
        ) =>
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
        (
          total,
          record
        ) =>
          total +
          (
            record.participants ||
            []
          ).length,
        0
      );

    $("#summaryMonth")
      .textContent =
      `${Number(
        ym.slice(5, 7)
      )}月`;

    $("#homeTotalQuantity")
      .textContent =
      `${formatNumber(
        quantity
      )}部`;

    $("#homeTotalSteps")
      .textContent =
      `${formatNumber(
        steps
      )}歩`;

    $("#homeParticipationCount")
      .textContent =
      `${formatNumber(
        participations
      )}回`;
  }


  // ============================================================
  // Step 1
  // ============================================================

  function syncStep1() {
    state.draft.postingDate =
      $("#postingDate")
        .value;

    state.draft.staffId =
      $("#staffSelect")
        .value;

    state.draft.flyerId =
      $("#flyerSelect")
        .value;

    state.draft
      .participantIds =
      $$(
        "#participantList input:checked"
      ).map(
        (input) =>
          input.value
      );
  }


  function validateStep1() {
    syncStep1();

    const ok =
      state.draft
        .participantIds
        .length > 0;

    $("#participantError")
      .classList
      .toggle(
        "is-hidden",
        ok
      );

    return ok;
  }


  // ============================================================
  // Posting map
  // ============================================================

  function clearDraftMapGraphics() {
    state
      .postingMarkers
      .forEach(
        (marker) =>
          marker.setMap(null)
      );

    state.postingMarkers =
      [];

    if (
      state.postingPolygon
    ) {
      state
        .postingPolygon
        .setMap(null);

      state.postingPolygon =
        null;
    }

    const confirmButton =
      $("#confirmMapButton");

    if (confirmButton) {
      confirmButton.disabled =
        true;
    }

    const warning =
      $("#overlapWarning");

    if (warning) {
      warning.classList.add(
        "is-hidden"
      );
    }
  }


  function drawDraftPolygon() {
    if (
      !state.postingMap ||
      !window.google?.maps
    ) {
      return;
    }

    state
      .postingMarkers
      .forEach(
        (marker) =>
          marker.setMap(null)
      );

    state.postingMarkers =
      [];

    if (
      state.postingPolygon
    ) {
      state
        .postingPolygon
        .setMap(null);
    }

    const path =
      toLatLngPath(
        state.mapPoints
      );

    if (
      path.length >= 2
    ) {
      state.postingPolygon =
        new google.maps
          .Polygon({
            paths:
              path,

            strokeColor:
              "#2F6D4F",

            strokeOpacity:
              1,

            strokeWeight:
              3,

            fillColor:
              "#2F6D4F",

            fillOpacity:
              path.length >= 3
                ? 0.22
                : 0.08,

            map:
              state.postingMap,

            clickable:
              false
          });

    } else {
      state.postingPolygon =
        null;
    }

    path.forEach(
      (
        position,
        index
      ) => {
        const marker =
          new google.maps
            .Marker({
              position,

              map:
                state.postingMap,

              label: {
                text:
                  String(
                    index + 1
                  ),

                color:
                  "#ffffff",

                fontWeight:
                  "700"
              },

              title:
                `頂点 ${
                  index + 1
                }`
            });

        state
          .postingMarkers
          .push(
            marker
          );
      }
    );

    $("#confirmMapButton")
      .disabled =
      state.mapPoints
        .length < 3;

    updateOverlapWarning();
  }


  function renderPostingHistoryPolygons() {
    state
      .postingHistoryPolygons
      .forEach(
        (polygon) =>
          polygon.setMap(null)
      );

    state.postingHistoryPolygons =
      [];

    if (
      !state.postingMap ||
      !window.google?.maps
    ) {
      return;
    }

    getGeoRecords()
      .forEach(
        (
          record,
          index
        ) => {
          const opacity =
            Math.max(
              0.08,
              0.18 -
              index * 0.01
            );

          const polygon =
            new google.maps
              .Polygon({
                paths:
                  toLatLngPath(
                    record.area
                      .coordinates
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

          state
            .postingHistoryPolygons
            .push(
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

      if (
        !state.postingMap
      ) {
        state.postingMap =
          new google.maps
            .Map(
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

        state.postingMap
          .addListener(
            "click",
            (event) => {
              state.mapPoints
                .push([
                  event.latLng.lng(),
                  event.latLng.lat()
                ]);

              drawDraftPolygon();
            }
          );
      }

      renderPostingHistoryPolygons();

      drawDraftPolygon();

      hideMapStatus(
        statusId
      );

      if (
        !state.mapPoints.length
      ) {
        locateCurrentPosition(
          false
        );

      } else {
        fitMapToCoordinates(
          state.postingMap,
          state.mapPoints
        );
      }

      window.setTimeout(
        () =>
          google.maps.event
            .trigger(
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

      $("#confirmMapButton")
        .disabled =
        true;
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

    button.disabled =
      true;

    button.textContent =
      "取得中…";

    navigator.geolocation
      .getCurrentPosition(
        (position) => {
          state.postingMap
            .setCenter({
              lat:
                position.coords
                  .latitude,

              lng:
                position.coords
                  .longitude
            });

          state.postingMap
            .setZoom(17);

          button.disabled =
            false;

          button.textContent =
            "◎ 現在地へ";
        },

        () => {
          button.disabled =
            false;

          button.textContent =
            "◎ 現在地へ";

          if (showError) {
            alert(
              "現在地を取得できませんでした。位置情報の許可を確認してください。"
            );
          }
        },

        {
          enableHighAccuracy:
            true,

          timeout:
            8000,

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
    const [x, y] =
      point;

    let inside =
      false;

    for (
      let i = 0,
          j =
            polygon.length - 1;

      i <
      polygon.length;

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
          (
            (
              xj - xi
            ) *
            (
              y - yi
            )
          ) /
          (
            (
              yj - yi
            ) ||
            Number.EPSILON
          ) +
          xi
        );

      if (intersects) {
        inside =
          !inside;
      }
    }

    return inside;
  }


  function orientation(
    a,
    b,
    c
  ) {
    const value =
      (
        b[1] - a[1]
      ) *
      (
        c[0] - b[0]
      ) -
      (
        b[0] - a[0]
      ) *
      (
        c[1] - b[1]
      );

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


  function polygonsOverlap(
    a,
    b
  ) {
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
      const a1 =
        a[i];

      const a2 =
        a[
          (
            i + 1
          ) %
          a.length
        ];

      for (
        let j = 0;
        j < b.length;
        j++
      ) {
        const b1 =
          b[j];

        const b2 =
          b[
            (
              j + 1
            ) %
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
      getGeoRecords()
        .find(
          (record) =>
            polygonsOverlap(
              state.mapPoints,
              record.area
                .coordinates
            )
        );

    if (overlapped) {
      warning.innerHTML =
        `⚠ この範囲は過去の配布履歴と重なっています` +
        `<br>` +
        `<small>` +
        `${overlapped.postingDate}・` +
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
    $("#participantSteps")
      .innerHTML =
      state.draft
        .participantIds
        .map(
          (id) => `
            <div class="participant-step-card">
              <strong>
                ${names.participant(id)}
              </strong>

              <div class="number-input">
                <input
                  class="input js-step-input"
                  type="number"
                  min="1"
                  inputmode="numeric"
                  placeholder="歩数"
                  data-id="${id}"
                  value="${
                    state.draft
                      .participantSteps[id] ||
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

    $$(".js-step-input")
      .forEach(
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

    $("#quantityInput")
      .value =
      state.draft.quantity ||
      "";

    renderConfirm();
  }


  function renderConfirm() {
    state.draft.quantity =
      Number(
        $("#quantityInput")
          .value ||
        0
      );

    const steps =
      state.draft
        .participantIds
        .map(
          (id) =>
            `${names.participant(id)} ` +
            `${formatNumber(
              state.draft
                .participantSteps[id] ||
              0
            )}歩`
        )
        .join("<br>");

    $("#confirmContent")
      .innerHTML =
      `
        <div class="confirm-row">
          <span>配布日</span>
          <b>
            ${state.draft.postingDate}
          </b>
        </div>

        <div class="confirm-row">
          <span>担当職員</span>
          <b>
            ${names.staff(
              state.draft.staffId
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
                  names.participant
                )
                .join("・")
            }
          </b>
        </div>

        <div class="confirm-row">
          <span>チラシ</span>
          <b>
            ${names.flyer(
              state.draft.flyerId
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

      if (
        !state.confirmMap
      ) {
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

      if (
        state.confirmPolygon
      ) {
        state
          .confirmPolygon
          .setMap(null);
      }

      state.confirmPolygon =
        new google.maps
          .Polygon({
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
        state.draft.area
          .coordinates
      );

      window.setTimeout(
        () =>
          google.maps.event
            .trigger(
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
      saveButton.disabled
    ) {
      return;
    }

    saveButton.disabled =
      true;

    saveButton.textContent =
      "保存しています…";

    state.draft.quantity =
      Number(
        $("#quantityInput")
          .value ||
        0
      );

    const validQuantity =
      state.draft.quantity >
      0;

    const validSteps =
      state.draft
        .participantIds
        .every(
          (id) =>
            Number(
              state.draft
                .participantSteps[id] ||
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

      saveButton.disabled =
        false;

      saveButton.textContent =
        "この内容で登録する";

      return;
    }

    const record = {
      id:
        "P-" +
        Date.now(),

      postingDate:
        state.draft
          .postingDate,

      staffId:
        state.draft
          .staffId,

      flyerId:
        state.draft
          .flyerId,

      quantity:
        state.draft
          .quantity,

      participants:
        state.draft
          .participantIds
          .map(
            (id) => ({
              participantId:
                id,

              steps:
                Number(
                  state.draft
                    .participantSteps[id]
                )
            })
          ),

      area:
        state.draft.area,

      createdAt:
        new Date()
          .toISOString()
    };

    try {
      const result =
        await dataRepository
          .add(record);

      result.record
        .storageMode =
        result.mode;

      state.lastSavedRecord =
        result.record;

      navigate(
        "success"
      );

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

    saveButton.disabled =
      false;

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

    $("#successQuantity")
      .textContent =
      `${formatNumber(
        record.quantity
      )}部`;

    const savedAt =
      new Date(
        record.createdAt
      );

    const savedAtText =
      Number.isNaN(
        savedAt.getTime()
      )
        ? ""
        : savedAt
            .toLocaleString(
              "ja-JP",
              {
                year:
                  "numeric",

                month:
                  "numeric",

                day:
                  "numeric",

                hour:
                  "2-digit",

                minute:
                  "2-digit"
              }
            );

    $("#successMeta")
      .innerHTML =
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
                : "この端末（一時保存）"
            }
          </b>
        </div>

        <div class="confirm-row">
          <span>配布日</span>
          <b>
            ${record.postingDate}
          </b>
        </div>

        <div class="confirm-row">
          <span>担当職員</span>
          <b>
            ${names.staff(
              record.staffId
            )}
          </b>
        </div>

        <div class="confirm-row">
          <span>チラシ</span>
          <b>
            ${names.flyer(
              record.flyerId
            )}
          </b>
        </div>

        <div class="confirm-row">
          <span>保存日時</span>
          <b>
            ${savedAtText}
          </b>
        </div>
      `;

    $("#successParticipants")
      .innerHTML =
      (
        record.participants ||
        []
      )
        .map(
          (participant) =>
            `
              <div class="participant-result">
                ${names.participant(
                  participant
                    .participantId
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


  // ============================================================
  // History
  // ============================================================

  function renderHistory() {
    const records =
      dataRepository
        .load()
        .sort(
          (a, b) =>
            (
              b.postingDate ||
              ""
            ).localeCompare(
              a.postingDate ||
              ""
            )
        );

    $("#historyEmpty")
      .classList
      .toggle(
        "is-hidden",
        records.length >
        0
      );

    $("#historyList")
      .innerHTML =
      records
        .map(
          (record) => `
            <article class="history-item">
              <b>
                ${record.postingDate}
                　
                ${formatNumber(
                  record.quantity
                )}部
              </b>

              <small>
                ${names.staff(
                  record.staffId
                )}
                <br>

                ${
                  (
                    record.participants ||
                    []
                  )
                    .map(
                      (participant) =>
                        names.participant(
                          participant
                            .participantId
                        )
                    )
                    .join("・")
                }

                <br>

                ${names.flyer(
                  record.flyerId
                )}
              </small>
            </article>
          `
        )
        .join("");
  }


  // ============================================================
  // Distribution status
  // ============================================================

  async function renderMapStatus() {
    const records =
      dataRepository.load();

    $("#mapStatusList")
      .innerHTML =
      records
        .map(
          (record) => `
            <article class="history-item">
              <b>
                ${record.postingDate}
                　
                ${formatNumber(
                  record.quantity
                )}部
              </b>

              <small>
                ${names.flyer(
                  record.flyerId
                )}
              </small>
            </article>
          `
        )
        .join("");

    const statusId =
      "#historyMapStatus";

    try {
      setMapStatus(
        statusId,
        "Google Mapsを読み込み中…"
      );

      await loadGoogleMaps();

      if (
        !state.historyMap
      ) {
        state.historyMap =
          new google.maps
            .Map(
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

      state
        .historyPolygons
        .forEach(
          (polygon) =>
            polygon.setMap(null)
        );

      state.historyPolygons =
        [];

      const geoRecords =
        getGeoRecords();

      const allCoordinates =
        [];

      geoRecords.forEach(
        (
          record,
          index
        ) => {
          allCoordinates.push(
            ...record.area
              .coordinates
          );

          const opacity =
            Math.max(
              0.08,
              0.24 -
              index * 0.015
            );

          const polygon =
            new google.maps
              .Polygon({
                paths:
                  toLatLngPath(
                    record.area
                      .coordinates
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

          state
            .historyPolygons
            .push(
              polygon
            );
        }
      );

      if (
        allCoordinates.length
      ) {
        fitMapToCoordinates(
          state.historyMap,
          allCoordinates
        );
      }

      hideMapStatus(
        statusId
      );

      window.setTimeout(
        () =>
          google.maps.event
            .trigger(
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
  // Achievements
  // ============================================================

  function renderAchievements() {
    const participantId =
      $("#achievementParticipantSelect")
        .value ||
      master
        .participants[0]
        .id;

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
                participant
                  .participantId ===
                participantId
            )
        );

    const totalSteps =
      records.reduce(
        (
          total,
          record
        ) => {
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
            ).startsWith(
              ym
            )
        )
        .reduce(
          (
            total,
            record
          ) => {
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

    const totalQuantity =
      records.reduce(
        (
          total,
          record
        ) =>
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
                  participant
                    .participantId ===
                  participantId
              )?.steps ||
              0
            )
        )
      );

    const nextGoal =
      milestoneSteps.find(
        (goal) =>
          goal >
          totalSteps
      ) ||
      milestoneSteps[
        milestoneSteps.length -
        1
      ];

    const previousGoal =
      [
        ...milestoneSteps
      ]
        .reverse()
        .find(
          (goal) =>
            goal <=
            totalSteps
        ) ||
      0;

    const progress =
      Math.min(
        100,
        Math.max(
          0,
          (
            (
              totalSteps -
              previousGoal
            ) /
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
        nextGoal -
        totalSteps
      );

    $("#achievementMonthSteps")
      .textContent =
      formatNumber(
        monthSteps
      );

    $("#achievementTotalSteps")
      .textContent =
      `${formatNumber(
        totalSteps
      )}歩`;

    $("#achievementCount")
      .textContent =
      `${records.length}回`;

    $("#achievementQuantity")
      .textContent =
      `${formatNumber(
        totalQuantity
      )}部`;

    $("#achievementBest")
      .textContent =
      `${formatNumber(
        best
      )}歩`;

    $("#achievementGoalMessage")
      .textContent =
      `🌳 ${formatNumber(
        nextGoal
      )}歩まであと${formatNumber(
        remaining
      )}歩！`;

    $("#achievementProgressFill")
      .style.width =
      `${progress}%`;

    $("#achievementPercent")
      .textContent =
      `${Math.round(
        progress
      )}%`;

    $("#milestoneRow")
      .innerHTML =
      milestoneSteps
        .map(
          (goal) => `
            <div
              class="
                milestone
                ${
                  totalSteps >=
                  goal
                    ? "is-achieved"
                    : "is-locked"
                }
              "
            >
              <div>
                ${
                  totalSteps >=
                  goal
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


  // ============================================================
  // Authentication actions
  // ============================================================

  async function handleLogin() {
    try {
      if (
        !window.SeedStudioAuth
      ) {
        throw new Error(
          "Firebase Auth is not ready."
        );
      }

      const authState =
        await window
          .SeedStudioAuth
          .signIn();

      state.authState =
        authState;

      renderAuthState();

      if (
        !authState.authorized
      ) {
        alert(
          "Googleログインはできましたが、このアカウントはSeedStudio職員として登録されていません。"
        );

        return;
      }

      try {
        await dataRepository
          .reloadFromFirestore();

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
          "Googleログインは成功しました。Firestoreの読み取り権限はまだ設定されていません。"
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
      if (
        window.SeedStudioAuth
      ) {
        await window
          .SeedStudioAuth
          .signOut();
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

    dataRepository.mode =
      "auth-required";

    dataRepository.cache =
      dataRepository
        .loadLocal();

    renderAuthState();

    renderHome();

    navigate("home");
  }


  // ============================================================
  // Events
  // ============================================================

  function bindEvents() {
    const loginButton =
      $("#googleLoginButton");

    if (loginButton) {
      loginButton
        .addEventListener(
          "click",
          handleLogin
        );
    }


    const logoutButton =
      $("#googleLogoutButton");

    if (logoutButton) {
      logoutButton
        .addEventListener(
          "click",
          handleLogout
        );
    }


    $$("[data-nav]")
      .forEach(
        (button) => {
          button.addEventListener(
            "click",
            () => {
              if (
                button.disabled
              ) {
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
            ?.classList
            .toggle(
              "is-selected",
              event.target.checked
            );
        }
      );


    $("#goToMapButton")
      ?.addEventListener(
        "click",
        () => {
          if (
            validateStep1()
          ) {
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
          state.mapPoints =
            [];

          clearDraftMapGraphics();
        }
      );


    $("#confirmMapButton")
      ?.addEventListener(
        "click",
        () => {
          if (
            state.mapPoints
              .length < 3
          ) {
            return;
          }

          state.draft.area = {
            type:
              "Polygon",

            coordinates:
              state.mapPoints
                .map(
                  ([lng, lat]) =>
                    [
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
          navigate(
            "history"
          )
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
  }


  // ============================================================
  // Auth observer
  // ============================================================

  function startAuthObserver() {
    if (
      !window.SeedStudioAuth
    ) {
      return;
    }

    window
      .SeedStudioAuth
      .observe(
        async (
          authState
        ) => {
          const previousUid =
            state
              .authState
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
              await dataRepository
                .reloadFromFirestore();

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

    /*
     * Important:
     * Immediately show a usable auth UI.
     * Never leave the page permanently on
     * "ログイン状態を確認しています..."
     */
    setRegistrationAvailability(
      false
    );

    try {
      await dataRepository
        .initialize();

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
