const KEY = "field-tasks-v1";
const $ = id => document.getElementById(id);
let tasks = [], filter = "all", editing = null, snapshot = null, toastTimer;
let enterId = null, popId = null, firstRender = true;
let audio = null, ringTimer = null, ringingId = null;

function load(){ try { tasks = JSON.parse(localStorage.getItem(KEY)) || []; } catch(e){ tasks = []; } }
function save(){ try { localStorage.setItem(KEY, JSON.stringify(tasks)); } catch(e){} }

/* ---------- alarm helpers ---------- */
function calcAlarm(time, due){
  if(!time) return null;                       // no alarm set
  const [h, m] = time.split(":").map(Number);
  const d = due ? new Date(due + "T00:00") : new Date();
  d.setHours(h, m, 0, 0);
  if(!due && d.getTime() <= Date.now()) d.setDate(d.getDate() + 1); // time passed today -> tomorrow
  return d.getTime();
}
function fmtAlarm(ts){
  const d = new Date(ts), now = new Date();
  const time = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  if(d.toDateString() === now.toDateString()) return "Today " + time;
  const tmr = new Date(now); tmr.setDate(now.getDate() + 1);
  if(d.toDateString() === tmr.toDateString()) return "Tomorrow " + time;
  return d.toLocaleDateString([], { month: "short", day: "numeric" }) + " " + time;
}
function unlockAudio(){
  try {
    audio = audio || new (window.AudioContext || window.webkitAudioContext)();
    if(audio.state === "suspended") audio.resume();
  } catch(e){}
}
["pointerdown","keydown"].forEach(ev => document.addEventListener(ev, unlockAudio, { passive: true }));
function beep(freq, start, dur){
  const o = audio.createOscillator(), g = audio.createGain(), t = audio.currentTime + start;
  o.type = "sine"; o.frequency.value = freq;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.35, t + 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g); g.connect(audio.destination); o.start(t); o.stop(t + dur + 0.05);
}
function chime(){
  if(!audio) return;
  beep(880, 0, 0.18); beep(1175, 0.22, 0.18); beep(880, 0.44, 0.18); beep(1175, 0.66, 0.3);
}
function startRing(t){
  ringingId = t.id; t.fired = true; save();
  $("ringText").textContent = t.text;
  $("ring").hidden = false;
  chime(); clearInterval(ringTimer); ringTimer = setInterval(chime, 1800);
  if(navigator.vibrate) navigator.vibrate([300, 150, 300]);
  try { if("Notification" in window && Notification.permission === "granted") new Notification("Alarm: " + t.text); } catch(e){}
  render();
}
function stopRing(){
  clearInterval(ringTimer); ringingId = null; $("ring").hidden = true;
  if(navigator.vibrate) navigator.vibrate(0);
}
function checkAlarms(){
  if(ringingId !== null) return;
  const t = tasks.find(x => x.alarm && !x.fired && !x.done && x.alarm <= Date.now());
  if(t) startRing(t);
}
$("dismiss").onclick = stopRing;
$("snooze").onclick = () => {
  const t = tasks.find(x => x.id === ringingId);
  if(t){ t.alarm = Date.now() + 5 * 60000; t.fired = false; save(); }
  stopRing(); render();
};
$("ringDone").onclick = () => {
  const t = tasks.find(x => x.id === ringingId);
  if(t){ remember("Task completed ✓"); t.done = true; popId = t.id; enterId = t.id; save(); }
  stopRing(); render();
};

/* ---------- tasks ---------- */
function addTask(){
  const t = $("text").value.trim();
  if(!t){ $("text").focus(); return; }
  const due = $("due").value, time = $("alarm").value;
  const task = { id: Date.now() + Math.random(), text: t, done: false, pri: $("pri").value, due,
                 alarm: calcAlarm(time, due), fired: false, created: Date.now() };
  tasks.unshift(task); enterId = task.id;
  if(task.alarm){
    unlockAudio();
    try { if("Notification" in window && Notification.permission === "default") Notification.requestPermission(); } catch(e){}
  }
  $("text").value = ""; $("due").value = ""; $("alarm").value = "";
  save(); render(); $("text").focus();
}

function remember(msg){
  snapshot = JSON.parse(JSON.stringify(tasks));
  $("toastMsg").textContent = msg; $("toast").hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => $("toast").hidden = true, 6000);
}

const rank = { high: 0, med: 1, low: 2 };
function visible(){
  const q = $("q").value.trim().toLowerCase();
  const out = tasks.filter(t =>
    (filter === "all" || (filter === "done") === t.done) && t.text.toLowerCase().includes(q));
  const s = $("sort").value;
  if(s === "pri") out.sort((a, b) => rank[a.pri] - rank[b.pri]);
  if(s === "due") out.sort((a, b) => (a.due || "9999").localeCompare(b.due || "9999"));
  return out;
}

function fmtDue(t){
  if(!t.due) return "";
  const today = new Date().toISOString().slice(0, 10);
  const d = new Date(t.due + "T00:00").toLocaleDateString(undefined, { month: "short", day: "numeric" });
  return !t.done && t.due < today ? `<span class="late">Overdue · ${d}</span>` : `Due ${d}`;
}

