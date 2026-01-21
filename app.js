(() => {
  const STATE_KEY = "kats-date-game-state-v1";
  const DATA_URL = "date_game_data.json";

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
    focusMode: "all" // all | irregular
  };

  let DATA = null;
  let state = loadState();
  let quiz = null;

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

      btnRow.children[1].addEventListener("click", () => nextQuestion());

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

    // Footer buttons
    document.getElementById("btnSettings").addEventListener("click", () => renderSettings());
    document.getElementById("btnStartQuick").addEventListener("click", () => startQuiz());

    renderSettings();
  }

  init();
})();
