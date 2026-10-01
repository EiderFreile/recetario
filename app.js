/* =========================================================
   Recetario de Cris y Eider 💕
   Datos en Firebase → nodo "recetario":
     categorias/{id}:   { nombre, color }
     ingredientes/{id}: { nombre }
     recetas/{id}:      { nombre, categoriaId, precio, tiempo, ingredientes:{ingId:true}, creada, editada }
     calendario/{YYYY-MM-DD}: { comida: recetaId, cena: recetaId }
   ========================================================= */

const CACHE_KEY = "recetario-cache-v1";
const COLORES = ["#FF7EB3", "#FF9F6B", "#FFC23D", "#7ED957", "#3DCB9B", "#4FC3F7", "#5A8CFF", "#9F84F8", "#E879F9", "#C08457", "#94A3B8"];
const DIAS = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];
const DIAS_LARGO = ["lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"];
const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const SLOTS = { comida: "☀️ Comida", cena: "🌙 Cena" };

let S = { categorias: {}, ingredientes: {}, recetas: {}, calendario: {} };
const UI = {
  tab: "recetas",
  filtroCat: "all",
  busqueda: "",
  calView: "semana",
  calRef: new Date(),
  tengo: new Set(),
  tengoQ: "",
  ingQ: "",
  online: null
};
let F = null;   // formulario de receta
let A = null;   // asignar a calendario
let P = null;   // selector de receta para un hueco
let R = null;   // dado
let M = null;   // fusionar ingredientes
let CF = null;  // formulario de categoría

/* ---------- Utilidades ---------- */
const $ = (s, el = document) => el.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const norm = s => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim();
const uid = () => (db ? db.push().key : Date.now().toString(36) + Math.random().toString(36).slice(2, 8));
const pad = n => String(n).padStart(2, "0");
const toKey = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseKey = k => { const [y, m, d] = k.split("-").map(Number); return new Date(y, m - 1, d); };
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const dow = d => (d.getDay() + 6) % 7; // 0 = lunes
const startOfWeek = d => { const x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); return addDays(x, -dow(x)); };
const todayKey = () => toKey(new Date());
const fmtEur = n => new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR", maximumFractionDigits: 2 }).format(n);
const fmtTime = m => m < 60 ? `${m} min` : `${Math.floor(m / 60)} h${m % 60 ? " " + (m % 60) + " min" : ""}`;
const fmtDayLong = k => { const d = parseKey(k); return `${DIAS_LARGO[dow(d)]} ${d.getDate()} de ${MESES[d.getMonth()]}`; };
const fmtDayShort = k => { const d = parseKey(k); return `${DIAS[dow(d)].toLowerCase()} ${d.getDate()} ${MESES[d.getMonth()].slice(0, 3)}`; };
const parseNum = v => { const n = parseFloat(String(v).replace(",", ".")); return isNaN(n) ? null : Math.round(n * 100) / 100; };
const plural = (n, a, b) => `${n} ${n === 1 ? a : b}`;

function shape(v) {
  v = v || {};
  return {
    categorias: v.categorias || {},
    ingredientes: v.ingredientes || {},
    recetas: v.recetas || {},
    calendario: v.calendario || {}
  };
}

/* ---------- Lectores de datos ---------- */
const cats = () => Object.entries(S.categorias).map(([id, c]) => ({ id, ...c })).sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
const ings = () => Object.entries(S.ingredientes).map(([id, i]) => ({ id, ...i })).sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
const recetas = () => Object.entries(S.recetas).map(([id, r]) => ({ id, ...r })).sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
const catOf = r => (r && r.categoriaId && S.categorias[r.categoriaId]) ? { id: r.categoriaId, ...S.categorias[r.categoriaId] } : null;
const colorOf = r => catOf(r)?.color || "#CBB8C6";
const recIngIds = r => Object.keys(r?.ingredientes || {}).filter(id => S.ingredientes[id])
  .sort((a, b) => S.ingredientes[a].nombre.localeCompare(S.ingredientes[b].nombre, "es"));
const recetasConIng = ingId => recetas().filter(r => r.ingredientes && r.ingredientes[ingId]);
const recetasConCat = catId => recetas().filter(r => r.categoriaId === catId);

/* ---------- Guardado (local al momento + Firebase) ---------- */
function setLocal(path, val) {
  const parts = path.split("/");
  let o = S;
  for (let i = 0; i < parts.length - 1; i++) {
    if (typeof o[parts[i]] !== "object" || o[parts[i]] === null) o[parts[i]] = {};
    o = o[parts[i]];
  }
  const last = parts[parts.length - 1];
  if (val === null || val === undefined) delete o[last];
  else o[last] = JSON.parse(JSON.stringify(val));
}
function cacheLocal() {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(S)); } catch (e) { /* sin almacenamiento, no pasa nada */ }
}
function save(updates) {
  const clean = JSON.parse(JSON.stringify(updates, (k, v) => (v === undefined ? null : v)));
  Object.entries(clean).forEach(([p, v]) => setLocal(p, v));
  S = shape(S);
  cacheLocal();
  render();
  if (db) db.update(clean).catch(e => toast("⚠️ No se pudo guardar: " + e.message));
}

/* ---------- Render principal ---------- */
function render() {
  const a = document.activeElement;
  const focusId = a && a.id && $("#main").contains(a) ? a.id : null;
  const pos = focusId ? a.selectionStart : null;

  document.querySelectorAll(".tab-btn").forEach(b => b.classList.toggle("active", b.dataset.tab === UI.tab));
  const views = { recetas: viewRecetas, calendario: viewCalendario, cocino: viewCocino, ajustes: viewAjustes };
  $("#main").innerHTML = views[UI.tab]();

  if (focusId) {
    const el = document.getElementById(focusId);
    if (el) { el.focus(); try { el.setSelectionRange(pos, pos); } catch (e) { } }
  }
}

