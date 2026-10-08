(() => {
  "use strict";

  const STORAGE_KEY = "seedstudio-posting-v0.1-records";

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
    mapPoints: [],
    draft: {},
    lastSavedRecord: null
  };

  const milestoneSteps = [10000, 50000, 100000, 250000, 500000];

  const dataRepository = {
    load() {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        const demo = [{
          id: "DEMO-20261007",
          postingDate: "2026-10-07",
          staffId: "S0001",
          flyerId: "F0001",
          quantity: 180,
          participants: [
            { participantId: "U0001", steps: 4820 },
            { participantId: "U0002", steps: 5130 }
          ],
          area: {
            type: "Polygon",
            normalized: [[0.18,0.24],[0.54,0.18],[0.71,0.55],[0.38,0.69],[0.17,0.51]]
          },
          createdAt: new Date().toISOString()
        }];
        this.save(demo);
        return demo;
      }
      try { return JSON.parse(raw); } catch { return []; }
    },
    save(records) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
    },
    add(record) {
      const records = this.load();
      records.push(record);
      this.save(records);
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
    drawPolygon($("#mapSvg"), []);
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
    if (view === "register-result") renderResultStep();
    if (view === "success") renderSuccess();
    if (view === "achievements") renderAchievements();
    if (view === "history") renderHistory();
    if (view === "map") renderMapStatus();

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

  function normalizedPoint(event, element) {
    const rect = element.getBoundingClientRect();
    return [
      Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)),
      Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height))
    ];
  }

  function drawPolygon(svg, points, withMarkers = false) {
    if (!svg) return;
    svg.innerHTML = "";
    if (!points?.length) return;

    const w = svg.clientWidth || svg.parentElement.clientWidth || 300;
    const h = svg.clientHeight || svg.parentElement.clientHeight || 200;

    const poly = document.createElementNS("http://www.w3.org/2000/svg","polygon");
    poly.setAttribute("points", points.map(([x,y]) => `${x*w},${y*h}`).join(" "));
    poly.setAttribute("fill","rgba(47,109,79,.23)");
    poly.setAttribute("stroke","#2F6D4F");
    poly.setAttribute("stroke-width","3");
    svg.appendChild(poly);

    if (withMarkers) {
      points.forEach(([x,y], index) => {
        const c = document.createElementNS("http://www.w3.org/2000/svg","circle");
        c.setAttribute("cx",x*w); c.setAttribute("cy",y*h); c.setAttribute("r","13");
        c.setAttribute("fill","#2F6D4F"); c.setAttribute("stroke","#fff"); c.setAttribute("stroke-width","2");
        const t = document.createElementNS("http://www.w3.org/2000/svg","text");
        t.setAttribute("x",x*w); t.setAttribute("y",y*h+4); t.setAttribute("text-anchor","middle");
        t.setAttribute("fill","#fff"); t.setAttribute("font-size","11"); t.setAttribute("font-weight","800");
        t.textContent = String(index + 1);
        svg.appendChild(c); svg.appendChild(t);
      });
    }
  }

  function renderMapDraft() {
    drawPolygon($("#mapSvg"), state.mapPoints, true);
    $("#confirmMapButton").disabled = state.mapPoints.length < 3;
    $("#overlapWarning").classList.toggle("is-hidden", state.mapPoints.length < 3 || dataRepository.load().length === 0);
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
    if (state.draft.area?.normalized) {
      requestAnimationFrame(() => drawPolygon($("#confirmMapSvg"), state.draft.area.normalized));
    }
  }

  function saveRecord() {
    state.draft.quantity = Number($("#quantityInput").value || 0);
    const validQty = state.draft.quantity > 0;
    const validSteps = state.draft.participantIds.every(id => Number(state.draft.participantSteps[id] || 0) > 0);

    if (!validQty || !validSteps) {
      alert("配布部数と参加した人全員の歩数を入力してください。");
      return;
    }

    const record = {
      id: `P-${Date.now()}`,
      postingDate: state.draft.postingDate,
      staffId: state.draft.staffId,
      flyerId: state.draft.flyerId,
      quantity: state.draft.quantity,
      participants: state.draft.participantIds.map(id => ({ participantId:id, steps:Number(state.draft.participantSteps[id]) })),
      area: state.draft.area,
      createdAt: new Date().toISOString()
    };

    dataRepository.add(record);
    state.lastSavedRecord = record;
    navigate("success");
  }

  function renderSuccess() {
    const r = state.lastSavedRecord;
    if (!r) return;
    $("#successQuantity").textContent = `${formatNumber(r.quantity)}部`;
    $("#successParticipants").innerHTML = r.participants.map(p => `
      <div class="participant-result">
        ${names.participant(p.participantId)}
        <b>🚶 ${formatNumber(p.steps)}歩</b>
      </div>`).join("");
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

  function renderMapStatus() {
    const svg = $("#historyMapSvg");
    svg.innerHTML = "";
    const records = dataRepository.load();
    const w = svg.clientWidth || svg.parentElement.clientWidth || 300;
    const h = svg.clientHeight || svg.parentElement.clientHeight || 400;

    records.forEach(r => {
      if (!r.area?.normalized) return;
      const poly = document.createElementNS("http://www.w3.org/2000/svg","polygon");
      poly.setAttribute("points", r.area.normalized.map(([x,y]) => `${x*w},${y*h}`).join(" "));
      poly.setAttribute("fill","rgba(47,109,79,.18)");
      poly.setAttribute("stroke","#2F6D4F");
      poly.setAttribute("stroke-width","2");
      svg.appendChild(poly);
    });

    $("#mapStatusList").innerHTML = records.map(r => `
      <article class="history-item"><b>${r.postingDate}　${formatNumber(r.quantity)}部</b><small>${names.flyer(r.flyerId)}</small></article>`).join("");
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

    $("#postingMap").addEventListener("click", e => {
      state.mapPoints.push(normalizedPoint(e, $("#postingMap")));
      renderMapDraft();
    });

    $("#undoPointButton").addEventListener("click", () => {
      state.mapPoints.pop();
      renderMapDraft();
    });

    $("#resetMapButton").addEventListener("click", () => {
      state.mapPoints = [];
      renderMapDraft();
    });

    $("#confirmMapButton").addEventListener("click", () => {
      if (state.mapPoints.length < 3) return;
      state.draft.area = { type:"Polygon", normalized:[...state.mapPoints] };
      navigate("register-result");
    });

    $("#quantityInput").addEventListener("input", renderConfirm);
    $("#saveRecordButton").addEventListener("click", saveRecord);

    $("#registerAnotherButton").addEventListener("click", () => {
      resetDraft();
      navigate("register-basic");
    });

    $("#achievementParticipantSelect").addEventListener("change", renderAchievements);
  }

  function init() {
    renderMasters();
    resetDraft();
    bindEvents();
    renderHome();
    navigate("home");
  }

  document.addEventListener("DOMContentLoaded", init);
})();