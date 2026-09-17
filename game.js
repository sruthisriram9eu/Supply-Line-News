// A tiny Wordle-style game using supply chain terms. The word changes once
// per day (based on the date, so it's the same for everyone that day) and
// today's progress is remembered in this browser via localStorage.

const WORD_LIST = [
  "CRATE", "CARGO", "AUDIT", "YIELD", "QUOTA", "TRUCK", "DEPOT", "STOCK",
  "ORDER", "TRADE", "CHAIN", "CRANE", "DELAY", "FLEET", "PORTS", "LEVER",
  "SCALE", "GAUGE", "VALVE", "MOTOR", "PRICE", "ROUTE", "QUEUE", "LABEL",
  "BRAND", "GOODS", "SPOKE", "CLAIM", "MODEL", "STAGE"
];

function dayIndex(){
  const start = new Date(Date.UTC(2026, 0, 1));
  const now = new Date();
  const today = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
  const diff = Math.floor((today - start) / 86400000);
  return ((diff % WORD_LIST.length) + WORD_LIST.length) % WORD_LIST.length;
}

function todayKey(){
  const now = new Date();
  return `${now.getFullYear()}-${now.getMonth()+1}-${now.getDate()}`;
}

const ANSWER = WORD_LIST[dayIndex()];
const STORAGE_KEY = `supplyline-word-${todayKey()}`;

let guesses = [];       // array of {word, result: ['correct'|'present'|'absent', ...]}
let currentGuess = "";
let gameOver = false;

const gridEl = document.getElementById('grid');
const keyboardEl = document.getElementById('keyboard');
const msgEl = document.getElementById('gameMsg');
const overlay = document.getElementById('gameOverlay');
const openBtn = document.getElementById('openGame');
const closeBtn = document.getElementById('closeGame');

function loadState(){
  try{
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw){
      const saved = JSON.parse(raw);
      guesses = saved.guesses || [];
      gameOver = saved.gameOver || false;
    }
  } catch(e){ /* ignore, start fresh */ }
}

function saveState(){
  try{
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ guesses, gameOver }));
  } catch(e){ /* storage unavailable, game still works this session */ }
}

function scoreGuess(word){
  const answerLetters = ANSWER.split('');
  const result = new Array(5).fill('absent');
  const used = new Array(5).fill(false);

  for (let i = 0; i < 5; i++){
    if (word[i] === answerLetters[i]){
      result[i] = 'correct';
      used[i] = true;
    }
  }
  for (let i = 0; i < 5; i++){
    if (result[i] === 'correct') continue;
    const idx = answerLetters.findIndex((ch, j) => ch === word[i] && !used[j]);
    if (idx !== -1){
      result[i] = 'present';
      used[idx] = true;
    }
  }
  return result;
}

function renderGrid(){
  gridEl.innerHTML = '';
  for (let r = 0; r < 6; r++){
    const row = document.createElement('div');
    row.className = 'grid-row';
    const guess = guesses[r];
    const isCurrentRow = r === guesses.length && !gameOver;
    for (let c = 0; c < 5; c++){
      const tile = document.createElement('div');
      tile.className = 'tile';
      if (guess){
        tile.textContent = guess.word[c];
        tile.classList.add(guess.result[c]);
      } else if (isCurrentRow && currentGuess[c]){
        tile.textContent = currentGuess[c];
        tile.classList.add('filled');
      }
      row.appendChild(tile);
    }
    gridEl.appendChild(row);
  }
}

const KEY_ROWS = [
  "QWERTYUIOP".split(''),
  "ASDFGHJKL".split(''),
  ["ENTER", ..."ZXCVBNM".split(''), "DEL"]
];

const keyStatus = {};

function recomputeKeyStatuses(){
  for (const g of guesses){
    for (let i = 0; i < 5; i++){
      const letter = g.word[i];
      const status = g.result[i];
      const rank = { absent: 0, present: 1, correct: 2 };
      if (!keyStatus[letter] || rank[status] > rank[keyStatus[letter]]){
        keyStatus[letter] = status;
      }
    }
  }
}

function renderKeyboard(){
  keyboardEl.innerHTML = '';
  KEY_ROWS.forEach(row => {
    const rowEl = document.createElement('div');
    rowEl.className = 'kb-row';
    row.forEach(key => {
      const btn = document.createElement('button');
      btn.className = 'key';
      btn.textContent = key === 'DEL' ? '⌫' : key;
      if (key.length > 1) btn.classList.add('wide');
      if (keyStatus[key]) btn.classList.add(keyStatus[key]);
      btn.addEventListener('click', () => handleKey(key));
      rowEl.appendChild(btn);
    });
    keyboardEl.appendChild(rowEl);
  });
}

function setMessage(text){
  msgEl.textContent = text || '\u00A0';
}

function handleKey(key){
  if (gameOver) return;

  if (key === 'ENTER'){
    if (currentGuess.length !== 5){
      setMessage("Not enough letters");
      return;
    }
    const result = scoreGuess(currentGuess);
    guesses.push({ word: currentGuess, result });
    recomputeKeyStatuses();

    if (currentGuess === ANSWER){
      gameOver = true;
      setMessage("Solved! Nicely done.");
    } else if (guesses.length >= 6){
      gameOver = true;
      setMessage(`The word was ${ANSWER}.`);
    } else {
      setMessage('');
    }
    currentGuess = "";
    saveState();
    renderGrid();
    renderKeyboard();
    return;
  }

  if (key === 'DEL'){
    currentGuess = currentGuess.slice(0, -1);
    renderGrid();
    return;
  }

  if (/^[A-Z]$/.test(key) && currentGuess.length < 5){
    currentGuess += key;
    renderGrid();
  }
}

document.addEventListener('keydown', (e) => {
  if (!overlay.classList.contains('open')) return;
  const k = e.key.toUpperCase();
  if (k === 'ENTER') handleKey('ENTER');
  else if (k === 'BACKSPACE') handleKey('DEL');
  else if (/^[A-Z]$/.test(k)) handleKey(k);
});

openBtn.addEventListener('click', () => {
  overlay.classList.add('open');
});
closeBtn.addEventListener('click', () => {
  overlay.classList.remove('open');
});
overlay.addEventListener('click', (e) => {
  if (e.target === overlay) overlay.classList.remove('open');
});

loadState();
recomputeKeyStatuses();
if (gameOver && guesses.length && guesses[guesses.length - 1].word === ANSWER){
  setMessage("Solved! Nicely done.");
} else if (gameOver){
  setMessage(`The word was ${ANSWER}.`);
}
renderGrid();
renderKeyboard();