function catPill(c) {
  if (!c) return `<span class="pill" style="background:#F1EAEF"><span class="dot" style="background:#CBB8C6"></span>Sin categoría</span>`;
  return `<span class="pill" style="background:${c.color}26"><span class="dot" style="background:${c.color}"></span>${esc(c.nombre)}</span>`;
}
function recMeta(r) {
  const n = recIngIds(r).length;
  return `${catPill(catOf(r))}
    ${r.precio != null ? `<span>💶 ${fmtEur(r.precio)}</span>` : ""}
    ${r.tiempo != null ? `<span>⏱ ${fmtTime(r.tiempo)}</span>` : ""}
    ${n ? `<span>🥕 ${n}</span>` : ""}`;
}
function hayHuerfanas() { return recetas().some(r => !catOf(r)); }
function catFilterChips(selected, action) {
  const all = `<button class="chip ${selected === "all" ? "active" : ""}" style="${selected === "all" ? "background:#FFE4F0" : ""}" data-action="${action}" data-id="all">✨ Todas</button>`;
  const list = cats().map(c => `<button class="chip ${selected === c.id ? "active" : ""}" style="${selected === c.id ? `background:${c.color}33` : ""}" data-action="${action}" data-id="${c.id}"><span class="dot" style="background:${c.color}"></span>${esc(c.nombre)}</button>`).join("");
  const none = hayHuerfanas() ? `<button class="chip ${selected === "_none" ? "active" : ""}" style="${selected === "_none" ? "background:#F1EAEF" : ""}" data-action="${action}" data-id="_none"><span class="dot" style="background:#CBB8C6"></span>Sin categoría</button>` : "";
  return all + list + none;
}
const matchCat = (r, f) => f === "all" || (f === "_none" ? !catOf(r) : r.categoriaId === f);

/* =========================================================
   📖 RECETAS
   ========================================================= */
function viewRecetas() {
  if (UI.filtroCat !== "all" && UI.filtroCat !== "_none" && !S.categorias[UI.filtroCat]) UI.filtroCat = "all";
  return `
    <button class="dice-btn" data-action="random">
      <span class="big">🎲</span>
      <span><b>¿No sé qué comer?</b><span class="sub">Toca y os propongo una receta al azar</span></span>
    </button>
    <div class="search"><span>🔎</span><input id="recSearch" type="search" placeholder="Buscar receta…" value="${esc(UI.busqueda)}" autocomplete="off"></div>
    <div class="chips scroll-x">${catFilterChips(UI.filtroCat, "filterCat")}</div>
    <div id="recList">${recListHTML()}</div>
    <button class="fab" data-action="newRecipe" aria-label="Nueva receta">+</button>`;
}
function recListHTML() {
  const all = recetas();
  if (!all.length) return `<div class="empty"><span class="em">🧁</span><b>Aún no hay recetas</b>Pulsa el + para añadir la primera 💕</div>`;
  const q = norm(UI.busqueda);
  const list = all.filter(r => matchCat(r, UI.filtroCat) && (!q || norm(r.nombre).includes(q)));
  if (!list.length) return `<div class="empty"><span class="em">🔍</span><b>Nada por aquí</b>Prueba con otra categoría o búsqueda</div>`;
  return `<div class="count">${plural(list.length, "receta", "recetas")}</div>` + list.map(r => `
    <button class="rec-card" data-action="openRecipe" data-id="${r.id}">
      <span class="rec-color" style="background:${colorOf(r)}"></span>
      <span class="rec-body">
        <span class="rec-name" style="display:block">${esc(r.nombre)}</span>
        <span class="rec-meta">${recMeta(r)}</span>
      </span>
      <span class="chev">›</span>
    </button>`).join("");
}

/* ---------- Detalle ---------- */
function openRecipe(id) {
  const r = S.recetas[id];
  if (!r) return closeSheet();
  const rr = { id, ...r };
  const ingIds = recIngIds(rr);
  const hoy = todayKey();
  const plan = [];
  Object.keys(S.calendario).sort().forEach(k => {
    if (k < hoy) return;
    const d = S.calendario[k] || {};
    if (d.comida === id) plan.push(`${fmtDayShort(k)} · ☀️ comida`);
    if (d.cena === id) plan.push(`${fmtDayShort(k)} · 🌙 cena`);
  });
  openSheet(`
    <div class="detail-head">
      <div style="flex:1;min-width:0">
        <h2>${esc(r.nombre)}</h2>
        ${catPill(catOf(rr))}
      </div>
    </div>
    <div class="tiles">
      <div class="tile"><small>💶 Precio</small><b>${r.precio != null ? fmtEur(r.precio) : "—"}</b></div>
      <div class="tile"><small>⏱ Tiempo</small><b>${r.tiempo != null ? fmtTime(r.tiempo) : "—"}</b></div>
    </div>
    <h3 class="sec-title" style="margin-top:6px">🥕 Ingredientes</h3>
    ${ingIds.length ? `<div class="chips wrap">${ingIds.map(i => `<span class="chip ing">${esc(S.ingredientes[i].nombre)}</span>`).join("")}</div>`
      : `<p class="muted" style="margin:0 4px;font-weight:700">Sin ingredientes apuntados</p>`}
    ${plan.length ? `<h3 class="sec-title">🗓️ Planificada</h3><div class="planned">${plan.slice(0, 4).map(p => `<div>${p}</div>`).join("")}</div>` : ""}
    <div class="stack">
      <button class="btn primary block" data-action="assignRecipe" data-id="${id}">📅 Añadir al calendario</button>
      <div class="row">
        <button class="btn soft" data-action="editRecipe" data-id="${id}">✏️ Editar</button>
        <button class="btn danger" data-action="deleteRecipe" data-id="${id}">🗑 Borrar</button>
      </div>
    </div>`);
}

async function deleteRecipe(id) {
  const r = S.recetas[id];
  if (!r) return;
  const ok = await confirmDlg("¿Borrar receta?", `«${r.nombre}» desaparecerá del recetario y del calendario.`, "Sí, borrar", true);
  if (!ok) return;
  const up = { ["recetas/" + id]: null };
  Object.entries(S.calendario).forEach(([k, d]) => {
    if (d && d.comida === id) up[`calendario/${k}/comida`] = null;
    if (d && d.cena === id) up[`calendario/${k}/cena`] = null;
  });
  closeSheet();
  save(up);
  toast("Receta borrada 🗑");
}

