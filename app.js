const DB_NAME = "echo-vault";
const STORE = "media";
const state = { items: [], filter: "all", view: "library", query: "", sortNewest: true, current: null, objectUrl: null };
const $ = (id) => document.getElementById(id);
const audio = $("audio-player");
const video = $("video-player");
const savedTheme = localStorage.getItem("echo-vault-theme");
if (savedTheme === "dark") document.body.classList.add("dark");

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: "id" });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
async function dbRequest(mode, action) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE, mode);
    const request = action(transaction.objectStore(STORE));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
const getItems = () => dbRequest("readonly", (store) => store.getAll());
const saveItem = (item) => dbRequest("readwrite", (store) => store.put(item));
const removeItem = (id) => dbRequest("readwrite", (store) => store.delete(id));

function formatTime(seconds) {
  if (!Number.isFinite(seconds)) return "0:00";
  return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
}
function notify(message) {
  const toast = $("toast");
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(notify.timeout);
  notify.timeout = setTimeout(() => toast.classList.remove("show"), 2800);
}
function isVideo(item) { return item.kind === "video"; }
function visibleItems() {
  return state.items.filter((item) => {
    const matchesFilter = state.filter === "all" || item.kind === state.filter;
    const matchesView = state.view === "favorites" ? item.favorite : state.view === "recent" ? item.lastPlayed : true;
    const matchesQuery = !state.query || item.name.toLowerCase().includes(state.query.toLowerCase());
    return matchesFilter && matchesView && matchesQuery;
  }).sort((a, b) => state.sortNewest ? b.addedAt - a.addedAt : a.name.localeCompare(b.name));
}
function render() {
  const items = visibleItems();
  $("media-grid").innerHTML = "";
  $("empty-state").hidden = items.length > 0;
  $("result-count").textContent = `${items.length} item${items.length === 1 ? "" : "s"}`;
  $("storage-count").textContent = `${state.items.length} file${state.items.length === 1 ? "" : "s"} in your vault`;
  $("media-grid").hidden = items.length === 0;
  const titles = { library: "Your library", favorites: "Favorites", recent: "Recently played" };
  $("page-title").textContent = titles[state.view];
  $("section-title").textContent = state.view === "library" ? "All media" : titles[state.view];
  for (const item of items) {
    const card = document.createElement("article");
    card.className = "media-card";
    card.innerHTML = `<div class="cover ${isVideo(item) ? "video" : ""}"><span class="type-label">${isVideo(item) ? "VIDEO" : "AUDIO"}</span><span class="cover-symbol">${isVideo(item) ? "▶" : "♪"}</span><button class="card-play" aria-label="Play ${escapeHtml(item.name)}">▶</button></div><div class="card-title" title="${escapeHtml(item.name)}">${escapeHtml(item.name)}</div><div class="card-details"><span>${formatBytes(item.size)}</span><button class="favorite-card" aria-label="Favorite">${item.favorite ? "♥" : "♡"}</button></div>`;
    card.querySelector(".card-play").addEventListener("click", () => play(item));
    card.querySelector(".favorite-card").addEventListener("click", () => toggleFavorite(item));
    $("media-grid").appendChild(card);
  }
}
function escapeHtml(text) { return text.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[c]); }
function formatBytes(bytes) { if (!bytes) return "0 KB"; const units = ["B", "KB", "MB", "GB"]; const i = Math.floor(Math.log(bytes) / Math.log(1024)); return `${(bytes / 1024 ** i).toFixed(i ? 1 : 0)} ${units[i]}`; }
async function addFiles(files) {
  const accepted = [...files].filter((file) => file.type.startsWith("audio/") || file.type.startsWith("video/"));
  if (!accepted.length) return notify("Please choose an audio or video file.");
  for (const file of accepted) {
    await saveItem({ id: crypto.randomUUID(), name: file.name.replace(/\.[^/.]+$/, ""), fileName: file.name, size: file.size, type: file.type, kind: file.type.startsWith("video/") ? "video" : "audio", blob: file, addedAt: Date.now(), favorite: false, lastPlayed: null });
  }
  state.items = await getItems();
  render();
  notify(`${accepted.length} file${accepted.length > 1 ? "s" : ""} added to your vault.`);
}
async function toggleFavorite(item) {
  item.favorite = !item.favorite;
  await saveItem(item);
  if (state.current?.id === item.id) $("now-favorite").textContent = item.favorite ? "♥" : "♡";
  state.items = await getItems();
  render();
}
function play(item) {
  if (state.objectUrl) URL.revokeObjectURL(state.objectUrl);
  state.objectUrl = URL.createObjectURL(item.blob);
  state.current = item;
  const player = isVideo(item) ? video : audio;
  const other = isVideo(item) ? audio : video;
  other.pause(); other.hidden = true; player.hidden = isVideo(item) ? false : true;
  player.src = state.objectUrl; player.volume = Number($("volume").value);
  player.play().catch(() => notify("Playback needs a user gesture. Press play to start."));
  item.lastPlayed = Date.now(); saveItem(item);
  $("now-title").textContent = item.name; $("now-subtitle").textContent = isVideo(item) ? "Video" : "Audio";
  $("mini-art").textContent = isVideo(item) ? "▶" : "♪"; $("now-favorite").textContent = item.favorite ? "♥" : "♡"; $("play-button").textContent = "Ⅱ";
}
function activePlayer() { return state.current && isVideo(state.current) ? video : audio; }
function playNext(direction = 1) { const list = visibleItems(); if (!list.length) return; const index = Math.max(0, list.findIndex((item) => item.id === state.current?.id)); play(list[(index + direction + list.length) % list.length]); }
function bindPlayer(player) {
  player.addEventListener("timeupdate", () => { if (player !== activePlayer()) return; $("progress").value = player.duration ? (player.currentTime / player.duration) * 100 : 0; $("current-time").textContent = formatTime(player.currentTime); $("total-time").textContent = formatTime(player.duration); });
  player.addEventListener("ended", () => playNext(1));
}
bindPlayer(audio); bindPlayer(video);
$("play-button").addEventListener("click", () => { const player = activePlayer(); if (!player) return notify("Choose a track from your library first."); if (player.paused) { player.play(); $("play-button").textContent = "Ⅱ"; } else { player.pause(); $("play-button").textContent = "▶"; } });
$("prev-button").addEventListener("click", () => playNext(-1)); $("next-button").addEventListener("click", () => playNext(1));
$("progress").addEventListener("input", (event) => { const player = activePlayer(); if (player?.duration) player.currentTime = (event.target.value / 100) * player.duration; });
$("volume").addEventListener("input", (event) => { audio.volume = video.volume = event.target.value; });
$("volume-button").addEventListener("click", () => { const muted = audio.muted; audio.muted = video.muted = !muted; $("volume-button").textContent = muted ? "◖" : "◗"; });
$("now-favorite").addEventListener("click", () => { if (state.current) toggleFavorite(state.current); });
function chooseFiles() { $("file-input").click(); }
$("browse-button").addEventListener("click", chooseFiles); $("hero-upload").addEventListener("click", chooseFiles); $("empty-upload").addEventListener("click", chooseFiles);
$("file-input").addEventListener("change", (event) => addFiles(event.target.files));
const dropZone = $("drop-zone"); ["dragenter", "dragover"].forEach((event) => dropZone.addEventListener(event, (e) => { e.preventDefault(); dropZone.classList.add("dragging"); })); ["dragleave", "drop"].forEach((event) => dropZone.addEventListener(event, (e) => { e.preventDefault(); dropZone.classList.remove("dragging"); })); dropZone.addEventListener("drop", (event) => addFiles(event.dataTransfer.files));
document.querySelectorAll(".filter-button").forEach((button) => button.addEventListener("click", () => { state.filter = button.dataset.filter; document.querySelectorAll(".filter-button").forEach((b) => b.classList.toggle("active", b === button)); render(); }));
document.querySelectorAll(".nav-link").forEach((button) => button.addEventListener("click", () => { state.view = button.dataset.view; document.querySelectorAll(".nav-link").forEach((b) => b.classList.toggle("active", b === button)); render(); }));
$("search-input").addEventListener("input", (event) => { state.query = event.target.value; render(); });
$("sort-button").addEventListener("click", () => { state.sortNewest = !state.sortNewest; $("sort-button").textContent = state.sortNewest ? "Recently added ↕" : "Name A–Z ↕"; render(); });
$("theme-button").addEventListener("click", () => {
  const isDark = document.body.classList.toggle("dark");
  localStorage.setItem("echo-vault-theme", isDark ? "dark" : "light");
  $("theme-button").setAttribute("aria-label", isDark ? "Switch to light mode" : "Switch to dark mode");
  $("theme-button").title = isDark ? "Switch to light mode" : "Switch to dark mode";
});
getItems().then((items) => { state.items = items; render(); }).catch(() => notify("Could not open your local media vault."));
