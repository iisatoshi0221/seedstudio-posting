(function (root) {
  "use strict";

  // P02: Pure selection logic + real DOM API rendering. No Firestore writes.
  function makeFlyerUi(model) {
    if (!model || typeof model.normalizeFlyerIds !== "function") {
      throw new Error("POSTING_MODEL_REQUIRED");
    }

    function sameSet(a, b) {
      return a.length === b.length &&
        new Set(a).size === a.length &&
        new Set(b).size === b.length &&
        a.every(id => b.includes(id));
    }

    function getEditDraft(record) {
      if (!model.isFlyerSelectionConsistent(record)) {
        throw new Error("INVALID_FLYER_SELECTION");
      }
      return {
        flyerIds: model.getFlyerIds(record),
        originalFlyerIds: model.getFlyerIds(record),
        originalHasFlyerIds: Object.prototype.hasOwnProperty.call(record, "flyerIds")
      };
    }

    function getFlyerChanges(draft) {
      const current = model.normalizeFlyerIds(draft.flyerIds);
      const original = model.normalizeFlyerIds(draft.originalFlyerIds);
      if (sameSet(current, original)) return {};
      // Preserve original ordering; newly selected IDs follow selection order.
      const ordered = [
        ...original.filter(id => current.includes(id)),
        ...current.filter(id => !original.includes(id))
      ];
      return model.createFlyerSelection(ordered);
    }

    function getSaveFields(ids) {
      return model.createFlyerSelection(ids);
    }

    function listOptions(flyers, ids, mode, resolveLabel) {
      const selected = new Set(ids);
      const items = [];
      const seen = new Set();
      for (const flyer of flyers) {
        if (!flyer || typeof flyer.id !== "string" || !model.FLYER_ID_PATTERN.test(flyer.id) || seen.has(flyer.id)) continue;
        seen.add(flyer.id);
        const active = flyer.active === true;
        if (!active && !(mode === "edit" && selected.has(flyer.id))) continue;
        items.push({id: flyer.id, name: String(flyer.name ?? flyer.id), active, checked: selected.has(flyer.id)});
      }
      if (mode === "edit") {
        for (const id of ids) {
          if (seen.has(id)) continue;
          seen.add(id);
          items.push({id, name: String(resolveLabel?.(id) ?? id), active: false, checked: true});
        }
      }
      return items;
    }

    function mount({container, flyers, selectedIds = [], mode = "new", document, onChange = () => {}, resolveLabel}) {
      if (!container || !document || !["new", "edit"].includes(mode)) {
        throw new Error("INVALID_FLYER_UI_OPTIONS");
      }
      if (!Array.isArray(selectedIds)) throw new Error("INVALID_FLYER_SELECTION");
      // Empty selection is a valid draft state, but not valid for saving.
      let selected = selectedIds.length ? model.normalizeFlyerIds(selectedIds) : [];
      let catalog = Array.isArray(flyers) ? flyers : [];
      let listener;

      function render() {
        const options = listOptions(catalog, selected, mode, resolveLabel);
        const nodes = options.map(item => {
          const label = document.createElement("label");
          label.className = "flyer-choice";
          const input = document.createElement("input");
          input.type = "checkbox";
          input.value = item.id;
          input.checked = item.checked;
          const caption = document.createElement("span");
          caption.textContent = item.name + (item.active ? "" : "（過去）");
          label.append(input, caption);
          return label;
        });
        if (!nodes.length) {
          const message = document.createElement("p");
          message.textContent = "選択可能なチラシがありません";
          nodes.push(message);
        }
        container.replaceChildren(...nodes);
      }

      listener = event => {
        const input = event.target;
        if (!input || input.type !== "checkbox") return;
        const id = input.value;
        const option = listOptions(catalog, selected, mode, resolveLabel).find(item => item.id === id);
        if (!option) return;
        if (input.checked && !option.active && !selected.includes(id)) {
          render(); // An archived flyer cannot be re-added after removal.
          return;
        }
        const candidate = input.checked
          ? [...selected.filter(value => value !== id), id]
          : selected.filter(value => value !== id);
        if (candidate.length) {
          try { model.normalizeFlyerIds(candidate); }
          catch (error) { render(); return; }
        }
        selected = candidate;
        render();
        onChange([...selected]);
      };
      container.addEventListener("change", listener);
      render();
      return {
        getSelected: () => [...selected],
        setSelected(ids) {
          selected = ids.length ? model.normalizeFlyerIds(ids) : [];
          render();
        },
        setFlyers(nextFlyers) {
          catalog = Array.isArray(nextFlyers) ? nextFlyers : [];
          render(); // Do not auto-select after master refresh.
        },
        destroy() {
          container.removeEventListener("change", listener);
          container.replaceChildren();
        }
      };
    }

    return Object.freeze({sameSet, getEditDraft, getFlyerChanges, getSaveFields, listOptions, mount});
  }

  root.SeedStudioPostingFlyerUi = Object.freeze({makeFlyerUi});
})(typeof window !== "undefined" ? window : globalThis);