/* ---------- Formulario ---------- */
function openRecipeForm(id) {
  const r = id ? S.recetas[id] : null;
  F = {
    id: id || null,
    nombre: r?.nombre || "",
    categoriaId: r?.categoriaId && S.categorias[r.categoriaId] ? r.categoriaId : (UI.filtroCat !== "all" && UI.filtroCat !== "_none" ? UI.filtroCat : ""),
    precio: r?.precio != null ? String(r.precio).replace(".", ",") : "",
    tiempo: r?.tiempo != null ? String(r.tiempo) : "",
    ings: r ? recIngIds(r).map(i => ({ id: i, nombre: S.ingredientes[i].nombre })) : [],
    newCat: false,
    newCatColor: COLORES[cats().length % COLORES.length]
  };
  openSheet(`
    <h2>${F.id ? "✏️ Editar receta" : "🍳 Nueva receta"}</h2>
    <label class="field"><span>Nombre *</span>
      <input id="fNombre" data-f="nombre" value="${esc(F.nombre)}" placeholder="Ej: Alubias con chorizo" maxlength="80" autocomplete="off">
    </label>
    <div class="field"><span>Categoría *</span><div id="fCats">${formCatsHTML()}</div></div>
    <div class="row2">
      <label class="field"><span>💶 Precio (€)</span><input data-f="precio" inputmode="decimal" value="${esc(F.precio)}" placeholder="Opcional"></label>
      <label class="field"><span>⏱ Tiempo (min)</span><input data-f="tiempo" inputmode="numeric" value="${esc(F.tiempo)}" placeholder="Opcional"></label>
    </div>
    <div class="field"><span>🥕 Ingredientes <small style="font-weight:700">(opcional)</small></span>
      <div class="chips wrap" id="fIngs">${formIngsHTML()}</div>
      <div class="ac-wrap">
        <input id="ingInput" class="input" placeholder="Escribe un ingrediente…" autocomplete="off" autocorrect="off" enterkeyhint="enter">
        <button class="btn-mini" data-action="addIngTyped">Añadir</button>
      </div>
      <div id="acList" class="ac-list"></div>
    </div>
    <div class="sheet-actions">
      <button class="btn ghost" data-action="closeSheet">Cancelar</button>
      <button class="btn primary" data-action="saveRecipe">Guardar 💕</button>
    </div>`);
}
function formCatsHTML() {
  const chips = cats().map(c => `<button class="chip ${F.categoriaId === c.id ? "active" : ""}" style="${F.categoriaId === c.id ? `background:${c.color}40` : ""}" data-action="pickFormCat" data-id="${c.id}"><span class="dot" style="background:${c.color}"></span>${esc(c.nombre)}</button>`).join("");
  const add = `<button class="chip add" data-action="toggleNewCat">${F.newCat ? "✕ Cerrar" : "+ Nueva"}</button>`;
  const box = F.newCat ? `
    <div class="newcat">
      <div class="row"><input id="newCatName" class="input" placeholder="Ej: Legumbres" maxlength="30" autocomplete="off"><button class="btn-mini" data-action="createCatInline">Crear</button></div>
      <div class="colors">${COLORES.map(c => `<button class="color-dot ${F.newCatColor === c ? "active" : ""}" style="background:${c}" data-action="newCatColor" data-c="${c}"></button>`).join("")}</div>
    </div>` : "";
  const hint = !cats().length && !F.newCat ? `<p class="hint">Aún no tenéis categorías, crea la primera con «+ Nueva» 🏷️</p>` : "";
  return `<div class="chips wrap">${chips}${add}</div>${hint}${box}`;
}
function formIngsHTML() {
  return F.ings.map((i, idx) => `<button class="chip ing" data-action="removeFormIng" data-i="${idx}">${esc(i.nombre)}<span class="x">✕</span></button>`).join("");
}
function renderAC() {
  const input = $("#ingInput"), box = $("#acList");
  if (!input || !box) return;
  const raw = input.value.trim(), q = norm(raw);
  if (!q) { box.innerHTML = ""; return; }
  const chosen = new Set(F.ings.map(i => norm(i.nombre)));
  const all = ings().filter(i => !chosen.has(norm(i.nombre)));
  const starts = all.filter(i => norm(i.nombre).startsWith(q));
  const contains = all.filter(i => !norm(i.nombre).startsWith(q) && norm(i.nombre).includes(q));
  const sug = [...starts, ...contains].slice(0, 6);
  const exists = ings().some(i => norm(i.nombre) === q) || chosen.has(q);
  box.innerHTML = sug.map(i => `<button class="ac-item" data-action="addIngSug" data-id="${i.id}">${highlight(i.nombre, q)}</button>`).join("")
    + (!exists ? `<button class="ac-item new" data-action="addIngTyped">➕ Añadir «${esc(raw)}» como nuevo</button>` : "");
}
function highlight(nombre, q) {
  const n = norm(nombre), i = n.indexOf(q);
  if (i < 0 || n.length !== nombre.length) return esc(nombre);
  return esc(nombre.slice(0, i)) + "<mark>" + esc(nombre.slice(i, i + q.length)) + "</mark>" + esc(nombre.slice(i + q.length));
}
function addIngToForm(nombre, id) {
  nombre = nombre.trim();
  if (!nombre) return;
  if (F.ings.some(i => norm(i.nombre) === norm(nombre))) { toast("Ya está en la receta 😉"); }
  else F.ings.push({ id: id || null, nombre });
  const input = $("#ingInput");
  input.value = "";
  $("#fIngs").innerHTML = formIngsHTML();
  renderAC();
  input.focus();
}
function addIngTyped() {
  const raw = ($("#ingInput")?.value || "").trim();
  if (!raw) return;
  const ex = ings().find(i => norm(i.nombre) === norm(raw));
  ex ? addIngToForm(ex.nombre, ex.id) : addIngToForm(raw, null);
}
function createCatInline() {
  const nombre = ($("#newCatName")?.value || "").trim();
  if (!nombre) return toast("Ponle nombre a la categoría 🏷️");
  const ex = cats().find(c => norm(c.nombre) === norm(nombre));
  if (ex) { F.categoriaId = ex.id; F.newCat = false; $("#fCats").innerHTML = formCatsHTML(); return toast("Esa ya existía, la he elegido 😉"); }
  const id = uid();
  save({ ["categorias/" + id]: { nombre, color: F.newCatColor } });
  F.categoriaId = id;
  F.newCat = false;
  $("#fCats").innerHTML = formCatsHTML();
  toast("Categoría creada 🏷️");
}
function saveRecipe() {
  // Si ha dejado algo escrito en ingredientes sin añadir, lo añadimos
  if (($("#ingInput")?.value || "").trim()) addIngTyped();
  const nombre = F.nombre.trim();
  if (!nombre) { toast("Ponle un nombre a la receta 💭"); $("#fNombre")?.focus(); return; }
  if (!F.categoriaId || !S.categorias[F.categoriaId]) return toast("Elige una categoría 🏷️");
  const tiempo = parseInt(F.tiempo, 10);
  const up = {};
  const ingMap = {};
  const nuevos = {};
  F.ings.forEach(i => {
    let id = i.id && S.ingredientes[i.id] ? i.id : null;
    const k = norm(i.nombre);
    if (!id) id = ings().find(x => norm(x.nombre) === k)?.id || nuevos[k];
    if (!id) { id = uid(); nuevos[k] = id; up["ingredientes/" + id] = { nombre: i.nombre.trim() }; }
    ingMap[id] = true;
  });
  const id = F.id || uid();
  const prev = F.id ? S.recetas[F.id] : null;
  up["recetas/" + id] = {
    nombre,
    categoriaId: F.categoriaId,
    precio: F.precio.trim() ? parseNum(F.precio) : null,
    tiempo: isNaN(tiempo) ? null : tiempo,
    ingredientes: Object.keys(ingMap).length ? ingMap : null,
    creada: prev?.creada || Date.now(),
    editada: Date.now()
  };
  const editing = !!F.id;
  F = null;
  save(up);
  if (editing) openRecipe(id); else closeSheet();
  toast(editing ? "Receta actualizada ✨" : "¡Receta guardada! 💕");
}

