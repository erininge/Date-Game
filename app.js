// Changelog:
// - v2.0.0: token-based audio sequencing, base audio tokens, caching improvements, cache bump.
(() => {
  const APP_VERSION = "2.0.0";
  const STATE_KEY = "kats-date-game-state-v1";
  const DATA_URL = "date_game_data.json";
  const AUDIO_MANIFEST_URL = "Audio/base/manifest.json";
  const VOICEVOX_SPEAKER = "東北きりたん（ノーマル）";
  const DEFAULT_PAUSE_TOKEN = "pause_120";

  const CATEGORY_LABELS = {
    day_of_month: "Day of the month (example: 7th)",
    months: "months (example April)",
    weekdays: "weekdays (example Monday)",
    dates: "dates (example November 7th)",
    full_date: "Full date (example Monday May 11th)"
  };

  const DEFAULTS = {
    category: "dates",
    questionMode: "mixed", // en_to_jp | jp_to_en | mixed
    answerMode: "multiple", // multiple | typing | mixed
    displayMode: "kana", // kana | kanji | both
    questionsPerQuiz: 20,
    focusMode: "all", // all | irregular
    audioEnabled: true,
    audioVolume: 1
  };

  let DATA = null;
  let state = loadState();
  let quiz = null;
  let audioIndex = new Map();
  let audioManifestLoaded = false;
  let audioManifestError = false;
  let audioContext = null;
  let audioBufferCache = new Map();
  let activeSequenceId = 0;
  let activeAudioSources = [];

  function loadState(){
    try{
      const raw = localStorage.getItem(STATE_KEY);
      if(!raw) return {...DEFAULTS};
      const parsed = JSON.parse(raw);
      return {...DEFAULTS, ...parsed};
    }catch(e){
      return {...DEFAULTS};
    }
  }
  function saveState(){
    localStorage.setItem(STATE_KEY, JSON.stringify(state));
  }

  function el(tag, attrs={}, children=[]){
    const n = document.createElement(tag);
    for(const [k,v] of Object.entries(attrs)){
      if(k === "class") n.className = v;
      else if(k === "html") n.innerHTML = v;
      else if(k.startsWith("on") && typeof v === "function") n.addEventListener(k.slice(2).toLowerCase(), v);
      else n.setAttribute(k,v);
    }
    for(const c of children){
      if(typeof c === "string") n.appendChild(document.createTextNode(c));
      else if(c) n.appendChild(c);
    }
    return n;
  }

  function normalizeJP(s){
    return (s||"").replace(/\s+/g,"").trim();
  }
  function normalizeEN(s){
    return (s||"").toLowerCase().replace(/\s+/g," ").trim();
  }

  function getJP(item){
    if(state.displayMode === "kana") return item.jp_kana;
    if(state.displayMode === "kanji") return item.jp_kanji;
    // both
    if(item.jp_kanji && item.jp_kana) return `${item.jp_kana} (${item.jp_kanji})`;
    return item.jp_kana || item.jp_kanji || "";
  }

  function getAudioContext(){
    if(!audioContext){
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if(!Ctx) return null;
      audioContext = new Ctx();
    }
    return audioContext;
  }

  async function getAudioBuffer(src, ctx){
    if(audioBufferCache.has(src)) return audioBufferCache.get(src);
    try{
      const res = await fetch(src);
      const data = await res.arrayBuffer();
      const buffer = await ctx.decodeAudioData(data);
      audioBufferCache.set(src, buffer);
      return buffer;
    }catch(e){
      console.warn(`Audio load failed: ${src}`, e);
      return null;
    }
  }

  function stopActiveAudio(){
    activeAudioSources.forEach((source) => {
      try{ source.stop(); }catch(e){}
    });
    activeAudioSources = [];
  }

  function getVolume(){
    const volume = Number(state.audioVolume);
    if(Number.isFinite(volume)){
      return Math.max(0, Math.min(volume, 1));
    }
    return 1;
  }

  function playBuffer(buffer, ctx, sequenceId){
    return new Promise((resolve) => {
      if(sequenceId !== activeSequenceId){
        resolve();
        return;
      }
      const source = ctx.createBufferSource();
      const gainNode = ctx.createGain();
      gainNode.gain.value = getVolume();
      source.buffer = buffer;
      source.connect(gainNode);
      gainNode.connect(ctx.destination);
      activeAudioSources.push(source);
      source.onended = () => {
        activeAudioSources = activeAudioSources.filter(s => s !== source);
        resolve();
      };
      try{
        source.start(0);
      }catch(e){
        resolve();
      }
    });
  }

  async function playAudioSequence(tokens){
    if(!state.audioEnabled) return;
    const ctx = getAudioContext();
    if(!ctx) return;
    activeSequenceId += 1;
    const sequenceId = activeSequenceId;
    stopActiveAudio();
    try{ await ctx.resume(); }catch(e){}

    for(const token of tokens){
      if(sequenceId !== activeSequenceId) return;
      const src = audioIndex.get(token);
      if(!src){
        console.warn(`Missing audio token: ${token}`);
        continue;
      }
      const buffer = await getAudioBuffer(src, ctx);
      if(!buffer){
        console.warn(`Unable to decode audio token: ${token}`);
        continue;
      }
      if(sequenceId !== activeSequenceId) return;
      await playBuffer(buffer, ctx, sequenceId);
    }
  }

  function buildVoicevoxLine(text, index){
    const idx = String(index).padStart(3, "0");
    return `${idx}_${VOICEVOX_SPEAKER}_${text}`;
  }

  function getPromptAndAnswer(item){
    // Determine direction
    let dir = state.questionMode;
    if(dir === "mixed") dir = Math.random() < 0.5 ? "en_to_jp" : "jp_to_en";

    let prompt, answer, answerAlt=null, sub=null;
    if(dir === "en_to_jp"){
      prompt = item.en;
      sub = "EN → JP";
      answer = getJP(item);
      // Accept kana/kanji/both based on display
      answerAlt = (state.displayMode === "both") ? [item.jp_kana, item.jp_kanji] : null;
    }else{
      prompt = getJP(item);
      sub = "JP → EN";
      answer = item.en;
      answerAlt = null;
    }
    return {prompt, answer, dir, sub, answerAlt};
  }

  function eligibleItems(){
    let items = DATA.items.filter(x => x.category === state.category);
    if(state.focusMode === "irregular"){
      items = items.filter(x => x.irregular);
    }
    return items;
  }

  function focusModeAvailable(){
    const items = DATA.items.filter(x => x.category === state.category);
    return items.some(x => x.irregular);
  }

  async function loadAudioManifest(){
    audioIndex = new Map();
    audioManifestLoaded = false;
    audioManifestError = false;
    try{
      const res = await fetch(AUDIO_MANIFEST_URL, {cache: "no-store"});
      if(!res.ok){
        return;
      }
      const data = await res.json();
      const tokenMap = data.tokens || data.mapping || data.map || data;
      if(tokenMap && typeof tokenMap === "object"){
        Object.entries(tokenMap).forEach(([token, file]) => {
          if(typeof file !== "string") return;
          const clean = file.replace(/^\.\//, "");
          const path = clean.startsWith("Audio/") ? clean : `Audio/${clean}`;
          if(token) audioIndex.set(token, path);
        });
      }
      audioManifestLoaded = true;
    }catch(e){
      audioManifestError = true;
    }
  }

  function getBaseTokenEntries(){
    if(!DATA) return [];
    const monthItems = DATA.items.filter(item => item.category === "months");
    const weekdayItems = DATA.items.filter(item => item.category === "weekdays");
    const domItems = DATA.items.filter(item => item.category === "day_of_month");

    const months = monthItems
      .map(item => ({item, num: parseInt(item.id.split("_")[1], 10)}))
      .filter(({num}) => Number.isFinite(num))
      .sort((a,b) => a.num - b.num)
      .map(({item, num}) => ({
        token: `month_${num}`,
        label: item.en,
        text: item.jp_kana || item.jp_kanji || item.en
      }));

    const weekdays = weekdayItems
      .map(item => ({item, num: parseInt(item.id.split("_")[1], 10)}))
      .filter(({num}) => Number.isFinite(num))
      .sort((a,b) => a.num - b.num)
      .map(({item, num}) => ({
        token: `weekday_${num + 1}`,
        label: item.en,
        text: item.jp_kana || item.jp_kanji || item.en
      }));

    const days = domItems
      .map(item => ({item, num: parseInt(item.id.split("_")[1], 10)}))
      .filter(({num}) => Number.isFinite(num))
      .sort((a,b) => a.num - b.num)
      .map(({item, num}) => ({
        token: `day_${num}`,
        label: item.en,
        text: item.jp_kana || item.jp_kanji || item.en
      }));

    return [...months, ...weekdays, ...days];
  }

  function getMissingAudioTokens(){
    const tokens = getBaseTokenEntries();
    if(!audioManifestLoaded) return tokens;
    return tokens.filter(entry => !audioIndex.has(entry.token));
  }

  function normalizeWeekdayNumber(value){
    if(!Number.isFinite(value)) return null;
    if(value === 0) return 1;
    if(value >= 1 && value <= 7) return value;
    if(value >= 0 && value <= 6) return value + 1;
    return null;
  }

  function parseItemNumbers(item){
    const result = {
      month: Number.isFinite(item.month) ? item.month : null,
      day: Number.isFinite(item.day) ? item.day : null,
      weekday: Number.isFinite(item.weekday) ? normalizeWeekdayNumber(item.weekday) : null
    };

    const id = item.id || "";
    const monthMatch = id.match(/^month_(\d+)$/);
    if(monthMatch) result.month = parseInt(monthMatch[1], 10);

    const weekdayMatch = id.match(/^weekday_(\d+)$/);
    if(weekdayMatch) result.weekday = normalizeWeekdayNumber(parseInt(weekdayMatch[1], 10));

    const domMatch = id.match(/^dom_(\d+)$/);
    if(domMatch) result.day = parseInt(domMatch[1], 10);

    const dateMatch = id.match(/^date_(\d+)_(\d+)$/);
    if(dateMatch){
      result.month = parseInt(dateMatch[1], 10);
      result.day = parseInt(dateMatch[2], 10);
    }

    const fullDateMatch = id.match(/^fulldate_(\d+)_(\d+)_(\d+)$/);
    if(fullDateMatch){
      result.weekday = normalizeWeekdayNumber(parseInt(fullDateMatch[1], 10));
      result.month = parseInt(fullDateMatch[2], 10);
      result.day = parseInt(fullDateMatch[3], 10);
    }

    return result;
  }

  function getAudioTokensForItem(item){
    const {month, day, weekday} = parseItemNumbers(item);
    switch(item.category){
      case "months":
        return month ? [`month_${month}`] : [];
      case "weekdays":
        return weekday ? [`weekday_${weekday}`] : [];
      case "day_of_month":
        return day ? [`day_${day}`] : [];
      case "dates":
        return (month && day) ? [`month_${month}`, `day_${day}`] : [];
      case "full_date": {
        if(!weekday || !month || !day) return [];
        const tokens = [`weekday_${weekday}`];
        if(audioIndex.has(DEFAULT_PAUSE_TOKEN)) tokens.push(DEFAULT_PAUSE_TOKEN);
        tokens.push(`month_${month}`, `day_${day}`);
        return tokens;
      }
      default:
        return [];
    }
  }

  function sample(arr, n){
    const copy = arr.slice();
    for(let i=copy.length-1;i>0;i--){
      const j = Math.floor(Math.random()*(i+1));
      [copy[i],copy[j]] = [copy[j],copy[i]];
    }
    return copy.slice(0, n);
  }

  function startQuiz(){
    const pool = eligibleItems();
    if(pool.length === 0){
      alert("No items found for this selection. Try Focus mode: All items.");
      return;
    }
    const qCount = Math.max(1, Math.min(parseInt(state.questionsPerQuiz||20,10), 200));
    const items = [];
    while(items.length < qCount){
      items.push(pool[Math.floor(Math.random()*pool.length)]);
    }
    quiz = {
      idx: 0,
      items,
      correct: 0,
      modeCache: null, // used for typing correctness
      typingMisses: new Set(),
    };
    renderQuiz();
  }

  function renderSettings(){
    const root = document.getElementById("root");
    root.innerHTML = "";

    const selectedItems = eligibleItems();

    const card = el("div", {class:"card"}, [
      el("div", {class:"h1"}, ["Study setup"]),

      el("div", {class:"label"}, ["Category"]),
      (() => {
        const sel = el("select", {class:"select"});
        for(const [k,label] of Object.entries(CATEGORY_LABELS)){
          const opt = el("option", {value:k}, [label]);
          if(state.category === k) opt.selected = true;
          sel.appendChild(opt);
        }
        sel.addEventListener("change", () => {
          state.category = sel.value;
          // If irregular unavailable, force all
          if(!focusModeAvailable()) state.focusMode = "all";
          saveState();
          renderSettings();
        });
        return sel;
      })(),

      el("div", {class:"label"}, ["Question mode"]),
      (() => {
        const sel = el("select", {class:"select"});
        const opts = [
          ["en_to_jp","EN → JP"],
          ["jp_to_en","JP → EN"],
          ["mixed","Mixed (JP→EN and EN→JP)"],
        ];
        for(const [v,lab] of opts){
          const opt = el("option", {value:v}, [lab]);
          if(state.questionMode === v) opt.selected = true;
          sel.appendChild(opt);
        }
        sel.addEventListener("change", () => { state.questionMode = sel.value; saveState(); });
        return sel;
      })(),

      el("div", {class:"label"}, ["Answer types"]),
      (() => {
        const sel = el("select", {class:"select"});
        const opts = [
          ["multiple","Multiple choice"],
          ["typing","Typing"],
          ["mixed","Mixed"],
        ];
        for(const [v,lab] of opts){
          const opt = el("option", {value:v}, [lab]);
          if(state.answerMode === v) opt.selected = true;
          sel.appendChild(opt);
        }
        sel.addEventListener("change", () => { state.answerMode = sel.value; saveState(); });
        return sel;
      })(),

      el("div", {class:"label"}, ["Display"]),
      (() => {
        const sel = el("select", {class:"select"});
        const opts = [
          ["kana","Kana"],
          ["kanji","Kanji"],
          ["both","Both"],
        ];
        for(const [v,lab] of opts){
          const opt = el("option", {value:v}, [lab]);
          if(state.displayMode === v) opt.selected = true;
          sel.appendChild(opt);
        }
        sel.addEventListener("change", () => { state.displayMode = sel.value; saveState(); });
        return sel;
      })(),

      el("div", {class:"label"}, ["Questions per quiz"]),
      (() => {
        const inp = el("input", {class:"input", type:"number", min:"1", max:"200", value:String(state.questionsPerQuiz)});
        inp.addEventListener("input", () => { state.questionsPerQuiz = parseInt(inp.value||"20",10); saveState(); });
        return inp;
      })(),

      el("div", {class:"label"}, ["Focus mode"]),
      (() => {
        const sel = el("select", {class:"select"});
        const irregularAvail = focusModeAvailable();
        const opts = [
          ["all","All items"],
          ["irregular","Irregular only"],
        ];
        for(const [v,lab] of opts){
          const opt = el("option", {value:v}, [lab]);
          if(v==="irregular" && !irregularAvail){
            opt.disabled = true;
            opt.textContent = "Irregular only (unavailable)";
          }
          if(state.focusMode === v) opt.selected = true;
          sel.appendChild(opt);
        }
        sel.addEventListener("change", () => { state.focusMode = sel.value; saveState(); });
        // If it became invalid:
        if(!irregularAvail && state.focusMode === "irregular"){
          state.focusMode = "all"; saveState();
        }
        return sel;
      })(),

      el("div", {class:"row"}, [
        el("button", {class:"btn secondary", onclick: () => renderSelectedWordsModal(selectedItems)}, ["View selected words"]),
        el("div", {class:"selection-count"}, [
          el("div", {class:"label"}, ["Selected words"]),
          el("div", {class:"count"}, [`${selectedItems.length}`])
        ])
      ]),

      (() => {
        const missingTokens = getMissingAudioTokens();
        const totalTokens = getBaseTokenEntries().length;
        const availableCount = Math.max(0, totalTokens - missingTokens.length);
        const audioLabel = audioManifestLoaded
          ? `${availableCount} ready • ${missingTokens.length} missing`
          : (audioManifestError ? "Manifest error" : "Manifest not loaded");

        return el("div", {class:"row"}, [
          el("button", {class:"btn secondary", onclick: () => renderMissingAudio()}, ["Missing audio"]),
          el("div", {class:"selection-count"}, [
            el("div", {class:"label"}, ["Audio status"]),
            el("div", {class:"count"}, [audioLabel])
          ])
        ]);
      })(),

      el("div", {class:"label"}, ["Audio"]),
      (() => {
        const row = el("div", {class:"row"});
        const toggleInput = el("input", {type:"checkbox"});
        toggleInput.checked = !!state.audioEnabled;
        const toggle = el("label", {class:"toggle-row"}, [
          toggleInput,
          el("span", {}, ["Enable audio"])
        ]);
        const volumeWrap = el("div", {class:"volume-row"});
        const volumeLabel = el("span", {class:"small"}, [`Volume: ${Math.round(getVolume() * 100)}%`]);
        const volume = el("input", {
          type:"range",
          min:"0",
          max:"1",
          step:"0.05",
          value:String(getVolume()),
          class:"slider"
        });
        toggleInput.addEventListener("change", (e) => {
          state.audioEnabled = e.target.checked;
          if(!state.audioEnabled){
            stopActiveAudio();
          }
          saveState();
        });
        volume.addEventListener("input", (e) => {
          state.audioVolume = parseFloat(e.target.value);
          volumeLabel.textContent = `Volume: ${Math.round(getVolume() * 100)}%`;
          saveState();
        });
        volumeWrap.appendChild(volumeLabel);
        volumeWrap.appendChild(volume);
        row.appendChild(toggle);
        row.appendChild(volumeWrap);
        return row;
      })(),

      el("div", {class:"help"}, [
        "Tip: If you're doing typing mode with Display = Both, you can type either the kana OR the kanji answer. Spaces are ignored."
      ]),

      el("hr", {class:"sep"}),

      el("div", {class:"row"}, [
        el("button", {class:"btn", onclick: () => {
          // reset
          state = {...DEFAULTS};
          saveState();
          renderSettings();
        }}, ["Reset"]),
        el("button", {class:"btn secondary", onclick: () => startQuiz()}, ["Start quiz"])
      ])
    ]);

    root.appendChild(card);
  }

  function renderSelectedWordsModal(items){
    const overlay = el("div", {class:"modal-backdrop"});
    const closeModal = () => overlay.remove();

    const list = el("div", {class:"word-list"});
    if(items.length === 0){
      list.appendChild(el("div", {class:"word-empty"}, ["No words match your current selection."]));
    }else{
      items.forEach(item => {
        list.appendChild(el("div", {class:"word-row"}, [
          el("div", {class:"word-jp"}, [getJP(item)]),
          el("div", {class:"word-en"}, [item.en])
        ]));
      });
    }

    const modal = el("div", {class:"modal"}, [
      el("div", {class:"modal-header"}, [
        el("div", {class:"h2"}, ["Selected words"]),
        el("button", {class:"linkish", onclick: closeModal}, ["Close"])
      ]),
      el("div", {class:"modal-sub"}, [
        `${items.length} words • ${CATEGORY_LABELS[state.category]}`
      ]),
      list
    ]);

    overlay.addEventListener("click", (event) => {
      if(event.target === overlay) closeModal();
    });

    overlay.appendChild(modal);
    document.body.appendChild(overlay);
  }

  function renderMissingAudio(){
    const root = document.getElementById("root");
    root.innerHTML = "";

    const missingTokens = getMissingAudioTokens();
    const baseTokens = getBaseTokenEntries();

    const title = audioManifestLoaded
      ? "Missing audio"
      : "Missing audio (manifest not loaded)";
    const subtitle = audioManifestLoaded
      ? `${missingTokens.length} missing • ${baseTokens.length} total`
      : (audioManifestError
        ? "Audio manifest found, but it could not be parsed."
        : "Add Audio/base/manifest.json then refresh to see exact missing files.");

    const list = el("div", {class:"audio-list"});
    if(missingTokens.length === 0){
      list.appendChild(el("div", {class:"word-empty"}, ["Everything has audio."]));
    }else{
      missingTokens.forEach((entry) => {
        list.appendChild(el("div", {class:"audio-row"}, [
          el("div", {class:"audio-main"}, [entry.label]),
          el("div", {class:"audio-sub"}, [entry.text]),
          el("div", {class:"audio-file"}, [`Token: ${entry.token}`])
        ]));
      });
    }

    const downloadBtn = el("button", {class:"btn secondary"}, ["Download Voicevox list (.txt)"]);
    downloadBtn.addEventListener("click", () => {
      const lines = missingTokens.map((entry, idx) => buildVoicevoxLine(entry.text, idx + 1));
      const blob = new Blob([lines.join("\n")], {type: "text/plain"});
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "voicevox_missing_audio.txt";
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    });
    if(missingTokens.length === 0){
      downloadBtn.disabled = true;
    }

    const card = el("div", {class:"card"}, [
      el("div", {class:"quiz-top"}, [
        el("div", {class:"pill"}, [title]),
        el("button", {class:"linkish", onclick: () => renderSettings()}, ["Back"])
      ]),
      el("div", {class:"subq"}, [subtitle]),
      el("div", {class:"row"}, [downloadBtn]),
      el("div", {class:"help"}, [
        "Audio files should live in the Audio/ folder and be referenced by tokens in Audio/base/manifest.json."
      ]),
      list
    ]);

    root.appendChild(card);
  }

  function pickAnswerMode(){
    if(state.answerMode === "mixed"){
      return Math.random() < 0.5 ? "multiple" : "typing";
    }
    return state.answerMode;
  }

  function buildChoices(correctText, direction){
    // direction affects what pool we sample from:
    // if EN->JP, choices are JP; else EN
    const pool = eligibleItems();
    const texts = new Set([correctText]);

    // We'll add 3 distractors
    let safety = 0;
    while(texts.size < 4 && safety < 500){
      safety++;
      const it = pool[Math.floor(Math.random()*pool.length)];
      const text = (direction === "en_to_jp") ? getJP(it) : it.en;
      if(text) texts.add(text);
    }
    const arr = Array.from(texts);
    // shuffle
    for(let i=arr.length-1;i>0;i--){
      const j = Math.floor(Math.random()*(i+1));
      [arr[i],arr[j]] = [arr[j],arr[i]];
    }
    return arr;
  }

  function renderQuiz(){
    const root = document.getElementById("root");
    root.innerHTML = "";

    const item = quiz.items[quiz.idx];
    const meta = getPromptAndAnswer(item);
    const mode = pickAnswerMode();
    const audioTokens = getAudioTokensForItem(item);

    const top = el("div", {class:"quiz-top"}, [
      el("div", {class:"pill"}, [`${quiz.idx+1} / ${quiz.items.length}`]),
      el("div", {class:"pill"}, [meta.sub]),
      el("button", {class:"linkish", onclick: () => { quiz=null; renderSettings(); }}, ["Back"])
    ]);

    const q = el("div", {class:"question"}, [meta.prompt]);
    const sub = el("div", {class:"subq"}, [
      `${CATEGORY_LABELS[state.category]} • ${mode === "multiple" ? "Multiple choice" : "Typing"}`
    ]);

    const card = el("div", {class:"card"}, [top, q, sub]);
    if(audioTokens.length > 0){
      const audioRow = el("div", {class:"audio-controls"}, [
        el("button", {class:"btn secondary small", onclick: () => playAudioSequence(audioTokens)}, ["Play audio"])
      ]);
      card.appendChild(audioRow);
    }

    if(mode === "multiple"){
      const choices = buildChoices(meta.answer, meta.dir);
      const box = el("div", {class:"choices"});
      let locked = false;

      choices.forEach(txt => {
        const btn = el("button", {class:"choice"}, [txt]);
        btn.addEventListener("click", () => {
          if(locked) return;
          locked = true;

          const isCorrect = (txt === meta.answer);
          if(isCorrect){ btn.classList.add("correct"); quiz.correct++; }
          else{
            btn.classList.add("wrong");
            // mark correct
            [...box.children].forEach(c => { if(c.textContent === meta.answer) c.classList.add("correct"); });
          }
          // next after short delay
          setTimeout(() => nextQuestion(), 650);
        });
        box.appendChild(btn);
      });

      card.appendChild(box);
    }else{
      const inp = el("input", {class:"input", type:"text", placeholder:"type your answer"});
      const feedback = el("div", {class:"help"}, [""]);
      const btnRow = el("div", {class:"row"}, [
        el("button", {class:"btn secondary"}, ["Check"]),
        el("button", {class:"btn"}, ["Skip"])
      ]);

      btnRow.children[0].addEventListener("click", () => {
        const user = inp.value;
        let ok = false;

        if(meta.dir === "en_to_jp"){
          const userN = normalizeJP(user);
          // If display=both, accept kana or kanji
          if(state.displayMode === "both"){
            const a1 = normalizeJP(item.jp_kana);
            const a2 = normalizeJP(item.jp_kanji);
            ok = (userN === a1) || (userN === a2);
          }else if(state.displayMode === "kana"){
            ok = normalizeJP(item.jp_kana) === userN;
          }else{
            ok = normalizeJP(item.jp_kanji) === userN;
          }
        }else{
          ok = normalizeEN(meta.answer) === normalizeEN(user);
        }

        if(ok){
          const alreadyMissed = quiz.typingMisses.has(quiz.idx);
          if(!alreadyMissed){
            quiz.correct++;
            feedback.textContent = "✅ correct";
            feedback.style.color = "rgba(34,197,94,0.9)";
          }else{
            feedback.textContent = "✅ correct (but already missed)";
            feedback.style.color = "rgba(245,158,11,0.9)";
          }
          setTimeout(() => nextQuestion(), 600);
        }else{
          quiz.typingMisses.add(quiz.idx);
          feedback.textContent = `❌ not quite. Correct: ${meta.answer}`;
          feedback.style.color = "rgba(239,68,68,0.9)";
        }
      });

      btnRow.children[1].addEventListener("click", () => {
        quiz.typingMisses.add(quiz.idx);
        nextQuestion();
      });

      card.appendChild(inp);
      card.appendChild(el("div", {style:"height:10px"}));
      card.appendChild(btnRow);
      card.appendChild(feedback);
      inp.focus();
      inp.addEventListener("keydown", (e)=>{ if(e.key==="Enter"){ btnRow.children[0].click(); } });
    }

    root.appendChild(card);
  }

  function nextQuestion(){
    quiz.idx++;
    if(quiz.idx >= quiz.items.length){
      renderResults();
    }else{
      renderQuiz();
    }
  }

  function renderResults(){
    const root = document.getElementById("root");
    root.innerHTML = "";

    const pct = Math.round((quiz.correct / quiz.items.length) * 100);

    const card = el("div", {class:"card"}, [
      el("div", {class:"h1"}, ["Results"]),
      el("div", {class:"question"}, [`${pct}%`]),
      el("div", {class:"subq"}, [`Correct: ${quiz.correct} / ${quiz.items.length}`]),
      el("div", {class:"row"}, [
        el("button", {class:"btn secondary", onclick: ()=>startQuiz()}, ["Retry same settings"]),
        el("button", {class:"btn", onclick: ()=>{ quiz=null; renderSettings(); }}, ["Back to setup"])
      ]),
      el("div", {class:"help"}, [
        "If you want to drill only the weird day-of-month readings, set Category = Day of the month and Focus mode = Irregular only."
      ])
    ]);
    root.appendChild(card);
  }

  async function init(){
    // PWA registration
    if("serviceWorker" in navigator){
      try{ await navigator.serviceWorker.register("sw.js"); }catch(e){}
    }
    const res = await fetch(DATA_URL);
    DATA = await res.json();
    await loadAudioManifest();
    document.querySelectorAll("[data-version]").forEach((node) => {
      node.textContent = `v${APP_VERSION}`;
    });
    const subtitle = document.querySelector("[data-version-subtitle]");
    if(subtitle){
      subtitle.textContent = `PWA • v${APP_VERSION}`;
    }

    // Footer buttons
    document.getElementById("btnSettings").addEventListener("click", () => renderSettings());
    document.getElementById("btnStartQuick").addEventListener("click", () => startQuiz());

    renderSettings();
  }

  init();
})();