const esc = s => s.replace(/[&<>"']/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c]));
const labels = { high: "High", med: "Medium", low: "Low" };

function render(){
  const list = visible();
  const itemHTML = (t, i) => `
    <li class="item out ${t.pri} ${t.done ? "done" : ""} ${t.id === enterId || firstRender ? "enter" : ""}"
        style="${firstRender ? `animation-delay:${Math.min(i, 8) * 60}ms` : ""}" data-id="${t.id}">
      <button class="check ${t.done ? "" : "in"} ${t.id === popId ? "pop" : ""}" role="checkbox" aria-checked="${t.done}" aria-label="Mark task completed" title="Mark task completed" data-a="toggle">${t.done ? "✓" : ""}</button>
      <div class="body">
        ${editing === t.id
          ? `<input class="edit-in in" value="${esc(t.text)}" maxlength="120" aria-label="Edit task">`
          : `<div class="txt">${esc(t.text)}</div>`}
        <div class="meta">
          <span>${labels[t.pri]} priority${t.due ? " · " + fmtDue(t) : ""}</span>
          ${t.alarm && !t.fired && !t.done ? `<button class="alarm-badge" data-a="noalarm" title="Remove alarm" aria-label="Remove alarm set for ${fmtAlarm(t.alarm)}">⏰ ${fmtAlarm(t.alarm)} ✕</button>` : ""}
        </div>
      </div>
      <div class="acts">
        <button class="sm" data-a="edit" aria-label="${editing === t.id ? "Save" : "Edit"} task">${editing === t.id ? "💾" : "✏️"}</button>
        <button class="sm" data-a="del" aria-label="Delete task">🗑️</button>
      </div>
    </li>`;
  const active = list.filter(t => !t.done), finished = list.filter(t => t.done);
  let html;
  if(!list.length) html = `<li class="empty in">${tasks.length ? "No tasks match this view." : "No tasks yet. Add your first task above."}</li>`;
  else if(filter === "all") html = active.map(itemHTML).join("") +
    (finished.length ? `<li class="group">Completed (${finished.length})</li>` + finished.map((t, i) => itemHTML(t, active.length + i)).join("") : "");
  else html = list.map(itemHTML).join("");
  $("list").innerHTML = html;
  enterId = null; popId = null; firstRender = false;

  const done = tasks.filter(t => t.done).length, total = tasks.length;
  const pct = total ? Math.round(done / total * 100) : 0;
  $("pLabel").textContent = `${done} of ${total} done`;
  $("pPct").textContent = pct + "%";
  $("fill").style.width = pct + "%";
  $("left").textContent = `${total - done} task${total - done === 1 ? "" : "s"} remaining`;

  const ei = document.querySelector(".edit-in");
  if(ei){ ei.focus(); ei.setSelectionRange(ei.value.length, ei.value.length); }
}

$("list").addEventListener("click", e => {
  const b = e.target.closest("button[data-a]"); if(!b) return;
  const li = b.closest("li"), id = Number(li.dataset.id), t = tasks.find(x => x.id === id);
  const a = b.dataset.a;
  if(a === "toggle"){ if(!t.done) remember("Task completed ✓"); t.done = !t.done; popId = t.done ? id : null; enterId = id; save(); render(); }
  if(a === "noalarm"){ t.alarm = null; save(); render(); }
  if(a === "del"){
    remember("Task deleted");
    li.classList.add("removing");
    setTimeout(() => { tasks = tasks.filter(x => x.id !== id); save(); render(); }, 260);
  }
  if(a === "edit"){ editing === id ? commitEdit(id) : (editing = id, render()); }
});
function commitEdit(id){
  const inp = document.querySelector(".edit-in"), t = tasks.find(x => x.id === id);
  if(inp && inp.value.trim()) t.text = inp.value.trim();
  editing = null; save(); render();
}
$("list").addEventListener("keydown", e => {
  if(!e.target.classList.contains("edit-in")) return;
  if(e.key === "Enter") commitEdit(Number(e.target.closest("li").dataset.id));
  if(e.key === "Escape"){ editing = null; render(); }
});

$("text").addEventListener("keydown", e => { if(e.key === "Enter") addTask(); });
$("addBtn").onclick = addTask;
$("q").oninput = $("sort").onchange = render;
document.querySelectorAll(".chip").forEach(c => c.onclick = () => {
  filter = c.dataset.f;
  document.querySelectorAll(".chip").forEach(x => x.setAttribute("aria-pressed", x === c));
  render();
});
$("clearDone").onclick = () => {
  if(!tasks.some(t => t.done)) return;
  remember("Completed tasks cleared"); tasks = tasks.filter(t => !t.done); save(); render();
};
$("clearAll").onclick = () => {
  if(!tasks.length) return;
  remember("All tasks cleared"); tasks = []; save(); render();
};
$("undo").onclick = () => {
  if(snapshot){ tasks = snapshot; snapshot = null; save(); render(); }
  $("toast").hidden = true;
};

/* ---------- clock + alarm loop ---------- */
function tick(){
  $("clock").textContent = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  checkAlarms();
}
$("date").textContent = "Task tracker for " + new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
load(); render(); tick(); setInterval(tick, 1000);