/* ---------- Asignar al calendario ---------- */
function openAssign(recipeId, key) {
  A = { recipeId, slot: "comida" };
  const r = S.recetas[recipeId];
  openSheet(`
    <h2>📅 Añadir al calendario</h2>
    <p style="margin:-6px 4px 14px;font-weight:800">${esc(r.nombre)}</p>
    <label class="field"><span>Día</span><input type="date" id="aDate" value="${key || todayKey()}"></label>
    <div class="seg" id="aSeg">
      <button class="active" data-action="aSlot" data-slot="comida">☀️ Comida</button>
      <button data-action="aSlot" data-slot="cena">🌙 Cena</button>
    </div>
    <div id="aWarn" class="warn"></div>
    <div class="sheet-actions">
      <button class="btn ghost" data-action="closeSheet">Cancelar</button>
      <button class="btn primary" data-action="saveAssign">Guardar 🗓️</button>
    </div>`);
  updateAssignWarn();
}
function updateAssignWarn() {
  const k = $("#aDate")?.value;
  const w = $("#aWarn");
  if (!w) return;
  const cur = k && S.calendario[k] && S.calendario[k][A.slot];
  w.textContent = cur && cur !== A.recipeId && S.recetas[cur] ? `Ese hueco ya tiene «${S.recetas[cur].nombre}», se cambiará 🔄` : "";
}
function saveAssign() {
  const k = $("#aDate")?.value;
  if (!k) return toast("Elige un día 📅");
  save({ [`calendario/${k}/${A.slot}`]: A.recipeId });
  closeSheet();
  toast(`Apuntada para el ${fmtDayShort(k)} 💕`);
}

/* =========================================================
   🎲 ¿NO SÉ QUÉ COMER?
   ========================================================= */
function openRandom() {
  if (!recetas().length) return toast("Primero añade alguna receta 🧁");
  R = { cat: "all", id: null };
  rollRandom(true);
}
function rollRandom(first) {
  const pool = recetas().filter(r => matchCat(r, R.cat));
  let options = pool.length > 1 ? pool.filter(r => r.id !== R.id) : pool;
  R.id = options.length ? options[Math.floor(Math.random() * options.length)].id : null;
  const r = R.id ? { id: R.id, ...S.recetas[R.id] } : null;
  const emojis = ["😋", "🤤", "👩‍🍳", "✨", "🥰", "🍽️"];
  const html = `
    <h2>🎲 ¿Qué comemos?</h2>
    <div class="chips scroll-x" style="margin:0 -18px;padding-left:18px;padding-right:18px">${catFilterChips(R.cat, "rCat")}</div>
    <div class="rand-card pop" id="randCard">
      ${r ? `<span class="em">${emojis[Math.floor(Math.random() * emojis.length)]}</span>
        <h3>${esc(r.nombre)}</h3>
        <div class="rec-meta">${recMeta(r)}</div>`
      : `<span class="em">🥲</span><h3>No hay recetas en esta categoría</h3>`}
    </div>
    <div class="stack">
      <button class="btn soft block" data-action="reroll">🔄 Otra</button>
      ${r ? `<div class="row">
        <button class="btn ghost" data-action="openRecipe" data-id="${r.id}">👀 Ver receta</button>
        <button class="btn primary" data-action="assignRecipe" data-id="${r.id}">📅 Asignar</button>
      </div>` : ""}
    </div>`;
  if (first) openSheet(html); else $("#sheet").innerHTML = html;
}

/* =========================================================
   🗓️ CALENDARIO
   ========================================================= */
function viewCalendario() {
  return `
    <div class="seg">
      <button class="${UI.calView === "semana" ? "active" : ""}" data-action="calView" data-v="semana">Semana</button>
      <button class="${UI.calView === "mes" ? "active" : ""}" data-action="calView" data-v="mes">Mes</button>
    </div>
    ${UI.calView === "semana" ? weekHTML() : monthHTML()}`;
}
function calNavHTML(label) {
  return `<div class="cal-nav">
    <button class="icon-btn" data-action="calNav" data-d="-1">‹</button>
    <h3>${label}</h3>
    <button class="today" data-action="calToday">Hoy</button>
    <button class="icon-btn" data-action="calNav" data-d="1">›</button>
  </div>`;
}
function slotHTML(k, slot) {
  const rid = S.calendario[k] && S.calendario[k][slot];
  const r = rid && S.recetas[rid] ? { id: rid, ...S.recetas[rid] } : null;
  const lbl = slot === "comida" ? "☀️" : "🌙";
  if (!r) return `<button class="slot empty-slot" data-action="pickSlot" data-k="${k}" data-slot="${slot}"><span class="lbl">${lbl}</span><span class="name">${slot === "comida" ? "Comida" : "Cena"}…</span><span>+</span></button>`;
  return `<button class="slot" style="background:${colorOf(r)}26" data-action="pickSlot" data-k="${k}" data-slot="${slot}"><span class="lbl">${lbl}</span><span class="name">${esc(r.nombre)}</span></button>`;
}
function weekHTML() {
  const start = startOfWeek(UI.calRef);
  const end = addDays(start, 6);
  const label = `${start.getDate()} ${MESES[start.getMonth()].slice(0, 3)} – ${end.getDate()} ${MESES[end.getMonth()].slice(0, 3)}`;
  const hoy = todayKey();
  let days = "";
  for (let i = 0; i < 7; i++) {
    const d = addDays(start, i), k = toKey(d);
    days += `<div class="day ${k === hoy ? "is-today" : ""}">
      <div class="day-date"><small>${DIAS[i]}</small><b>${d.getDate()}</b></div>
      <div class="slots">${slotHTML(k, "comida")}${slotHTML(k, "cena")}</div>
    </div>`;
  }
  return calNavHTML(label) + days;
}
function monthHTML() {
  const ref = UI.calRef;
  const first = new Date(ref.getFullYear(), ref.getMonth(), 1);
  const start = startOfWeek(first);
  const last = new Date(ref.getFullYear(), ref.getMonth() + 1, 0);
  const totalCells = Math.ceil((dow(first) + last.getDate()) / 7) * 7;
  const hoy = todayKey();
  let cells = "";
  for (let i = 0; i < totalCells; i++) {
    const d = addDays(start, i), k = toKey(d);
    const day = S.calendario[k] || {};
    const bar = slot => {
      const rid = day[slot];
      return rid && S.recetas[rid] ? `<span class="mbar full" style="background:${colorOf(S.recetas[rid])}"></span>` : `<span class="mbar"></span>`;
    };
    cells += `<button class="mcell ${d.getMonth() !== ref.getMonth() ? "out" : ""} ${k === hoy ? "is-today" : ""}" data-action="openDay" data-k="${k}">
      <span class="n">${d.getDate()}</span>${bar("comida")}${bar("cena")}
    </button>`;
  }
  return calNavHTML(`${MESES[ref.getMonth()]} ${ref.getFullYear()}`) + `
    <div class="month">
      <div class="wk-head">${["L", "M", "X", "J", "V", "S", "D"].map(d => `<div>${d}</div>`).join("")}</div>
      <div class="mgrid">${cells}</div>
      <div class="legend"><span>Barra de arriba: ☀️ comida</span><span>Abajo: 🌙 cena</span></div>
    </div>`;
}
function openDay(k) {
  openSheet(`
    <h2 style="text-transform:capitalize">${fmtDayLong(k)}</h2>
    <div class="slots">${slotHTML(k, "comida")}${slotHTML(k, "cena")}</div>
    <div class="sheet-actions"><button class="btn ghost" data-action="closeSheet">Cerrar</button></div>`);
}

