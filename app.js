(() => {
  "use strict";

  const STORAGE_KEY = "seedstudio-posting-v0.1-records";
  const DEFAULT_CENTER = { lat: 35.6074, lng: 140.1065 };
  const DEFAULT_ZOOM = 14;

  const master = {
    staff: [
      { id: "S0001", name: "大久保 和恵" },
      { id: "S0002", name: "宮 麻衣子" },
      { id: "S0003", name: "鈴木 由香" },
      { id: "S0004", name: "小野 瑞季" },
      { id: "S0005", name: "番場 みづい" }
    ],
    participants: [
      { id: "U0001", name: "Aさん" },
      { id: "U0002", name: "Bさん" },
      { id: "U0003", name: "Cさん" }
    ],
    flyers: [
      { id: "F0001", name: "SeedStudio 事業所案内 2026-10" }
    ]
  };

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

  const milestoneSteps = [10000, 50000, 100000, 250000, 500000];

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

    } catch {

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

      await new Promise(
        (resolve) =>
          setTimeout(resolve, 100)
      );
    }
  },


  async init() {

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


      if (!authState.authorized) {

        this.cache =
          this.loadLocal();

        this.mode =
          "auth-required";

        return;
      }


      const records =
        await window
          .SeedStudioFirestore
          .listPostingRecords();

      this.cache =
        records.sort(
          (a, b) =>
            (b.postingDate || "")
              .localeCompare(
                a.postingDate || ""
              )
        );

      this.mode =
        "firestore";

      this.saveLocal(
        this.cache
      );

    } catch (error) {

      console.warn(
        "Firestore unavailable.",
        error
      );

      this.cache =
        this.loadLocal();

      this.mode =
        "local";

      renderAuthState();
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
          (b.postingDate || "")
            .localeCompare(
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

      this.cache.push(saved);

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

      this.cache.push(record);

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
  

  const $ = (s) => document.querySelector(s);
  const $$ = (s) => [...document.querySelectorAll(s)];

  const names = {
    staff: (id) => master.staff.find(x => x.id === id)?.name || id,
    participant: (id) => master.participants.find(x => x.id === id)?.name || id,
    flyer: (id) => master.flyers.find(x => x.id === id)?.name || id
  };

  function todayIso() {
    const d = new Date();
    const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
    return local.toISOString().slice(0, 10);
  }

  function currentYm() {
    return todayIso().slice(0, 7);
  }

  function formatNumber(v) {
    return Number(v || 0).toLocaleString("ja-JP");
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


  if (!loading) {
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


  $("#authUserName")
    .textContent =
      auth.user?.displayName ||
      auth.user?.email ||
      "ログイン中";


  $("#authUserEmail")
    .textContent =
      auth.user?.email || "";


  const status =
    $("#authPermissionStatus");


  if (auth.authorized) {

    status.textContent =
      "✓ SeedStudio職員として認証済み";

    status.style.color =
      "#2F6D4F";

    setRegistrationAvailability(
      true
    );

  } else {

    status.textContent =
      "このGoogleアカウントはSeedStudio職員として登録されていません";

    status.style.color =
      "#B54848";

    setRegistrationAvailability(
      false
    );
  }
}


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
  
  function getMapsApiKey() {
    return window.SEEDSTUDIO_CONFIG?.googleMapsApiKey || "";
  }

  function isConfiguredMapsKey(key) {
    return !!key && !key.includes("PASTE_YOUR_GOOGLE_MAPS_API_KEY_HERE");
  }

  function setMapStatus(id, message, isError = false) {
    const el = $(id);
    if (!el) return;
    el.textContent = message;
    el.classList.toggle("is-error", isError);
    el.classList.remove("is-hidden");
  }

  function hideMapStatus(id) {
    $(id)?.classList.add("is-hidden");
  }

  function loadGoogleMaps() {
    if (window.google?.maps) return Promise.resolve(window.google.maps);
    if (state.mapsPromise) return state.mapsPromise;

    const key = getMapsApiKey();
    if (!isConfiguredMapsKey(key)) {
      state.mapsPromise = Promise.reject(new Error("Google Maps APIキーが未設定です。"));
      return state.mapsPromise;
    }

    state.mapsPromise = new Promise((resolve, reject) => {
      window.__seedStudioMapsReady = () => resolve(window.google.maps);
      const script = document.createElement("script");
      script.src = "https://maps.googleapis.com/maps/api/js?key=" + encodeURIComponent(key) + "&callback=__seedStudioMapsReady&v=weekly";
      script.async = true;
      script.defer = true;
      script.onerror = () => reject(new Error("Google Mapsを読み込めませんでした。"));
      document.head.appendChild(script);
    });

    return state.mapsPromise;
  }

  function resetDraft() {
    state.mapPoints = [];
    state.draft = {
      postingDate: todayIso(),
      staffId: master.staff[0].id,
      flyerId: master.flyers[0].id,
      participantIds: [],
      area: null,
      quantity: 0,
      participantSteps: {}
    };

    $("#postingDate").value = state.draft.postingDate;
    $("#staffSelect").value = state.draft.staffId;
    $("#flyerSelect").value = state.draft.flyerId;
    $("#quantityInput").value = "";

    $$("#participantList input").forEach(i => {
      i.checked = false;
      i.closest(".checkbox-row")?.classList.remove("is-selected");
    });

    clearDraftMapGraphics();
  }

  function navigate(view) {
    state.currentView = view;
    $$(".view").forEach(v => v.classList.toggle("is-active", v.dataset.view === view));
    $("#backButton").classList.toggle("is-hidden", view === "home");

    const titles = {
      home: "SeedStudio Posting",
      "register-basic": "配布実績を登録",
      "register-map": "配布実績を登録",
      "register-result": "配布実績を登録",
      success: "登録完了",
      map: "配布状況",
      achievements: "みんなの成果",
      history: "配布履歴"
    };
    $("#pageTitle").textContent = titles[view] || "SeedStudio Posting";

    if (view === "home") renderHome();
    if (view === "register-map") window.setTimeout(initPostingMap, 0);
    if (view === "register-result") renderResultStep();
    if (view === "success") renderSuccess();
    if (view === "achievements") renderAchievements();
    if (view === "history") renderHistory();
    if (view === "map") window.setTimeout(renderMapStatus, 0);

    window.scrollTo(0, 0);
  }

  function goBack() {
    const fallback = {
      "register-basic": "home",
      "register-map": "register-basic",
      "register-result": "register-map",
      success: "home",
      map: "home",
      achievements: "home",
      history: "home"
    };
    navigate(fallback[state.currentView] || "home");
  }

  function renderMasters() {
    $("#staffSelect").innerHTML = master.staff.map(x => `<option value="${x.id}">${x.name}</option>`).join("");
    $("#flyerSelect").innerHTML = master.flyers.map(x => `<option value="${x.id}">${x.name}</option>`).join("");
    $("#participantList").innerHTML = master.participants.map(x => `
      <label class="checkbox-row">
        <input type="checkbox" value="${x.id}">
        <span>${x.name}</span>
      </label>`).join("");
    $("#achievementParticipantSelect").innerHTML = master.participants.map(x => `<option value="${x.id}">${x.name}</option>`).join("");
  }

  function renderHome() {
    const ym = currentYm();
    const records = dataRepository.load().filter(r => r.postingDate.startsWith(ym));
    const quantity = records.reduce((s,r) => s + Number(r.quantity || 0), 0);
    const steps = records.reduce((s,r) => s + r.participants.reduce((ss,p) => ss + Number(p.steps || 0),0),0);
    const participations = records.reduce((s,r) => s + r.participants.length,0);

    $("#summaryMonth").textContent = `${Number(ym.slice(5,7))}月`;
    $("#homeTotalQuantity").textContent = `${formatNumber(quantity)}部`;
    $("#homeTotalSteps").textContent = `${formatNumber(steps)}歩`;
    $("#homeParticipationCount").textContent = `${formatNumber(participations)}回`;
  }

  function syncStep1() {
    state.draft.postingDate = $("#postingDate").value;
    state.draft.staffId = $("#staffSelect").value;
    state.draft.flyerId = $("#flyerSelect").value;
    state.draft.participantIds = $$("#participantList input:checked").map(x => x.value);
  }

  function validateStep1() {
    syncStep1();
    const ok = state.draft.participantIds.length > 0;
    $("#participantError").classList.toggle("is-hidden", ok);
    return ok;
  }

  function toLatLngPath(coords) {
    return (coords || []).map(([lng, lat]) => ({ lat, lng }));
  }

  function fitMapToCoordinates(map, coords, fallbackCenter = DEFAULT_CENTER) {
    if (!map) return;
    if (!coords?.length) {
      map.setCenter(fallbackCenter);
      map.setZoom(DEFAULT_ZOOM);
      return;
    }
    const bounds = new google.maps.LatLngBounds();
    coords.forEach(([lng, lat]) => bounds.extend({ lat, lng }));
    if (coords.length === 1) {
      map.setCenter({ lat: coords[0][1], lng: coords[0][0] });
      map.setZoom(17);
    } else {
      map.fitBounds(bounds, 36);
    }
  }

  function getGeoRecords() {
    return dataRepository.load().filter(r =>
      r.area?.type === "Polygon" &&
      Array.isArray(r.area.coordinates) &&
      r.area.coordinates.length >= 3
    );
  }

  function clearDraftMapGraphics() {
    state.postingMarkers.forEach(m => m.setMap(null));
    state.postingMarkers = [];
    if (state.postingPolygon) {
      state.postingPolygon.setMap(null);
      state.postingPolygon = null;
    }
    $("#confirmMapButton").disabled = true;
    $("#overlapWarning").classList.add("is-hidden");
  }

  function drawDraftPolygon() {
    if (!state.postingMap || !window.google?.maps) return;

    state.postingMarkers.forEach(m => m.setMap(null));
    state.postingMarkers = [];
    if (state.postingPolygon) state.postingPolygon.setMap(null);

    const path = toLatLngPath(state.mapPoints);

    if (path.length >= 2) {
      state.postingPolygon = new google.maps.Polygon({
        paths: path,
        strokeColor: "#2F6D4F",
        strokeOpacity: 1,
        strokeWeight: 3,
        fillColor: "#2F6D4F",
        fillOpacity: path.length >= 3 ? 0.22 : 0.08,
        map: state.postingMap,
        clickable: false
      });
    } else {
      state.postingPolygon = null;
    }

    path.forEach((pos, index) => {
      const marker = new google.maps.Marker({
        position: pos,
        map: state.postingMap,
        label: { text: String(index + 1), color: "#ffffff", fontWeight: "700" },
        title: `頂点 ${index + 1}`
      });
      state.postingMarkers.push(marker);
    });

    $("#confirmMapButton").disabled = state.mapPoints.length < 3;
    updateOverlapWarning();
  }

  function renderPostingHistoryPolygons() {
    state.postingHistoryPolygons.forEach(p => p.setMap(null));
    state.postingHistoryPolygons = [];
    if (!state.postingMap || !window.google?.maps) return;

    getGeoRecords().forEach((r, index) => {
      const opacity = Math.max(0.08, 0.18 - index * 0.01);
      const poly = new google.maps.Polygon({
        paths: toLatLngPath(r.area.coordinates),
        strokeColor: "#6F7F72",
        strokeOpacity: 0.55,
        strokeWeight: 2,
        fillColor: "#8BA294",
        fillOpacity: opacity,
        map: state.postingMap,
        clickable: false
      });
      state.postingHistoryPolygons.push(poly);
    });
  }

  async function initPostingMap() {
    const statusId = "#postingMapStatus";
    try {
      setMapStatus(statusId, "Google Mapsを読み込み中…");
      await loadGoogleMaps();

      if (!state.postingMap) {
        state.postingMap = new google.maps.Map($("#postingGoogleMap"), {
          center: DEFAULT_CENTER,
          zoom: DEFAULT_ZOOM,
          mapTypeControl: false,
          streetViewControl: false,
          fullscreenControl: false,
          clickableIcons: false,
          gestureHandling: "greedy"
        });

        state.postingMap.addListener("click", (e) => {
          state.mapPoints.push([e.latLng.lng(), e.latLng.lat()]);
          drawDraftPolygon();
        });
      }

      renderPostingHistoryPolygons();
      drawDraftPolygon();
      hideMapStatus(statusId);

      if (!state.mapPoints.length) {
        locateCurrentPosition(false);
      } else {
        fitMapToCoordinates(state.postingMap, state.mapPoints);
      }

      window.setTimeout(() => google.maps.event.trigger(state.postingMap, "resize"), 50);
    } catch (err) {
      setMapStatus(statusId, "Google Maps APIキーをconfig.jsに設定すると実地図が表示されます。", true);
      $("#confirmMapButton").disabled = true;
    }
  }

  function locateCurrentPosition(showError = true) {
    if (!navigator.geolocation || !state.postingMap) {
      if (showError) alert("この端末では現在地を取得できません。");
      return;
    }

    const button = $("#locateButton");
    button.disabled = true;
    button.textContent = "取得中…";

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        state.postingMap.setCenter({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude
        });
        state.postingMap.setZoom(17);
        button.disabled = false;
        button.textContent = "◎ 現在地へ";
      },
      () => {
        button.disabled = false;
        button.textContent = "◎ 現在地へ";
        if (showError) alert("現在地を取得できませんでした。位置情報の許可を確認してください。");
      },
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 60000 }
    );
  }

  function pointInPolygon(point, polygon) {
    const [x, y] = point;
    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      const [xi, yi] = polygon[i];
      const [xj, yj] = polygon[j];
      const intersects = ((yi > y) !== (yj > y)) &&
        (x < ((xj - xi) * (y - yi)) / ((yj - yi) || Number.EPSILON) + xi);
      if (intersects) inside = !inside;
    }
    return inside;
  }

  function orientation(a, b, c) {
    const val = (b[1] - a[1]) * (c[0] - b[0]) - (b[0] - a[0]) * (c[1] - b[1]);
    if (Math.abs(val) < 1e-12) return 0;
    return val > 0 ? 1 : 2;
  }

  function segmentsIntersect(p1, q1, p2, q2) {
    const o1 = orientation(p1, q1, p2);
    const o2 = orientation(p1, q1, q2);
    const o3 = orientation(p2, q2, p1);
    const o4 = orientation(p2, q2, q1);
    return o1 !== o2 && o3 !== o4;
  }

  function polygonsOverlap(a, b) {
    if (a.some(p => pointInPolygon(p, b)) || b.some(p => pointInPolygon(p, a))) return true;
    for (let i = 0; i < a.length; i++) {
      const a1 = a[i], a2 = a[(i + 1) % a.length];
      for (let j = 0; j < b.length; j++) {
        const b1 = b[j], b2 = b[(j + 1) % b.length];
        if (segmentsIntersect(a1, a2, b1, b2)) return true;
      }
    }
    return false;
  }

  function updateOverlapWarning() {
    const warning = $("#overlapWarning");
    if (state.mapPoints.length < 3) {
      warning.classList.add("is-hidden");
      return;
    }
    const overlapped = getGeoRecords().find(r => polygonsOverlap(state.mapPoints, r.area.coordinates));
    if (overlapped) {
      warning.innerHTML = `⚠ この範囲は過去の配布履歴と重なっています<br><small>${overlapped.postingDate}・${formatNumber(overlapped.quantity)}部</small>`;
      warning.classList.remove("is-hidden");
    } else {
      warning.classList.add("is-hidden");
    }
  }

  function renderResultStep() {
    $("#participantSteps").innerHTML = state.draft.participantIds.map(id => `
      <div class="participant-step-card">
        <strong>${names.participant(id)}</strong>
        <div class="number-input">
          <input class="input js-step-input" type="number" min="1" inputmode="numeric" placeholder="歩数" data-id="${id}" value="${state.draft.participantSteps[id] || ""}">
          <span>歩</span>
        </div>
      </div>`).join("");

    $$(".js-step-input").forEach(i => i.addEventListener("input", () => {
      state.draft.participantSteps[i.dataset.id] = Number(i.value || 0);
      renderConfirm();
    }));

    $("#quantityInput").value = state.draft.quantity || "";
    renderConfirm();
  }

  function renderConfirm() {
    state.draft.quantity = Number($("#quantityInput").value || 0);
    const steps = state.draft.participantIds.map(id => `${names.participant(id)} ${formatNumber(state.draft.participantSteps[id] || 0)}歩`).join("<br>");
    $("#confirmContent").innerHTML = `
      <div class="confirm-row"><span>配布日</span><b>${state.draft.postingDate}</b></div>
      <div class="confirm-row"><span>担当職員</span><b>${names.staff(state.draft.staffId)}</b></div>
      <div class="confirm-row"><span>参加利用者</span><b>${state.draft.participantIds.map(names.participant).join("・")}</b></div>
      <div class="confirm-row"><span>チラシ</span><b>${names.flyer(state.draft.flyerId)}</b></div>
      <div class="confirm-row"><span>配布部数</span><b>${formatNumber(state.draft.quantity)}部</b></div>
      <div class="confirm-row"><span>歩数</span><b>${steps}</b></div>`;

    window.setTimeout(renderConfirmMapPreview, 0);
  }

  async function renderConfirmMapPreview() {
    if (!state.draft.area?.coordinates?.length) return;
    try {
      await loadGoogleMaps();

      if (!state.confirmMap) {
        state.confirmMap = new google.maps.Map($("#confirmGoogleMap"), {
          center: DEFAULT_CENTER,
          zoom: DEFAULT_ZOOM,
          disableDefaultUI: true,
          gestureHandling: "none",
          clickableIcons: false
        });
      }

      if (state.confirmPolygon) state.confirmPolygon.setMap(null);
      state.confirmPolygon = new google.maps.Polygon({
        paths: toLatLngPath(state.draft.area.coordinates),
        strokeColor: "#2F6D4F",
        strokeOpacity: 1,
        strokeWeight: 2,
        fillColor: "#2F6D4F",
        fillOpacity: 0.22,
        map: state.confirmMap,
        clickable: false
      });

      fitMapToCoordinates(state.confirmMap, state.draft.area.coordinates);
      window.setTimeout(() => google.maps.event.trigger(state.confirmMap, "resize"), 50);
    } catch {
      // The main map already shows the configuration message.
    }
  }

  async function saveRecord() {
    const saveButton = $("#saveRecordButton");
    if (saveButton.disabled) return;
    saveButton.disabled = true;
    saveButton.textContent = "保存しています…";

    state.draft.quantity = Number($("#quantityInput").value || 0);
    const validQty = state.draft.quantity > 0;
    const validSteps = state.draft.participantIds.every(id => Number(state.draft.participantSteps[id] || 0) > 0);

    if (!validQty || !validSteps) {
      alert("配布部数と参加した人全員の歩数を入力してください。");
      saveButton.disabled = false;
      saveButton.textContent = "この内容で登録する";
      return;
    }

    const record = {
      id: "P-" + Date.now(),
      postingDate: state.draft.postingDate,
      staffId: state.draft.staffId,
      flyerId: state.draft.flyerId,
      quantity: state.draft.quantity,
      participants: state.draft.participantIds.map(id => ({ participantId:id, steps:Number(state.draft.participantSteps[id]) })),
      area: state.draft.area,
      createdAt: new Date().toISOString()
    };

    let result;

try {

  result =
    await dataRepository.add(
      record
    );

} catch (error) {

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

  saveButton.disabled =
    false;

  saveButton.textContent =
    "この内容で登録する";

  return;
}


result.record.storageMode =
  result.mode;

state.lastSavedRecord =
  result.record;

navigate("success");

    window.setTimeout(() => {
      saveButton.disabled = false;
      saveButton.textContent = "この内容で登録する";
    }, 300);
  }

  function renderSuccess() {
    const r = state.lastSavedRecord;
    if (!r) return;

    $("#successQuantity").textContent = formatNumber(r.quantity) + "部";

    const savedAt = new Date(r.createdAt);
    const savedAtText = Number.isNaN(savedAt.getTime())
      ? ""
      : savedAt.toLocaleString("ja-JP", {
          year: "numeric", month: "numeric", day: "numeric",
          hour: "2-digit", minute: "2-digit"
        });

    $("#successMeta").innerHTML =
      '<div class="confirm-row"><span>保存状態</span><b>✓ 保存済み</b></div>' +
      '<div class="confirm-row"><span>保存先</span><b>' +
        (r.storageMode === "firestore" ? "Firestore（共有）" : "この端末（一時保存）") +
      '</b></div>' +
      '<div class="confirm-row"><span>配布日</span><b>' + r.postingDate + '</b></div>' +
      '<div class="confirm-row"><span>担当職員</span><b>' + names.staff(r.staffId) + '</b></div>' +
      '<div class="confirm-row"><span>チラシ</span><b>' + names.flyer(r.flyerId) + '</b></div>' +
      '<div class="confirm-row"><span>保存日時</span><b>' + savedAtText + '</b></div>';

    $("#successParticipants").innerHTML = r.participants.map(p =>
      '<div class="participant-result">' +
      names.participant(p.participantId) +
      '<b>🚶 ' + formatNumber(p.steps) + '歩</b></div>'
    ).join("");
  }

  function renderHistory() {
    const records = dataRepository.load().sort((a,b) => b.postingDate.localeCompare(a.postingDate));
    $("#historyEmpty").classList.toggle("is-hidden", records.length > 0);
    $("#historyList").innerHTML = records.map(r => `
      <article class="history-item">
        <b>${r.postingDate}　${formatNumber(r.quantity)}部</b>
        <small>${names.staff(r.staffId)}<br>${r.participants.map(p => names.participant(p.participantId)).join("・")}<br>${names.flyer(r.flyerId)}</small>
      </article>`).join("");
  }

  async function renderMapStatus() {
    const records = dataRepository.load();
    $("#mapStatusList").innerHTML = records.map(r => `
      <article class="history-item"><b>${r.postingDate}　${formatNumber(r.quantity)}部</b><small>${names.flyer(r.flyerId)}</small></article>`).join("");

    const statusId = "#historyMapStatus";
    try {
      setMapStatus(statusId, "Google Mapsを読み込み中…");
      await loadGoogleMaps();

      if (!state.historyMap) {
        state.historyMap = new google.maps.Map($("#historyGoogleMap"), {
          center: DEFAULT_CENTER,
          zoom: DEFAULT_ZOOM,
          mapTypeControl: false,
          streetViewControl: false,
          fullscreenControl: false,
          clickableIcons: false
        });
      }

      state.historyPolygons.forEach(p => p.setMap(null));
      state.historyPolygons = [];

      const geoRecords = getGeoRecords();
      const allCoords = [];

      geoRecords.forEach((r, index) => {
        allCoords.push(...r.area.coordinates);
        const ageOpacity = Math.max(0.08, 0.24 - index * 0.015);
        const poly = new google.maps.Polygon({
          paths: toLatLngPath(r.area.coordinates),
          strokeColor: "#2F6D4F",
          strokeOpacity: 0.85,
          strokeWeight: 2,
          fillColor: "#2F6D4F",
          fillOpacity: ageOpacity,
          map: state.historyMap,
          clickable: false
        });
        state.historyPolygons.push(poly);
      });

      if (allCoords.length) fitMapToCoordinates(state.historyMap, allCoords);
      hideMapStatus(statusId);
      window.setTimeout(() => google.maps.event.trigger(state.historyMap, "resize"), 50);
    } catch {
      setMapStatus(statusId, "Google Maps APIキーをconfig.jsに設定すると実地図が表示されます。", true);
    }
  }

  function renderAchievements() {
    const pid = $("#achievementParticipantSelect").value || master.participants[0].id;
    const ym = currentYm();
    const records = dataRepository.load().filter(r => r.participants.some(p => p.participantId === pid));

    const totalSteps = records.reduce((s,r) => {
      const p = r.participants.find(x => x.participantId === pid);
      return s + Number(p?.steps || 0);
    },0);

    const monthSteps = records.filter(r => r.postingDate.startsWith(ym)).reduce((s,r) => {
      const p = r.participants.find(x => x.participantId === pid);
      return s + Number(p?.steps || 0);
    },0);

    const totalQty = records.reduce((s,r) => s + Number(r.quantity || 0),0);
    const best = Math.max(0, ...records.map(r => Number(r.participants.find(x => x.participantId === pid)?.steps || 0)));

    const nextGoal = milestoneSteps.find(x => x > totalSteps) || milestoneSteps[milestoneSteps.length - 1];
    const prevGoal = [...milestoneSteps].reverse().find(x => x <= totalSteps) || 0;
    const progress = Math.min(100, Math.max(0, ((totalSteps - prevGoal) / Math.max(1, nextGoal - prevGoal)) * 100));
    const remain = Math.max(0, nextGoal - totalSteps);

    $("#achievementMonthSteps").textContent = formatNumber(monthSteps);
    $("#achievementTotalSteps").textContent = `${formatNumber(totalSteps)}歩`;
    $("#achievementCount").textContent = `${records.length}回`;
    $("#achievementQuantity").textContent = `${formatNumber(totalQty)}部`;
    $("#achievementBest").textContent = `${formatNumber(best)}歩`;
    $("#achievementGoalMessage").textContent = `🌳 ${formatNumber(nextGoal)}歩まであと${formatNumber(remain)}歩！`;
    $("#achievementProgressFill").style.width = `${progress}%`;
    $("#achievementPercent").textContent = `${Math.round(progress)}%`;

    $("#milestoneRow").innerHTML = milestoneSteps.map(goal => `
      <div class="milestone ${totalSteps >= goal ? "is-achieved" : "is-locked"}">
        <div>${totalSteps >= goal ? "🌱" : "○"}</div>
        <div>${formatNumber(goal)}歩</div>
      </div>`).join("");
  }

  function bindEvents() {
    $("#googleLoginButton")
  .addEventListener(
    "click",
    async () => {

      try {

        const authState =
          await window
            .SeedStudioAuth
            .signIn();

        state.authState =
          authState;

        renderAuthState();


        if (
          authState.authorized
        ) {

          await dataRepository
            .reloadFromFirestore();

          renderHome();

          alert(
            "Googleログインが完了しました。"
          );

        } else {

          alert(
            "このGoogleアカウントはSeedStudio職員として登録されていません。"
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
  );


$("#googleLogoutButton")
  .addEventListener(
    "click",
    async () => {

      await window
        .SeedStudioAuth
        .signOut();

      state.authState = {
        signedIn: false,
        authorized: false,
        user: null,
        staff: null
      };

      dataRepository.mode =
        "auth-required";

      renderAuthState();

      navigate("home");
    }
  );


    
    $$("[data-nav]").forEach(b => b.addEventListener("click", () => {
      if (b.dataset.nav === "register-basic") resetDraft();
      navigate(b.dataset.nav);
    }));

    $("#backButton").addEventListener("click", goBack);

    $("#participantList").addEventListener("change", e => {
      if (!e.target.matches("input")) return;
      e.target.closest(".checkbox-row")?.classList.toggle("is-selected", e.target.checked);
    });

    $("#goToMapButton").addEventListener("click", () => {
      if (validateStep1()) navigate("register-map");
    });

    $("#locateButton").addEventListener("click", () => locateCurrentPosition(true));

    $("#undoPointButton").addEventListener("click", () => {
      state.mapPoints.pop();
      drawDraftPolygon();
    });

    $("#resetMapButton").addEventListener("click", () => {
      state.mapPoints = [];
      clearDraftMapGraphics();
    });

    $("#confirmMapButton").addEventListener("click", () => {
      if (state.mapPoints.length < 3) return;
      state.draft.area = {
        type: "Polygon",
        coordinates: state.mapPoints.map(([lng, lat]) => [lng, lat])
      };
      navigate("register-result");
    });

    $("#quantityInput").addEventListener("input", renderConfirm);
    $("#saveRecordButton").addEventListener("click", saveRecord);

    $("#viewHistoryButton").addEventListener("click", () => navigate("history"));

    $("#registerAnotherButton").addEventListener("click", () => {
      resetDraft();
      navigate("register-basic");
    });

    $("#achievementParticipantSelect").addEventListener("change", renderAchievements);
  }

  async function init() {

  renderMasters();

  resetDraft();

  bindEvents();


  await dataRepository.init();


  if (
    window.SeedStudioAuth
  ) {

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
            authState.user?.uid !==
              previousUid
          ) {

            try {

              await dataRepository
                .reloadFromFirestore();

              renderHome();

            } catch (error) {

              console.error(
                "Firestore reload failed.",
                error
              );
            }
          }
        }
      );
  }


  renderHome();

  navigate("home");
}

  document.addEventListener("DOMContentLoaded", () => {
    init().catch((error) => {
      console.error("SeedStudio Posting initialization failed.", error);
      renderHome();
      navigate("home");
    });
  });
})();
