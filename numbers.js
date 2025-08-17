const el = (sel) => document.querySelector(sel);
const $ = {
  mode: el('#mode'),
  range: el('#range'),
  customRange: el('#customRange'),
  min: el('#min'),
  max: el('#max'),
  britishAnd: el('#britishAnd'),
  tts: el('#tts'),
  strictHyphen: el('#strictHyphen'),
  start: el('#start'),
  prompt: el('#prompt'),
  form: el('#answerForm'),
  answer: el('#answer'),
  reveal: el('#reveal'),
  next: el('#next'),
  repit: el('#repit'),
  feedback: el('#feedback'),
  total: el('#total'),
  correct: el('#correct'),
  streak: el('#streak'),
  accuracy: el('#accuracy'),
  reset: el('#reset'),
  export: el('#export'),
  confettiTpl: el('#confetti')
};

// ---- Settings & State (persisted in localStorage) ----
const STORAGE_KEY = 'numbers.practice.v1';
let state = {
  settings: {
    mode: 'toWords',
    range: '0-100',
    min: 0,
    max: 100,
    britishAnd: false,
    tts: true,
    strictHyphen: false,
  },
  stats: { total: 0, correct: 0, streak: 0 },
  mistakes: [], // {q, expected, user, ts}
  session: { current: null, expected: '', display: '', answerType: 'words', answered: false }
};

// Load saved state
try {
  const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
  if (saved) state = { ...state, ...saved, settings: { ...state.settings, ...(saved.settings||{}) } };
} catch {}
applySettingsToUI();

function save() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

// ---- Number to words (0..1,000,000) ----
const belowTwenty = ["zero","one","two","three","four","five","six","seven","eight","nine","ten","eleven","twelve","thirteen","fourteen","fifteen","sixteen","seventeen","eighteen","nineteen"];
const tensWords = ["","","twenty","thirty","forty","fifty","sixty","seventy","eighty","ninety"];

function hyphenJoin(t, u, strictHyphen) {
  if (!u) return t;
  return strictHyphen ? `${t}-${u}` : `${t} ${u}`;
}

function twoDigits(n, strictHyphen){
  if (n < 20) return belowTwenty[n];
  const t = Math.floor(n/10), u = n%10;
  return hyphenJoin(tensWords[t], u ? belowTwenty[u] : '', strictHyphen);
}

function numberToWords(n, britishAnd=false, strictHyphen=false){
  if (n < 100) return twoDigits(n, strictHyphen);
  if (n < 1000){
    const h = Math.floor(n/100), r = n%100;
    if (r === 0) return `${belowTwenty[h]} hundred`;
    const and = britishAnd ? ' and ' : ' ';
    return `${belowTwenty[h]} hundred${and}${numberToWords(r, britishAnd, strictHyphen)}`;
  }
  if (n < 1_000_000){
    const th = Math.floor(n/1000), r = n%1000;
    if (r === 0) return `${numberToWords(th, britishAnd, strictHyphen)} thousand`;
    return `${numberToWords(th, britishAnd, strictHyphen)} thousand ${numberToWords(r, britishAnd, strictHyphen)}`;
  }
  if (n === 1_000_000) return 'one million';
  throw new RangeError('Out of supported range');
}

function normalizeWords(s){
  return s
    .toLowerCase()
    .replace(/[^\w\s-]/g, '') // remove punctuation
    .replace(/\s+/g, ' ')
    .trim();
}

function equivalentWords(a, b, allowAnd, strictHyphen){
  // Accept optional 'and' when allowAnd=true
  const clean = (x) => normalizeWords(x)
    .replace(allowAnd ? /\band\b/g : /$a^/, '') // strip 'and' if allowed
    .replace(/\s+/g, ' ') // collapse spaces
    .replace(strictHyphen ? / /g : /[- ]/g, ' '); // either enforce hyphen or treat hyphen/space equally
  return clean(a) === clean(b);
}

// ---- Problem generation ----
function parseRange(){
  const r = state.settings.range;
  if (r === 'custom') {
    let min = Math.max(0, Math.min(1_000_000, Number($.min.value||0)));
    let max = Math.max(0, Math.min(1_000_000, Number($.max.value||100)));
    if (max < min) [min, max] = [max, min];
    return [min, max];
  }
  const [min, max] = r.split('-').map(Number);
  return [min, max];
}

function randInt(min, max){
  return Math.floor(Math.random()*(max-min+1))+min;
}