/* ---------- Selector de receta para un hueco ---------- */
function openPicker(k, slot) {
  if (!recetas().length) { closeSheet(); return toast("Primero añade alguna receta 🧁"); }
  P = { k, slot, cat: "all", q: "" };
  const cur = S.calendario[k] && S.calendario[k][slot];
  const r = cur && S.recetas[cur] ? { id: cur, ...S.recetas[cur] } : null;
  openSheet(`
    <h2>${SLOTS[slot]} · <span style="text-transform:capitalize">${fmtDayShort(k)}</span></h2>
    ${r ? `<div class="current"><span class="dot" style="width:10px;height:10px;border-radius:50%;background:${colorOf(r)}"></span><span class="nm">${esc(r.nombre)}</span><button class="btn-mini" data-action="clearSlot">Quitar</button></div>` : ""}
    <button class="btn soft block" data-action="pickRandomSlot" style="margin-bottom:12px">🎲 Elige tú por mí</button>
    <div class="search flat"><span>🔎</span><input id="pSearch" type="search" placeholder="Buscar receta…" autocomplete="off"></div>
    <div class="chips scroll-x" id="pCats" style="margin:0 -18px 4px;padding-left:18px;padding-right:18px">${catFilterChips("all", "pCat")}</div>
    <div class="pick-list" id="pList">${pickerListHTML()}</div>`);
}
function pickerPool() {
  const q = norm(P.q);
  return recetas().filter(r => matchCat(r, P.cat) && (!q || norm(r.nombre).includes(q)));
}
function pickerListHTML() {
  const cur = S.calendario[P.k] && S.calendario[P.k][P.slot];
  const list = pickerPool();
  if (!list.length) return `<div class="empty" style="padding:20px">Ninguna receta por aquí 🥲</div>`;
  return list.map(r => `<button class="pick-item ${r.id === cur ? "sel" : ""}" data-action="pickRecipe" data-id="${r.id}"><span class="dot" style="background:${colorOf(r)}"></span><span class="nm">${esc(r.nombre)}</span>${r.tiempo != null ? `<span class="muted" style="font-size:13px">⏱ ${fmtTime(r.tiempo)}</span>` : ""}</button>`).join("");
}
function assignSlot(id) {
  const k = P.k;
  save({ [`calendario/${k}/${P.slot}`]: id });
  closeSheet();
  toast(`${S.recetas[id]?.nombre || "Receta"} → ${fmtDayShort(k)} 💕`);
}

/* =========================================================
   🧺 ¿QUÉ COCINO?
   ========================================================= */
function viewCocino() {
  const all = ings();
  // limpiar seleccionados que ya no existen
  [...UI.tengo].forEach(id => { if (!S.ingredientes[id]) UI.tengo.delete(id); });
  if (!all.length) return `<div class="empty"><span class="em">🥕</span><b>Aún no hay ingredientes</b>Se crean solos al añadirlos en tus recetas</div>`;
  return `
    <div class="card intro"><span class="em">🧺</span><p><b>¿Qué tienes en casa?</b>Marca los ingredientes y te digo qué recetas encajan mejor</p></div>
    <div class="search"><span>🔎</span><input id="tengoSearch" type="search" placeholder="Buscar ingrediente…" value="${esc(UI.tengoQ)}" autocomplete="off"></div>
    <div class="card" style="padding:12px">
      <div class="tengo-box"><div class="chips wrap" id="tengoChips">${tengoChipsHTML()}</div></div>
    </div>
    <div id="cocinoLower">${cocinoLowerHTML()}</div>`;
}
function cocinoLowerHTML() {
  return `
    <div class="row between" style="margin:0 4px;min-height:34px">
      <span class="count" style="margin:0">${UI.tengo.size ? `${plural(UI.tengo.size, "ingrediente marcado", "ingredientes marcados")}` : "Nada marcado aún"}</span>
      ${UI.tengo.size ? `<button class="btn-mini" data-action="tengoClear">Limpiar</button>` : ""}
    </div>
    <h3 class="sec-title">🍽️ Podéis cocinar…</h3>
    ${cocinoResHTML()}`;
}
function refreshCocino() {
  $("#tengoChips").innerHTML = tengoChipsHTML();
  $("#cocinoLower").innerHTML = cocinoLowerHTML();
}
function tengoChipsHTML() {
  const q = norm(UI.tengoQ);
  const all = ings().filter(i => !q || norm(i.nombre).includes(q) || UI.tengo.has(i.id));
  const sel = all.filter(i => UI.tengo.has(i.id)), rest = all.filter(i => !UI.tengo.has(i.id));
  if (!all.length) return `<span class="muted" style="font-weight:700">No hay ingredientes con ese nombre</span>`;
  return [...sel, ...rest].map(i => `<button class="chip tengo ${UI.tengo.has(i.id) ? "active" : ""}" data-action="toggleTengo" data-id="${i.id}">${UI.tengo.has(i.id) ? "✅ " : ""}${esc(i.nombre)}</button>`).join("");
}
function cocinoResHTML() {
  if (!UI.tengo.size) return `<div class="empty"><span class="em">👆</span>Marca arriba lo que tienes y aquí aparecerán las recetas</div>`;
  const res = recetas().map(r => {
    const ids = recIngIds(r);
    if (!ids.length) return null;
    const have = ids.filter(i => UI.tengo.has(i));
    const miss = ids.filter(i => !UI.tengo.has(i));
    return { r, have, miss, pct: Math.round(have.length / ids.length * 100) };
  }).filter(x => x && x.have.length)
    .sort((a, b) => b.pct - a.pct || a.miss.length - b.miss.length || a.r.nombre.localeCompare(b.r.nombre, "es"));
  if (!res.length) return `<div class="empty"><span class="em">🤔</span><b>Ninguna receta encaja</b>Ninguna de vuestras recetas lleva esos ingredientes</div>`;
  const nm = id => esc(S.ingredientes[id].nombre);
  return res.map(({ r, have, miss, pct }) => {
    const col = pct === 100 ? "var(--mint)" : pct >= 60 ? "var(--yellow)" : "var(--peach)";
    const tag = pct === 100 ? "💚" : pct >= 60 ? "💛" : "🧡";
    return `<button class="res-card" data-action="openRecipe" data-id="${r.id}">
      <div class="res-top"><span class="nm">${esc(r.nombre)}</span><span class="pct" style="color:${col}">${pct}% ${tag}</span></div>
      <div class="bar"><i style="width:${pct}%;background:${col}"></i></div>
      ${catPill(catOf(r))}
      ${pct === 100 ? `<div class="res-line"><b>¡Lo tienes todo! 🎉</b></div>`
        : `<div class="res-line">🛒 Te falta: <b>${miss.map(nm).join(", ")}</b></div>`}
      <div class="res-line">✅ Tienes: ${have.map(nm).join(", ")}</div>
    </button>`;
  }).join("");
}

