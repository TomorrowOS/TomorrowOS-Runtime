(function (root) {
  const RT = root.TomorrowOSRuntime || (root.TomorrowOSRuntime = {});

  const LAYOUTS = {
    letters: [
      ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"],
      ["q", "w", "e", "r", "t", "y", "u", "i", "o", "p"],
      ["a", "s", "d", "f", "g", "h", "j", "k", "l", "-"],
      ["z", "x", "c", "v", "b", "n", "m", ".", ",", ";"],
      [
        { label: "#+=", action: "togglemode", wide: 2 },
        { label: "SPACE", insert: " ", wide: 3 },
        { label: "DEL", action: "backspace" },
        { label: "CLR", action: "clear" },
        { label: "DONE", action: "done", wide: 3 }
      ]
    ],
    symbols: [
      ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"],
      ["!", "@", "#", "$", "%", "^", "&", "*", "(", ")"],
      [":", "/", "_", "?", "=", "+", ";", "'", "\"", "`"],
      ["{", "}", "[", "]", "<", ">", "|", "\\", "~", "."],
      [
        { label: "ABC", action: "togglemode", wide: 2 },
        { label: "SPACE", insert: " ", wide: 3 },
        { label: "DEL", action: "backspace" },
        { label: "CLR", action: "clear" },
        { label: "DONE", action: "done", wide: 3 }
      ]
    ]
  };

  function specOf(cell) {
    if (typeof cell === "string") return { char: cell };
    return cell;
  }

  const setupUi = { options: null, busy: false };

  function bindSourceSetup(options) {
    const input = document.getElementById("sourceUrlInput");
    const saveBtn = document.getElementById("sourceSaveBtn");
    const builtinBtn = document.getElementById("sourceBuiltinBtn");
    const errorEl = document.getElementById("sourceError");
    const keyboard = document.getElementById("sourceKeyboard");
    const title = document.getElementById("runtimeTitle");
    const intro = document.getElementById("runtimeIntro");
    if (!input || !saveBtn || !builtinBtn || !keyboard) return function () {};
    setupUi.options = options;
    setupUi.busy = false;
    if (saveBtn) saveBtn.disabled = false;

    const shellName = options.shellName || "Signage";
    if (title) title.textContent = `${shellName} application source`;
    if (intro) {
      intro.textContent = options.locked
        ? "This package has a predefined application source."
        : "Choose which application this screen runs. This is separate from the CMS address, which that application configures itself.";
    }

    input.value = options.initialUrl || "";
    let mode = "letters";
    let keyboardOpen = false;
    let row = 0;
    let col = 0;

    input.readOnly = true;
    if (options.locked) {
      builtinBtn.hidden = true;
      saveBtn.textContent = "Continue";
    } else {
      builtinBtn.hidden = false;
      saveBtn.textContent = "Save application source";
    }

    function layout() {
      return LAYOUTS[mode];
    }

    function setError(message) {
      if (errorEl) errorEl.textContent = message || "";
    }

    function buildKeyboard() {
      keyboard.innerHTML = "";
      layout().forEach((line, rowIndex) => {
        const rowEl = document.createElement("div");
        rowEl.className = "runtime-kb-row";
        line.forEach((cell, colIndex) => {
          const spec = specOf(cell);
          const button = document.createElement("button");
          button.type = "button";
          button.className = "runtime-key";
          if (spec.action || spec.insert) button.classList.add("runtime-key-action");
          if (spec.wide === 2) button.classList.add("wide-2");
          if (spec.wide === 3) button.classList.add("wide-3");
          button.textContent = spec.label || spec.char;
          button.dataset.row = String(rowIndex);
          button.dataset.col = String(colIndex);
          button.tabIndex = 0;
          button.addEventListener("click", (event) => {
            event.preventDefault();
            applySpec(spec);
          });
          rowEl.appendChild(button);
        });
        keyboard.appendChild(rowEl);
      });
    }

    function focusKey(nextRow, nextCol) {
      const lines = layout();
      row = Math.max(0, Math.min(lines.length - 1, nextRow));
      col = Math.max(0, Math.min(lines[row].length - 1, nextCol));
      const key = keyboard.querySelector(`.runtime-key[data-row="${row}"][data-col="${col}"]`);
      if (key) key.focus();
    }

    function openKeyboard() {
      if (options.locked) return;
      buildKeyboard();
      keyboard.classList.add("runtime-keyboard-open");
      keyboardOpen = true;
      focusKey(0, 0);
    }

    function closeKeyboard(focusSave) {
      keyboard.classList.remove("runtime-keyboard-open");
      keyboardOpen = false;
      if (focusSave) saveBtn.focus();
      else input.focus();
    }

    function applySpec(spec) {
      if (spec.action === "backspace") {
        input.value = input.value.slice(0, -1);
        return;
      }
      if (spec.action === "clear") {
        input.value = "";
        return;
      }
      if (spec.action === "done") {
        closeKeyboard(true);
        return;
      }
      if (spec.action === "togglemode") {
        mode = mode === "letters" ? "symbols" : "letters";
        buildKeyboard();
        focusKey(layout().length - 1, 0);
        return;
      }
      if (typeof spec.insert === "string") input.value += spec.insert;
      else if (typeof spec.char === "string") input.value += spec.char;
    }

    async function save() {
      const options = setupUi.options || {};
      if (setupUi.busy) return;
      const sourceUrl = options.locked
        ? RT.normalizeSourceUrl(options.initialUrl)
        : RT.normalizeSourceUrl(input.value);
      if (!sourceUrl) {
        setError("Enter an http:// or https:// URL that points at an application manifest.");
        input.focus();
        return;
      }
      setupUi.busy = true;
      saveBtn.disabled = true;
      setError("Checking the application manifest…");
      try {
        const manifest = await RT.fetchManifest(sourceUrl);
        setError("");
        await options.onSave(sourceUrl, manifest);
      } catch (err) {
        setError(err?.message || "Could not read the application manifest.");
        saveBtn.disabled = false;
        setupUi.busy = false;
      }
    }

    function useBuiltin() {
      const options = setupUi.options || {};
      if (setupUi.busy || options.locked) return;
      options.onUseBuiltin();
    }

    function onKeyDown(event) {
      const setup = document.getElementById("runtimeSetup");
      if (!setup || setup.hidden || setup.style.display === "none") return;
      if (document.documentElement.dataset.runtime !== "setup") return;

      const key = event.key;
      const code = event.keyCode;
      const enter = key === "Enter" || code === 13;
      const left = key === "ArrowLeft" || code === 37;
      const right = key === "ArrowRight" || code === 39;
      const up = key === "ArrowUp" || code === 38;
      const down = key === "ArrowDown" || code === 40;
      const backspace = key === "Backspace" || code === 8;
      const back = key === "XF86Back" || key === "GoBack" || key === "Escape" || code === 10009 || code === 27;
      const printable = key && key.length === 1 && !event.ctrlKey && !event.altKey && !event.metaKey;
      const active = document.activeElement;
      const onInput = active === input;
      const onSave = active === saveBtn;
      const onBuiltin = active === builtinBtn;
      const onKey = !!(active && active.classList && active.classList.contains("runtime-key"));

      if (!options.locked && printable) {
        event.preventDefault();
        input.value += key;
        return;
      }
      if (!options.locked && backspace && !keyboardOpen) {
        event.preventDefault();
        input.value = input.value.slice(0, -1);
        return;
      }

      if (keyboardOpen) {
        if (back) {
          event.preventDefault();
          closeKeyboard(false);
          return;
        }
        if (onKey) {
          const lines = layout();
          if (left) {
            event.preventDefault();
            focusKey(row, col > 0 ? col - 1 : lines[row].length - 1);
          } else if (right) {
            event.preventDefault();
            focusKey(row, col < lines[row].length - 1 ? col + 1 : 0);
          } else if (up) {
            event.preventDefault();
            focusKey(row - 1, col);
          } else if (down) {
            event.preventDefault();
            focusKey(row + 1, col);
          } else if (enter) {
            event.preventDefault();
            applySpec(specOf(lines[row][col]));
          } else if (backspace) {
            event.preventDefault();
            input.value = input.value.slice(0, -1);
          }
          return;
        }
        if (enter || up || down || left || right) {
          event.preventDefault();
          if (onInput && down) closeKeyboard(true);
          else focusKey(0, 0);
        }
        return;
      }

      if (onInput) {
        if (enter || up || left || right) {
          event.preventDefault();
          openKeyboard();
        } else if (down) {
          event.preventDefault();
          saveBtn.focus();
        }
        return;
      }
      if (onSave) {
        if (up) {
          event.preventDefault();
          input.focus();
        } else if (right && !builtinBtn.hidden) {
          event.preventDefault();
          builtinBtn.focus();
        } else if (enter) {
          event.preventDefault();
          void save();
        }
        return;
      }
      if (onBuiltin) {
        if (left) {
          event.preventDefault();
          saveBtn.focus();
        } else if (up) {
          event.preventDefault();
          input.focus();
        } else if (enter) {
          event.preventDefault();
          useBuiltin();
        }
        return;
      }
      if (enter || up || down || left || right) {
        event.preventDefault();
        input.focus();
      }
    }

    if (saveBtn.dataset.bound !== "1") {
      saveBtn.dataset.bound = "1";
      saveBtn.addEventListener("click", () => void save());
      builtinBtn.addEventListener("click", useBuiltin);
      input.addEventListener("paste", (event) => {
        const text = event.clipboardData?.getData("text") || "";
        if (!text || (setupUi.options && setupUi.options.locked)) return;
        event.preventDefault();
        input.value += text;
      });
    }
    document.addEventListener("keydown", onKeyDown, true);
    buildKeyboard();
    if (!options.locked) input.focus();
    else saveBtn.focus();

    return function unbind() {
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }

  RT.bindSourceSetup = bindSourceSetup;
})(typeof globalThis !== "undefined" ? globalThis : this);