function newQuestion(fromMistakes=false){
  const mode = state.settings.mode;
  let n, words;
  if (mode === 'review' || fromMistakes){
    if (state.mistakes.length === 0){
      setFeedback("🎉 No mistakes to review!", 'ok');
      return;
    }
    const item = state.mistakes[randInt(0, state.mistakes.length-1)];
    n = typeof item.q === 'number' ? item.q : null;
    words = typeof item.q === 'string' ? item.q : null;
    if (n === null) {
      // words→number
      state.session.answerType = 'number';
      state.session.display = words;
      state.session.expected = String(item.expected);
      $.prompt.textContent = `Write the digits: “${words}”`;
    } else {
      // number→words
      state.session.answerType = 'words';
      const expected = numberToWords(n, state.settings.britishAnd, state.settings.strictHyphen);
      state.session.expected = expected;
      state.session.display = n;
      $.prompt.textContent = `Write the words: ${n}`;
    }
  } else {
    const [min, max] = parseRange();
    n = randInt(min, max);
    words = numberToWords(n, state.settings.britishAnd, state.settings.strictHyphen);
    if (state.settings.mode === 'toWords'){
      state.session.answerType = 'words';
      state.session.expected = words;
      state.session.display = n;
      $.prompt.textContent = `Write the words: ${n}`;
    } else {
      state.session.answerType = 'number';
      state.session.expected = String(n);
      state.session.display = words;
      $.prompt.textContent = `Write the digits: “${words}”`;
    }
  }
  state.session.current = Date.now();
  state.session.answered = false;
  $.answer.value = '';
  setFeedback('');
  speakPrompt();
  $.answer.focus();
}

function speakPrompt(){
  if (!state.settings.tts || !('speechSynthesis' in window)) return;

  let text;

  if (state.session.answerType === 'words') {
    // Caso: mostrar dígitos en pantalla, pero que la voz diga el número en palabras
    const n = state.session.display;
    if (typeof n === 'number') {
      text = `Write the words for ${numberToWords(n, state.settings.britishAnd, state.settings.strictHyphen)}`;
    } else {
      text = `Write the words for ${n}`;
    }
  } else {
    // Caso: mostrar palabras en pantalla, pedir escribir dígitos
    const words = state.session.display;
    // Convertir de nuevo a número si fuera posible
    let spoken;
    if (!isNaN(Number(state.session.expected))) {
      spoken = numberToWords(Number(state.session.expected), state.settings.britishAnd, state.settings.strictHyphen);
    } else {
      spoken = words;
    }
    text = `Write the digits for ${spoken}`;
  }

  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'en-US';
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(u);
}


// ---- Feedback & Stats ----
function setFeedback(msg, type){
  $.feedback.textContent = msg || '';
  $.feedback.className = 'feedback' + (type ? ' ' + type : '');
}

function updateStats(correct){
  state.stats.total += 1;
  if (correct){
    state.stats.correct += 1;
    state.stats.streak += 1;
  } else {
    state.stats.streak = 0;
  }
  const {total, correct:c} = state.stats;
  $.total.textContent = total;
  $.correct.textContent = c;
  $.streak.textContent = state.stats.streak;
  $.accuracy.textContent = total ? Math.round(c*100/total) + '%' : '0%';
  save();
}

function addMistake(q, expected, user){
  state.mistakes.push({ q, expected, user, ts: Date.now() });
  // Keep last 200 mistakes
  if (state.mistakes.length > 200) state.mistakes.shift();
  save();
}

function celebrate(){
  const node = $.confettiTpl.content.firstElementChild.cloneNode(true);
  document.body.appendChild(node);
  setTimeout(()=>node.remove(), 650);
}

// ---- UI wiring ----
function applySettingsToUI(){
  $.mode.value = state.settings.mode;
  $.range.value = state.settings.range;
  $.britishAnd.checked = state.settings.britishAnd;
  $.tts.checked = state.settings.tts;
  $.strictHyphen.checked = state.settings.strictHyphen;
  $.total.textContent = state.stats.total;
  $.correct.textContent = state.stats.correct;
  $.streak.textContent = state.stats.streak;
  $.accuracy.textContent = state.stats.total ? Math.round(state.stats.correct*100/state.stats.total)+'%' : '0%';
  // Custom range fields
  const showCustom = state.settings.range === 'custom';
  $.customRange.classList.toggle('hidden', !showCustom);
  $.min.value = state.settings.min;
  $.max.value = state.settings.max;
}