/* =========================================================
   ⚙️ AJUSTES
   ========================================================= */
function viewAjustes() {
  const cs = cats();
  return `
    <section class="card">
      <div class="sec-head"><h3>🏷️ Categorías</h3><button class="btn-mini" data-action="newCat">+ Nueva</button></div>
      ${cs.length ? cs.map(c => {
        const n = recetasConCat(c.id).length;
        return `<div class="set-row">
          <span class="swatch" style="background:${c.color}"></span>
          <span class="nm">${esc(c.nombre)}<small>${plural(n, "receta", "recetas")}</small></span>
          <button class="icon-btn" data-action="editCat" data-id="${c.id}">✏️</button>
          <button class="icon-btn" data-action="deleteCat" data-id="${c.id}">🗑</button>
        </div>`;
      }).join("") : `<p class="muted" style="font-weight:700;margin:4px">Aún no hay categorías. ¡Crea la primera! 🏷️</p>`}
    </section>

    <section class="card">
      <div class="sec-head"><h3>🥕 Ingredientes <small class="muted">(${ings().length})</small></h3></div>
      <div class="add-row">
        <input id="newIngName" class="input" placeholder="Añadir ingrediente…" autocomplete="off" enterkeyhint="done">
        <button class="btn-mini" data-action="addIngSettings">Añadir</button>
      </div>
      <div class="search flat"><span>🔎</span><input id="ingSearch" type="search" placeholder="Buscar…" value="${esc(UI.ingQ)}" autocomplete="off"></div>
      <p class="hint" style="margin:-4px 4px 8px">🔀 Fusionar: si tenéis «alubia» y «alubias», fusiona una en la otra y se cambia sola en todas las recetas.</p>
      <div class="list-scroll" id="ingRows">${ingRowsHTML()}</div>
    </section>

    <p class="about">Recetario de Cris y Eider 💕<br>Todo se sincroniza entre vuestros móviles</p>`;
}
function ingRowsHTML() {
  const q = norm(UI.ingQ);
  const list = ings().filter(i => !q || norm(i.nombre).includes(q));
  if (!list.length) return `<p class="muted" style="font-weight:700;margin:6px 4px">${ings().length ? "Ninguno con ese nombre" : "Se irán guardando solos al añadirlos en las recetas 🥕"}</p>`;
  return list.map(i => {
    const n = recetasConIng(i.id).length;
    return `<div class="set-row">
      <span class="nm">${esc(i.nombre)}<small>${n ? `en ${plural(n, "receta", "recetas")}` : "sin usar"}</small></span>
      <button class="icon-btn" data-action="editIng" data-id="${i.id}">✏️</button>
      <button class="icon-btn" data-action="mergeIng" data-id="${i.id}">🔀</button>
      <button class="icon-btn" data-action="deleteIng" data-id="${i.id}">🗑</button>
    </div>`;
  }).join("");
}

/* ---------- Categorías ---------- */
function openCatForm(id) {
  const c = id ? S.categorias[id] : null;
  CF = { id: id || null, color: c?.color || COLORES[cats().length % COLORES.length] };
  openSheet(`
    <h2>${id ? "✏️ Editar categoría" : "🏷️ Nueva categoría"}</h2>
    <label class="field"><span>Nombre</span><input id="catName" value="${esc(c?.nombre || "")}" placeholder="Ej: Ensaladas" maxlength="30" autocomplete="off"></label>
    <div class="field"><span>Color</span><div class="colors" id="catColors">${catColorsHTML()}</div></div>
    <div class="sheet-actions">
      <button class="btn ghost" data-action="closeSheet">Cancelar</button>
      <button class="btn primary" data-action="saveCat">Guardar 💕</button>
    </div>`);
}
const catColorsHTML = () => COLORES.map(c => `<button class="color-dot ${CF.color === c ? "active" : ""}" style="background:${c}" data-action="catColor" data-c="${c}"></button>`).join("");
function saveCat() {
  const nombre = ($("#catName")?.value || "").trim();
  if (!nombre) return toast("Ponle un nombre 🏷️");
  const dup = cats().find(c => norm(c.nombre) === norm(nombre) && c.id !== CF.id);
  if (dup) return toast("Ya existe una categoría con ese nombre 😉");
  const editing = !!CF.id;
  const id = CF.id || uid();
  save({ ["categorias/" + id]: { nombre, color: CF.color } });
  closeSheet();
  toast(editing ? "Categoría actualizada ✨" : "Categoría creada 🏷️");
}
async function deleteCat(id) {
  const c = S.categorias[id];
  if (!c) return;
  const rs = recetasConCat(id);
  const ok = await confirmDlg("¿Borrar categoría?",
    rs.length ? `«${c.nombre}» tiene ${plural(rs.length, "receta", "recetas")}. No se borran, se quedarán como «Sin categoría».` : `Se borrará «${c.nombre}».`,
    "Sí, borrar", true);
  if (!ok) return;
  const up = { ["categorias/" + id]: null };
  rs.forEach(r => { up[`recetas/${r.id}/categoriaId`] = null; });
  if (UI.filtroCat === id) UI.filtroCat = "all";
  save(up);
  toast("Categoría borrada 🗑");
}