function readUIToSettings(){
  state.settings.mode = $.mode.value;
  state.settings.range = $.range.value;
  state.settings.min = Number($.min.value||0);
  state.settings.max = Number($.max.value||100);
  state.settings.britishAnd = $.britishAnd.checked;
  state.settings.tts = $.tts.checked;
  state.settings.strictHyphen = $.strictHyphen.checked;
  save();
}

$.range.addEventListener('change', () => {
  if ($.range.value === 'custom'){
    $.customRange.classList.remove('hidden');
    state.settings.range = 'custom';
  } else {
    $.customRange.classList.add('hidden');
    state.settings.range = $.range.value;
  }
  save();
});

['change','input'].forEach(ev=> $.min.addEventListener(ev, readUIToSettings));
['change','input'].forEach(ev=> $.max.addEventListener(ev, readUIToSettings));
$.mode.addEventListener('change', () => { state.settings.mode = $.mode.value; save(); });
$.britishAnd.addEventListener('change', () => { state.settings.britishAnd = $.britishAnd.checked; save(); });
$.tts.addEventListener('change', () => { state.settings.tts = $.tts.checked; save(); });
$.strictHyphen.addEventListener('change', () => { state.settings.strictHyphen = $.strictHyphen.checked; save(); });

$.start.addEventListener('click', () => {
  readUIToSettings();
  newQuestion();
});

$.form.addEventListener('submit', (e) => {
  e.preventDefault();
  const user = $.answer.value.trim();
  if (!user) return;

  const expected = state.session.expected;
  let correct = false;

  if (state.session.answerType === 'words'){
    correct = equivalentWords(user, expected, state.settings.britishAnd, state.settings.strictHyphen);
  } else { // number
    const normalized = user.replace(/[,_\s]/g,'').replace(/^0+(\d)/,'$1');
    correct = normalized === expected;
  }

  if (correct){
    setFeedback('✅ Correct!', 'ok');
    celebrate();
  } else {
    setFeedback(`❌ Not quite. Correct: ${expected}`, 'err');
    // Save mistake
    const q = state.session.answerType === 'words' ? Number(state.session.display) : String(state.session.display);
    addMistake(q, expected, user);
  }

  speakResult(correct);
  updateStats(correct);
  state.session.answered = true;
});

$.reveal.addEventListener('click', () => {
  if (!state.session.expected) return;
  setFeedback(`ℹ️ ${state.session.expected}`);
  if (!state.session.answered) {   // <---- solo contar fallo si aún no estaba contestada
    updateStats(false);
    state.session.answered = true; // marcar como contestada después de reveal
  }
});

$.next.addEventListener('click', () => {
  console.log(state.session.answered);
  if (state.session.answered == false) {
    updateStats(false);
  }
  newQuestion()});

$.repit.addEventListener('click', () => speakPrompt());

$.reset.addEventListener('click', () => {
  if (!confirm('Reset progress and mistakes?')) return;
  state.stats = { total:0, correct:0, streak:0 };
  state.mistakes = [];
  save();
  applySettingsToUI();
  setFeedback('Progress reset.');
});

$.export.addEventListener('click', () => {
  const rows = [['when','question','expected','user']].concat(
    state.mistakes.map(m=>[new Date(m.ts).toISOString(), String(m.q), String(m.expected), String(m.user)])
  );
  const csv = rows.map(r=>r.map(x=>`"${String(x).replace(/"/g,'""')}"`).join(',')).join('\n');
  const blob = new Blob([csv], {type:'text/csv'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'numbers_mistakes.csv';
  a.click();
  URL.revokeObjectURL(url);
});

// Keyboard shortcut: Enter = check, Ctrl+Enter = next
document.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
    e.preventDefault();
    $.next.click();
  }
});

// If user lands and had previous session, show a fresh question
window.addEventListener('load', () => {
  applySettingsToUI();
  newQuestion();
});


/** Speak a one-word result after checking the answer. */
function speakResult(isCorrect){
  if (!state.settings.tts || !('speechSynthesis' in window)) return;
  const u = new SpeechSynthesisUtterance(isCorrect ? 'Correct' : 'Wrong');
  u.lang = 'en-US';
  try { window.speechSynthesis.cancel(); } catch {}
  window.speechSynthesis.speak(u);
}