/* ---------- Ingredientes ---------- */
function addIngSettings() {
  const input = $("#newIngName");
  const nombre = (input?.value || "").trim();
  if (!nombre) return;
  if (ings().some(i => norm(i.nombre) === norm(nombre))) return toast("Ese ingrediente ya existe 😉");
  save({ ["ingredientes/" + uid()]: { nombre } });
  toast(`«${nombre}» añadido 🥕`);
  setTimeout(() => $("#newIngName")?.focus(), 0);
}
function openIngEdit(id) {
  const i = S.ingredientes[id];
  if (!i) return;
  openSheet(`
    <h2>✏️ Editar ingrediente</h2>
    <label class="field"><span>Nombre</span><input id="ingName" value="${esc(i.nombre)}" maxlength="40" autocomplete="off"></label>
    <p class="hint">Se cambiará en ${plural(recetasConIng(id).length, "receta", "recetas")}.</p>
    <div class="sheet-actions">
      <button class="btn ghost" data-action="closeSheet">Cancelar</button>
      <button class="btn primary" data-action="saveIng" data-id="${id}">Guardar 💕</button>
    </div>`);
}
async function saveIng(id) {
  const nombre = ($("#ingName")?.value || "").trim();
  if (!nombre) return toast("Ponle un nombre 🥕");
  const dup = ings().find(x => norm(x.nombre) === norm(nombre) && x.id !== id);
  if (dup) {
    const ok = await confirmDlg("Ya existe 🤔", `Ya tenéis «${dup.nombre}». ¿Quieres fusionar «${S.ingredientes[id].nombre}» con él?`, "Sí, fusionar");
    if (ok) { closeSheet(); doMerge(id, dup.id); }
    return;
  }
  save({ [`ingredientes/${id}/nombre`]: nombre });
  closeSheet();
  toast("Ingrediente actualizado ✨");
}
async function deleteIng(id) {
  const i = S.ingredientes[id];
  if (!i) return;
  const rs = recetasConIng(id);
  const ok = await confirmDlg("¿Borrar ingrediente?",
    rs.length ? `«${i.nombre}» aparece en ${plural(rs.length, "receta", "recetas")} (${rs.slice(0, 3).map(r => r.nombre).join(", ")}${rs.length > 3 ? "…" : ""}) y se quitará de ellas.` : `Se borrará «${i.nombre}».`,
    "Sí, borrar", true);
  if (!ok) return;
  const up = { ["ingredientes/" + id]: null };
  rs.forEach(r => { up[`recetas/${r.id}/ingredientes/${id}`] = null; });
  UI.tengo.delete(id);
  save(up);
  toast("Ingrediente borrado 🗑");
}
function openMerge(id) {
  if (ings().length < 2) return toast("Necesitas al menos dos ingredientes 😉");
  M = { src: id, q: "" };
  openSheet(`
    <h2>🔀 Fusionar «${esc(S.ingredientes[id].nombre)}»</h2>
    <p class="hint" style="margin:-6px 4px 12px">Elige con cuál es el mismo. «${esc(S.ingredientes[id].nombre)}» desaparecerá y se cambiará por el que elijas en todas las recetas.</p>
    <div class="search flat"><span>🔎</span><input id="mSearch" type="search" placeholder="Buscar…" autocomplete="off"></div>
    <div class="pick-list" id="mList">${mergeListHTML()}</div>`);
}
function mergeListHTML() {
  const q = norm(M.q);
  const base = norm(S.ingredientes[M.src]?.nombre).slice(0, 3);
  const list = ings().filter(i => i.id !== M.src && (!q || norm(i.nombre).includes(q)))
    // los que se parecen, primero
    .sort((a, b) => (norm(b.nombre).startsWith(base) - norm(a.nombre).startsWith(base)) || a.nombre.localeCompare(b.nombre, "es"));
  if (!list.length) return `<div class="empty" style="padding:20px">Ninguno con ese nombre</div>`;
  return list.map(i => `<button class="pick-item" data-action="mergeInto" data-id="${i.id}"><span class="nm">${esc(i.nombre)}</span><span class="muted" style="font-size:13px">${plural(recetasConIng(i.id).length, "receta", "recetas")}</span></button>`).join("");
}
async function mergeInto(tgt) {
  const src = M.src;
  const a = S.ingredientes[src], b = S.ingredientes[tgt];
  const n = recetasConIng(src).length;
  const ok = await confirmDlg("¿Fusionar?", `«${a.nombre}» se cambiará por «${b.nombre}»${n ? ` en ${plural(n, "receta", "recetas")}` : ""} y desaparecerá de la lista.`, "Sí, fusionar");
  if (!ok) return;
  closeSheet();
  doMerge(src, tgt);
}
function doMerge(src, tgt) {
  const up = { ["ingredientes/" + src]: null };
  recetasConIng(src).forEach(r => {
    up[`recetas/${r.id}/ingredientes/${src}`] = null;
    up[`recetas/${r.id}/ingredientes/${tgt}`] = true;
  });
  if (UI.tengo.has(src)) { UI.tengo.delete(src); UI.tengo.add(tgt); }
  const nb = S.ingredientes[tgt]?.nombre;
  save(up);
  toast(`Fusionado en «${nb}» 🔀`);
}

/* =========================================================
   Hojas, diálogos y avisos
   ========================================================= */
function openSheet(html) {
  $("#sheet").innerHTML = html;
  $("#sheet").scrollTop = 0;
  $("#sheetWrap").classList.add("open");
  document.body.classList.add("lock");
}
function closeSheet() {
  $("#sheetWrap").classList.remove("open");
  document.body.classList.remove("lock");
  if (document.activeElement) document.activeElement.blur();
  F = A = P = R = M = CF = null;
}
function confirmDlg(title, text, okLabel = "Sí", danger = false) {
  return new Promise(res => {
    const d = $("#dialog");
    d.innerHTML = `<div class="box"><h3>${esc(title)}</h3><p>${esc(text)}</p>
      <div class="row"><button class="btn ghost" data-res="0">Cancelar</button><button class="btn ${danger ? "danger" : "primary"}" data-res="1">${esc(okLabel)}</button></div></div>`;
    d.classList.add("open");
    d.onclick = e => {
      const b = e.target.closest("[data-res]");
      if (!b && e.target !== d) return;
      d.classList.remove("open");
      d.onclick = null;
      res(b ? b.dataset.res === "1" : false);
    };
  });
}
let toastT;
function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toastT);
  toastT = setTimeout(() => t.classList.remove("show"), 2200);
}

/* =========================================================
   Eventos
   ========================================================= */
const ACTIONS = {
  tab: el => { UI.tab = el.dataset.tab; render(); window.scrollTo(0, 0); },
  closeSheet: () => closeSheet(),

  // Recetas
  filterCat: el => { UI.filtroCat = el.dataset.id; render(); },
  newRecipe: () => openRecipeForm(null),
  openRecipe: el => openRecipe(el.dataset.id),
  editRecipe: el => openRecipeForm(el.dataset.id),
  deleteRecipe: el => deleteRecipe(el.dataset.id),
  assignRecipe: el => openAssign(el.dataset.id),
  pickFormCat: el => { F.categoriaId = el.dataset.id; $("#fCats").innerHTML = formCatsHTML(); },
  toggleNewCat: () => { F.newCat = !F.newCat; $("#fCats").innerHTML = formCatsHTML(); if (F.newCat) $("#newCatName")?.focus(); },
  newCatColor: el => {
    const name = $("#newCatName")?.value || "";
    F.newCatColor = el.dataset.c;
    $("#fCats").innerHTML = formCatsHTML();
    $("#newCatName").value = name;
  },
  createCatInline: () => createCatInline(),
  addIngTyped: () => addIngTyped(),
  addIngSug: el => { const i = S.ingredientes[el.dataset.id]; if (i) addIngToForm(i.nombre, el.dataset.id); },
  removeFormIng: el => { F.ings.splice(+el.dataset.i, 1); $("#fIngs").innerHTML = formIngsHTML(); renderAC(); },
  saveRecipe: () => saveRecipe(),
  aSlot: el => {
    A.slot = el.dataset.slot;
    document.querySelectorAll("#aSeg button").forEach(b => b.classList.toggle("active", b.dataset.slot === A.slot));
    updateAssignWarn();
  },
  saveAssign: () => saveAssign(),

  // Dado
  random: () => openRandom(),
  reroll: () => rollRandom(false),
  rCat: el => { R.cat = el.dataset.id; R.id = null; rollRandom(false); },

  // Calendario
  calView: el => { UI.calView = el.dataset.v; render(); },
  calNav: el => {
    const d = +el.dataset.d, r = UI.calRef;
    UI.calRef = UI.calView === "semana" ? addDays(r, 7 * d) : new Date(r.getFullYear(), r.getMonth() + d, 1);
    render();
  },
  calToday: () => { UI.calRef = new Date(); render(); },
  openDay: el => openDay(el.dataset.k),
  pickSlot: el => openPicker(el.dataset.k, el.dataset.slot),
  pCat: el => {
    P.cat = el.dataset.id;
    $("#pCats").innerHTML = catFilterChips(P.cat, "pCat");
    $("#pList").innerHTML = pickerListHTML();
  },
  pickRecipe: el => assignSlot(el.dataset.id),
  pickRandomSlot: () => {
    const pool = pickerPool();
    if (!pool.length) return toast("No hay recetas con ese filtro 🥲");
    assignSlot(pool[Math.floor(Math.random() * pool.length)].id);
  },
  clearSlot: () => { save({ [`calendario/${P.k}/${P.slot}`]: null }); closeSheet(); toast("Hueco libre 🧹"); },

  // ¿Qué cocino?
  toggleTengo: el => { const id = el.dataset.id; UI.tengo.has(id) ? UI.tengo.delete(id) : UI.tengo.add(id); refreshCocino(); },
  tengoClear: () => { UI.tengo.clear(); refreshCocino(); },

  // Ajustes
  newCat: () => openCatForm(null),
  editCat: el => openCatForm(el.dataset.id),
  deleteCat: el => deleteCat(el.dataset.id),
  catColor: el => { CF.color = el.dataset.c; $("#catColors").innerHTML = catColorsHTML(); },
  saveCat: () => saveCat(),
  addIngSettings: () => addIngSettings(),
  editIng: el => openIngEdit(el.dataset.id),
  saveIng: el => saveIng(el.dataset.id),
  deleteIng: el => deleteIng(el.dataset.id),
  mergeIng: el => openMerge(el.dataset.id),
  mergeInto: el => mergeInto(el.dataset.id)
};

document.addEventListener("click", e => {
  const el = e.target.closest("[data-action]");
  if (!el) return;
  const fn = ACTIONS[el.dataset.action];
  if (fn) { e.preventDefault(); fn(el, e); }
});

document.addEventListener("input", e => {
  const t = e.target;
  if (t.dataset.f && F) F[t.dataset.f] = t.value;
  switch (t.id) {
    case "recSearch": UI.busqueda = t.value; $("#recList").innerHTML = recListHTML(); break;
    case "ingInput": renderAC(); break;
    case "tengoSearch": UI.tengoQ = t.value; $("#tengoChips").innerHTML = tengoChipsHTML(); break;
    case "ingSearch": UI.ingQ = t.value; $("#ingRows").innerHTML = ingRowsHTML(); break;
    case "pSearch": P.q = t.value; $("#pList").innerHTML = pickerListHTML(); break;
    case "mSearch": M.q = t.value; $("#mList").innerHTML = mergeListHTML(); break;
  }
});

document.addEventListener("change", e => { if (e.target.id === "aDate" && A) updateAssignWarn(); });

document.addEventListener("keydown", e => {
  if (e.key !== "Enter") return;
  const id = e.target.id;
  if (id === "ingInput") { e.preventDefault(); addIngTyped(); }
  else if (id === "newIngName") { e.preventDefault(); addIngSettings(); }
  else if (id === "newCatName") { e.preventDefault(); createCatInline(); }
  else if (id === "catName") { e.preventDefault(); saveCat(); }
  else if (id === "ingName") { e.preventDefault(); saveIng($("[data-action=saveIng]").dataset.id); }
});

/* =========================================================
   Arranque
   ========================================================= */
function setSync(state) {
  const el = $("#sync");
  if (state === "on") { el.textContent = "● Sincronizado"; el.className = "sync on"; }
  else if (state === "off") { el.textContent = "● Sin conexión"; el.className = "sync off"; }
  else { el.textContent = "● Solo en este móvil"; el.className = "sync off"; }
}

(function init() {
  try {
    const c = localStorage.getItem(CACHE_KEY);
    if (c) S = shape(JSON.parse(c));
  } catch (e) { /* nada */ }
  render();

  if (db) {
    db.on("value", snap => {
      S = shape(snap.val());
      cacheLocal();
      render();
    }, err => toast("⚠️ Firebase: " + err.message));
    fbRoot.ref(".info/connected").on("value", s => setSync(s.val() ? "on" : "off"));
  } else {
    setSync("local");
  }

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("sw.js").catch(() => { });
  }
})();
