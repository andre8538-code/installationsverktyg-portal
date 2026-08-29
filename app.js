// ==================================================================
// Installationsintyg-portal — app.js
// ==================================================================

const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const PHOTO_BUCKET = "certificate-photos";

// ---------- Fotokategorier (styr sektion 9 i blanketten) ----------
const PHOTO_CATEGORIES = [
  { group: "Före nedgrävning — tankinspektion", items: [
    { key: "tank_hel_uppifran", label: "Hel tank uppifrån" },
    { key: "tank_mantel_sidor", label: "Tankens mantel och sidor" },
    { key: "tank_ror_anslutningar", label: "Röranslutningar och genomföringar" },
    { key: "tank_lock_luckor", label: "Lock och luckor" },
    { key: "tank_transportskador", label: "Eventuella transportskador" },
  ]},
  { group: "Under grävning — markförhållanden", items: [
    { key: "schakt_botten", label: "Schaktbotten innan bäddmaterial" },
    { key: "grundvatten_synlig", label: "Grundvattennivå om synlig" },
    { key: "jordprofil_schaktvagg", label: "Jordprofil i schaktvägg" },
  ]},
  { group: "Tankinstallation", items: [
    { key: "tank_placering_schakt", label: "Tank placerad i schakt, vy uppifrån" },
    { key: "forankring_detalj", label: "Förankring i detalj" },
    { key: "tillopp_anslutning", label: "Tilloppsledningens anslutning till tank" },
    { key: "franlopp_nivaskillnad", label: "Frånloppsanslutning och nivåskillnad" },
    { key: "geotextil_skyddsmatta", label: "Geotextil/skyddsmatta runt tank" },
  ]},
  { group: "Bädduppbyggnad — ett foto per lager", items: [
    { key: "dranering_lager", label: "Dräneringslager (makadam)" },
    { key: "materialskiljande_skikt", label: "Materialskiljande skikt (geotextil)" },
    { key: "infiltration_markbadd_lager", label: "Infiltrations-/markbäddslager" },
    { key: "spridningsledningar", label: "Spridningsledningar/perkolationsrör" },
    { key: "spridningslager_ovanpa", label: "Spridningslager ovanpå rören" },
    { key: "oversta_lagret_frost", label: "Översta lagret / frostbrytande material" },
    { key: "badd_matt_tumstock", label: "Bäddens totala mått med tumstock" },
  ]},
  { group: "Styrskåp och elutrustning", items: [
    { key: "styrskap_placering", label: "Styrskåpets placering" },
    { key: "styrskap_innanmate", label: "Innanmäte styrskåp" },
    { key: "pumppaket_foto", label: "Pumppaket" },
    { key: "larmutrustning", label: "Larmutrustning" },
  ]},
  { group: "Avslutad installation", items: [
    { key: "overtackt_anlaggning", label: "Övertäckt anläggning" },
    { key: "besiktningsluckor", label: "Besiktnings- och serviceluckor" },
    { key: "ventilationsror", label: "Ventilationsrör ovan tak" },
    { key: "skyltning", label: "Skyltning/markering av läge" },
  ]},
];

// ---------- Global state ----------
let currentUser = null;
let currentProfile = null;
let currentOrgFilter = null;
let currentCertificate = null;   // { id, client_id, org_id, form_data, signature_data, status }
let currentPhotos = [];          // synkade certificate_photos-rader
let currentPendingPhotos = [];   // ej synkade foton (IndexedDB) för öppet intyg
let sigDirty = false;

// ==================================================================
// BOOT
// ==================================================================

window.addEventListener("DOMContentLoaded", init);

async function init() {
  buildPhotoGrid();
  wireSignaturePad();
  wireStaticButtons();
  registerServiceWorker();

  window.addEventListener("online", () => { updateSyncBadge(); if (currentProfile) syncPending(); });
  window.addEventListener("offline", updateSyncBadge);
  setInterval(() => { if (navigator.onLine && currentProfile) syncPending(); }, 60000);

  await updateSyncBadge();

  const { data: { session } } = await supabase.auth.getSession();
  if (session) {
    await loadSessionAndRoute();
  } else {
    showView("auth");
  }

  supabase.auth.onAuthStateChange((event) => {
    if (event === "SIGNED_OUT") {
      currentUser = null;
      currentProfile = null;
      showView("auth");
    }
  });
}

function registerServiceWorker() {
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("service-worker.js").catch((e) => {
      console.warn("Service worker kunde inte registreras:", e.message);
    });
  }
}

async function loadSessionAndRoute() {
  const { data: { user } } = await supabase.auth.getUser();
  currentUser = user;

  const { data: profile, error } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .maybeSingle();

  if (error) console.error(error);

  if (!profile) {
    showView("auth");
    switchAuthTab("org");
    document.getElementById("authError").classList.add("hidden");
    document.getElementById("orgSetupBlock").classList.remove("hidden");
    document.getElementById("loginSignupBlock").classList.add("hidden");
    return;
  }

  currentProfile = profile;
  if (navigator.onLine) syncPending();
  await goToDashboard();
}

// ==================================================================
// AUTH
// ==================================================================

function wireStaticButtons() {
  document.getElementById("tabLogin").onclick = () => switchAuthTab("login");
  document.getElementById("tabSignup").onclick = () => switchAuthTab("signup");

  document.getElementById("loginForm").onsubmit = onLogin;
  document.getElementById("signupForm").onsubmit = onSignup;
  document.getElementById("createOrgForm").onsubmit = onCreateOrg;
  document.getElementById("joinOrgForm").onsubmit = onJoinOrg;

  document.getElementById("orgChoiceCreate").onclick = () => showOrgChoice("create");
  document.getElementById("orgChoiceJoin").onclick = () => showOrgChoice("join");

  document.getElementById("btnLogout").onclick = onLogout;
  document.getElementById("btnNewCertificate").onclick = () => openEditor(null, null);
  document.getElementById("btnBackToDash").onclick = goToDashboard;
  document.getElementById("btnSaveCertificate").onclick = () => saveCertificate(false);
  document.getElementById("btnMarkDone").onclick = () => saveCertificate(true);
  document.getElementById("btnPrint").onclick = () => window.print();
  document.getElementById("btnDeleteCertificate").onclick = onDeleteCertificate;
  document.getElementById("btnSyncNow").onclick = syncPending;
  document.getElementById("btnGpsCapture").onclick = () => captureGPS(false);

  const orgFilterSelect = document.getElementById("orgFilterSelect");
  if (orgFilterSelect) {
    orgFilterSelect.onchange = (e) => {
      currentOrgFilter = e.target.value || null;
      loadCertificates();
    };
  }
}

function switchAuthTab(tab) {
  document.getElementById("tabLogin").classList.toggle("active", tab === "login");
  document.getElementById("tabSignup").classList.toggle("active", tab === "signup");
  document.getElementById("loginForm").classList.toggle("hidden", tab !== "login");
  document.getElementById("signupForm").classList.toggle("hidden", tab !== "signup");
  document.getElementById("orgSetupBlock").classList.add("hidden");
  document.getElementById("loginSignupBlock").classList.remove("hidden");
}

function showOrgChoice(which) {
  document.getElementById("createOrgForm").classList.toggle("hidden", which !== "create");
  document.getElementById("joinOrgForm").classList.toggle("hidden", which !== "join");
}

function showAuthError(msg) {
  const el = document.getElementById("authError");
  el.textContent = msg;
  el.classList.remove("hidden");
}

async function onLogin(e) {
  e.preventDefault();
  document.getElementById("authError").classList.add("hidden");
  const email = document.getElementById("loginEmail").value.trim();
  const password = document.getElementById("loginPassword").value;
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return showAuthError(error.message);
  await loadSessionAndRoute();
}

async function onSignup(e) {
  e.preventDefault();
  document.getElementById("authError").classList.add("hidden");
  const email = document.getElementById("signupEmail").value.trim();
  const password = document.getElementById("signupPassword").value;
  const { data, error } = await supabase.auth.signUp({ email, password });
  if (error) return showAuthError(error.message);

  if (!data.session) {
    document.getElementById("authNotice").textContent =
      "Konto skapat. Kolla din e-post för bekräftelselänk, logga sedan in.";
    document.getElementById("authNotice").classList.remove("hidden");
    switchAuthTab("login");
    return;
  }
  await loadSessionAndRoute();
}

async function onCreateOrg(e) {
  e.preventDefault();
  document.getElementById("authError").classList.add("hidden");
  const name = document.getElementById("orgName").value.trim();
  const orgNumber = document.getElementById("orgNumber").value.trim();
  const fullName = document.getElementById("orgFullName").value.trim();

  const { data, error } = await supabase.rpc("create_organization", {
    p_name: name, p_org_number: orgNumber, p_full_name: fullName,
  });
  if (error) return showAuthError(error.message);

  const row = Array.isArray(data) ? data[0] : data;
  alert(
    "Firma skapad!\n\nInbjudningskod för dina kollegor (max 5 till): " +
    row.invite_code +
    "\n\nSpara koden — den visas bara nu."
  );
  await loadSessionAndRoute();
}

async function onJoinOrg(e) {
  e.preventDefault();
  document.getElementById("authError").classList.add("hidden");
  const orgNumber = document.getElementById("joinOrgNumber").value.trim();
  const inviteCode = document.getElementById("joinInviteCode").value.trim();
  const fullName = document.getElementById("joinFullName").value.trim();

  const { error } = await supabase.rpc("join_organization", {
    p_org_number: orgNumber, p_invite_code: inviteCode, p_full_name: fullName,
  });
  if (error) return showAuthError(error.message);
  await loadSessionAndRoute();
}

async function onLogout() {
  await supabase.auth.signOut();
}

// ==================================================================
// VIEW MANAGEMENT
// ==================================================================

function showView(view) {
  document.getElementById("view-auth").classList.toggle("hidden", view !== "auth");
  document.getElementById("view-dashboard").classList.toggle("hidden", view !== "dashboard");
  document.getElementById("view-editor").classList.toggle("hidden", view !== "editor");
  document.getElementById("topbarUser").classList.toggle("hidden", view === "auth");
}

// ==================================================================
// DASHBOARD
// ==================================================================

async function goToDashboard() {
  showView("dashboard");
  document.getElementById("topbarUserName").textContent =
    currentProfile.full_name || currentUser.email;

  const orgFilterBar = document.getElementById("orgFilterBar");
  if (currentProfile.is_global_admin) {
    orgFilterBar.classList.remove("hidden");
    await populateOrgFilter();
  } else {
    orgFilterBar.classList.add("hidden");
    currentOrgFilter = null;
  }

  await loadCertificates();
}

async function populateOrgFilter() {
  const { data: orgs } = await supabase.from("organizations").select("id, name").order("name");
  const sel = document.getElementById("orgFilterSelect");
  sel.innerHTML = '<option value="">Alla firmor</option>' +
    (orgs || []).map(o => `<option value="${o.id}">${escapeHtml(o.name)}</option>`).join("");
}

async function loadCertificates() {
  let remote = [];
  if (navigator.onLine) {
    let query = supabase
      .from("certificates")
      .select("id, client_id, status, fastighetsbeteckning, kommun, installationsadress, anlaggningsdatum, updated_at, org_id")
      .order("updated_at", { ascending: false });
    if (currentOrgFilter) query = query.eq("org_id", currentOrgFilter);
    const { data, error } = await query;
    if (error) console.error(error);
    remote = data || [];
  }

  const pendingAll = await idbGetAll("pending_certificates").catch(() => []);
  const pending = pendingAll.filter(p => !currentOrgFilter || p.org_id === currentOrgFilter);
  const remoteClientIds = new Set(remote.map(r => r.client_id));
  const localOnly = pending
    .filter(p => !remoteClientIds.has(p.client_id))
    .map(p => ({
      id: null,
      client_id: p.client_id,
      status: p.status || "utkast",
      fastighetsbeteckning: p.fastighetsbeteckning,
      kommun: p.kommun,
      installationsadress: p.installationsadress,
      anlaggningsdatum: p.anlaggningsdatum,
      updated_at: p.updated_at || new Date().toISOString(),
      org_id: p.org_id,
      _pendingSync: true,
    }));

  const combined = [...localOnly, ...remote].sort(
    (a, b) => new Date(b.updated_at) - new Date(a.updated_at)
  );
  renderCertificateList(combined);
}

function renderCertificateList(list) {
  document.getElementById("certCount").textContent = `${list.length} intyg`;
  const container = document.getElementById("certList");
  if (!list.length) {
    container.innerHTML = '<div class="empty-state">Inga intyg ännu. Klicka på "Nytt intyg" för att börja.</div>';
    return;
  }
  container.innerHTML = list.map(c => {
    let pillClass = c.status === "klar" ? "klar" : "";
    let pillText = c.status === "klar" ? "Klar" : "Utkast";
    if (c._pendingSync) { pillClass = "pending"; pillText = "Väntar på synk"; }
    return `
      <div class="cert-card" data-id="${c.id || ""}" data-client-id="${c.client_id || ""}">
        <div class="row1">
          <div class="title">${escapeHtml(c.fastighetsbeteckning || "Namnlöst intyg")}</div>
          <span class="status-pill ${pillClass}">${pillText}</span>
        </div>
        <div class="meta">
          ${escapeHtml(c.installationsadress || "")}${c.installationsadress ? " · " : ""}${escapeHtml(c.kommun || "")}
          ${c.anlaggningsdatum ? " · " + c.anlaggningsdatum : ""}
        </div>
      </div>
    `;
  }).join("");

  container.querySelectorAll(".cert-card").forEach(card => {
    card.onclick = () => openEditor(card.dataset.id || null, card.dataset.clientId || null);
  });
}

// ==================================================================
// EDITOR
// ==================================================================

async function openEditor(id, clientId) {
  const form = document.getElementById("certForm");
  form.reset();
  clearSig();
  currentPhotos = [];
  currentPendingPhotos = [];
  document.getElementById("gpsMapLink").classList.add("hidden");
  document.getElementById("gpsStatus").textContent = "";

  if (id) {
    const { data, error } = await supabase.from("certificates").select("*").eq("id", id).single();
    if (error) { alert("Kunde inte hämta intyget: " + error.message); return; }
    currentCertificate = data;
    populateFormData(form, data.form_data || {});
    if (data.signature_data) drawSigFromDataUrl(data.signature_data);
    updateGpsStatus();
    document.getElementById("btnDeleteCertificate").classList.remove("hidden");

    const { data: photos } = await supabase
      .from("certificate_photos")
      .select("*")
      .eq("certificate_id", id);
    currentPhotos = photos || [];
  } else if (clientId) {
    // Ej synkat intyg, öppnas från lokal kö
    const pending = await idbGetAll("pending_certificates");
    const rec = pending.find(p => p.client_id === clientId);
    if (!rec) { alert("Hittade inte det lokalt sparade intyget."); return; }
    currentCertificate = { id: null, client_id: clientId, org_id: rec.org_id, form_data: rec.form_data, signature_data: rec.signature_data || null, status: rec.status || "utkast" };
    populateFormData(form, rec.form_data || {});
    if (rec.signature_data) drawSigFromDataUrl(rec.signature_data);
    updateGpsStatus();
    document.getElementById("btnDeleteCertificate").classList.remove("hidden");
  } else {
    currentCertificate = {
      id: null,
      client_id: generateUUID(),
      org_id: currentOrgFilter || currentProfile.org_id,
      form_data: {},
      signature_data: null,
      status: "utkast",
    };
    document.getElementById("btnDeleteCertificate").classList.add("hidden");
    captureGPS(true); // försök hämta position automatiskt för nya intyg
  }

  currentPendingPhotos = (await idbGetAll("pending_photos").catch(() => []))
    .filter(p => p.certificate_client_id === currentCertificate.client_id);

  renderPhotoThumbnails();
  showView("editor");
  window.scrollTo(0, 0);
}

function collectFormData(form) {
  const data = {};
  const seen = new Set();
  [...form.elements].forEach(el => {
    if (!el.name || seen.has(el.name)) return;
    if (el.type === "checkbox") {
      data[el.name] = el.checked;
    } else if (el.type === "radio") {
      const checked = form.querySelector(`input[name="${el.name}"]:checked`);
      data[el.name] = checked ? checked.value : null;
      seen.add(el.name);
    } else {
      data[el.name] = el.value;
    }
  });
  return data;
}

function populateFormData(form, data) {
  Object.entries(data).forEach(([name, value]) => {
    const els = form.querySelectorAll(`[name="${CSS.escape(name)}"]`);
    if (!els.length) return;
    els.forEach(el => {
      if (el.type === "checkbox") {
        el.checked = !!value;
      } else if (el.type === "radio") {
        el.checked = (el.value === value);
      } else {
        el.value = value ?? "";
      }
    });
  });
}

async function saveCertificate(markDone) {
  const form = document.getElementById("certForm");
  const formData = collectFormData(form);

  if (!currentCertificate.client_id) currentCertificate.client_id = generateUUID();

  const payload = {
    client_id: currentCertificate.client_id,
    org_id: currentCertificate.org_id,
    created_by: currentProfile.id,
    status: markDone ? "klar" : (currentCertificate.status || "utkast"),
    fastighetsbeteckning: formData.fastighetsbeteckning || null,
    kommun: formData.kommun || null,
    installationsadress: formData.adress1_linje1 || null,
    anlaggningsdatum: formData.anlaggningsdatum || null,
    gps_lat: formData.gps_lat ? parseFloat(formData.gps_lat) : null,
    gps_lng: formData.gps_lng ? parseFloat(formData.gps_lng) : null,
    gps_accuracy_m: formData.gps_accuracy_m ? parseFloat(formData.gps_accuracy_m) : null,
    form_data: formData,
    signature_data: sigDirty ? sigCanvas.toDataURL("image/png") : (currentCertificate.signature_data || null),
    updated_at: new Date().toISOString(),
  };

  if (navigator.onLine) {
    const { data, error } = await supabase
      .from("certificates")
      .upsert(payload, { onConflict: "client_id" })
      .select()
      .single();

    if (error) {
      await idbPut("pending_certificates", payload);
      alert("Kunde inte nå servern — intyget sparades lokalt på enheten och synkas automatiskt senare.");
      sigDirty = false;
      await updateSyncBadge();
      await goToDashboard();
      return;
    }

    currentCertificate = data;
    await idbDelete("pending_certificates", payload.client_id).catch(() => {});
    sigDirty = false;
    await updateSyncBadge();
    alert(markDone ? "Intyg markerat som klart och sparat." : "Sparat.");
    await goToDashboard();
    syncPending(); // synka ev. köade foton för detta intyg nu när det har ett server-id
  } else {
    await idbPut("pending_certificates", payload);
    currentCertificate = { ...currentCertificate, ...payload };
    sigDirty = false;
    await updateSyncBadge();
    alert("Ingen uppkoppling — intyget sparades lokalt på enheten och synkas automatiskt när du har internet igen.");
    await goToDashboard();
  }
}

async function saveDraftSilently() {
  const form = document.getElementById("certForm");
  const formData = collectFormData(form);
  if (!currentCertificate.client_id) currentCertificate.client_id = generateUUID();
  const payload = {
    client_id: currentCertificate.client_id,
    org_id: currentCertificate.org_id,
    created_by: currentProfile.id,
    fastighetsbeteckning: formData.fastighetsbeteckning || null,
    form_data: formData,
  };
  const { data, error } = await supabase
    .from("certificates")
    .upsert(payload, { onConflict: "client_id" })
    .select()
    .single();
  if (error) throw error;
  currentCertificate = data;
}

async function onDeleteCertificate() {
  if (!confirm("Ta bort detta intyg permanent? Detta går inte att ångra.")) return;

  if (currentCertificate.id) {
    const { error } = await supabase.from("certificates").delete().eq("id", currentCertificate.id);
    if (error) { alert("Kunde inte ta bort: " + error.message); return; }
  }
  if (currentCertificate.client_id) {
    await idbDelete("pending_certificates", currentCertificate.client_id).catch(() => {});
    const pendingPhotos = await idbGetAll("pending_photos").catch(() => []);
    await Promise.all(
      pendingPhotos
        .filter(p => p.certificate_client_id === currentCertificate.client_id)
        .map(p => idbDelete("pending_photos", p.client_id))
    );
  }
  await updateSyncBadge();
  await goToDashboard();
}

// ==================================================================
// GPS
// ==================================================================

function captureGPS(auto) {
  const statusEl = document.getElementById("gpsStatus");
  if (!navigator.geolocation) {
    if (!auto) alert("Denna enhet/webbläsare stödjer inte GPS.");
    return;
  }
  statusEl.textContent = "Hämtar position…";
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const form = document.getElementById("certForm");
      form.querySelector('[name="gps_lat"]').value = pos.coords.latitude.toFixed(6);
      form.querySelector('[name="gps_lng"]').value = pos.coords.longitude.toFixed(6);
      form.querySelector('[name="gps_accuracy_m"]').value = Math.round(pos.coords.accuracy);
      form.querySelector('[name="gps_captured_at"]').value = new Date().toISOString();
      updateGpsStatus();
    },
    (err) => {
      statusEl.textContent = auto
        ? "Automatisk position ej tillgänglig — hämta manuellt eller fyll i själv nedan."
        : "Kunde inte hämta position: " + err.message;
    },
    { enableHighAccuracy: true, timeout: 15000 }
  );
}

function updateGpsStatus() {
  const form = document.getElementById("certForm");
  const lat = form.querySelector('[name="gps_lat"]').value;
  const lng = form.querySelector('[name="gps_lng"]').value;
  const acc = form.querySelector('[name="gps_accuracy_m"]').value;
  const link = document.getElementById("gpsMapLink");
  const statusEl = document.getElementById("gpsStatus");
  if (lat && lng) {
    link.href = `https://www.google.com/maps?q=${lat},${lng}`;
    link.classList.remove("hidden");
    statusEl.textContent = `Position: ${lat}, ${lng}${acc ? " (±" + acc + " m)" : ""}`;
  } else {
    link.classList.add("hidden");
  }
}

// ==================================================================
// PHOTOS
// ==================================================================

function buildPhotoGrid() {
  const container = document.getElementById("photoCategories");
  container.innerHTML = PHOTO_CATEGORIES.map(group => `
    <div class="photo-subhead">${escapeHtml(group.group)}</div>
    <div class="photo-grid">
      ${group.items.map(item => `
        <div class="photo-card" data-key="${item.key}" id="photocard-${item.key}">
          <div class="cat-label">${escapeHtml(item.label)}</div>
          <div class="thumb-row" id="thumbs-${item.key}"></div>
          <label class="add-btn">
            + Lägg till foto
            <input type="file" accept="image/*" capture="environment" onchange="handlePhotoUpload('${item.key}', this)">
          </label>
        </div>
      `).join("")}
    </div>
  `).join("");
}

function renderPhotoThumbnails() {
  const byCategory = {};
  currentPhotos.forEach(p => { (byCategory[p.category_key] ||= []).push({ ...p, _pending: false }); });
  currentPendingPhotos.forEach(p => {
    (byCategory[p.category_key] ||= []).push({ ...p, _pending: true, _url: URL.createObjectURL(p.blob) });
  });

  PHOTO_CATEGORIES.forEach(group => group.items.forEach(item => {
    const el = document.getElementById(`thumbs-${item.key}`);
    const card = document.getElementById(`photocard-${item.key}`);
    if (!el) return;
    const photos = byCategory[item.key] || [];
    card.classList.toggle("has-photo", photos.length > 0);
    el.innerHTML = photos.map(p => `
      <span class="thumb-wrap">
        <img class="thumb" src="${p._pending ? p._url : photoPublicUrl(p.storage_path)}" alt="">
        ${p._pending ? '<span class="thumb-pending" title="Väntar på synk">⏳</span>' : ""}
        <button type="button" class="thumb-del" onclick="${p._pending ? `deletePendingPhoto('${p.client_id}')` : `deletePhoto('${p.id}')`}">×</button>
      </span>
    `).join("");
  }));
}

function photoPublicUrl(path) {
  const { data } = supabase.storage.from(PHOTO_BUCKET).getPublicUrl(path);
  return data.publicUrl;
}

async function handlePhotoUpload(categoryKey, inputEl) {
  const file = inputEl.files[0];
  if (!file) return;
  inputEl.value = "";

  const compressedBlob = await compressImage(file, 1600, 0.75);
  const photoClientId = generateUUID();

  if (navigator.onLine) {
    if (!currentCertificate.id) {
      try { await saveDraftSilently(); } catch (e) { /* faller igenom till kö nedan */ }
    }
    if (currentCertificate.id) {
      const ok = await uploadPhotoDirect(photoClientId, categoryKey, compressedBlob);
      if (ok) return;
    }
  }

  // Offline, intyget ej synkat, eller uppladdning misslyckades: köa lokalt
  await idbPut("pending_photos", {
    client_id: photoClientId,
    certificate_client_id: currentCertificate.client_id,
    org_id: currentCertificate.org_id,
    category_key: categoryKey,
    blob: compressedBlob,
    created_at: new Date().toISOString(),
  });
  currentPendingPhotos.push({
    client_id: photoClientId,
    certificate_client_id: currentCertificate.client_id,
    category_key: categoryKey,
    blob: compressedBlob,
  });
  renderPhotoThumbnails();
  await updateSyncBadge();
}

async function uploadPhotoDirect(photoClientId, categoryKey, blob) {
  try {
    const path = `${currentCertificate.org_id}/${currentCertificate.id}/${categoryKey}_${Date.now()}.jpg`;
    const { error: uploadError } = await supabase.storage.from(PHOTO_BUCKET).upload(path, blob, { contentType: "image/jpeg" });
    if (uploadError) throw uploadError;

    const { data: row, error: insertError } = await supabase
      .from("certificate_photos")
      .upsert({
        client_id: photoClientId,
        certificate_id: currentCertificate.id,
        org_id: currentCertificate.org_id,
        category_key: categoryKey,
        storage_path: path,
        uploaded_by: currentProfile.id,
      }, { onConflict: "client_id" })
      .select()
      .single();
    if (insertError) throw insertError;

    currentPhotos.push(row);
    renderPhotoThumbnails();
    return true;
  } catch (e) {
    console.warn("Direktuppladdning misslyckades, köar lokalt:", e.message);
    return false;
  }
}

async function deletePhoto(photoId) {
  const photo = currentPhotos.find(p => p.id === photoId);
  if (!photo) return;
  if (!confirm("Ta bort detta foto?")) return;

  await supabase.storage.from(PHOTO_BUCKET).remove([photo.storage_path]);
  const { error } = await supabase.from("certificate_photos").delete().eq("id", photoId);
  if (error) { alert("Kunde inte ta bort foto: " + error.message); return; }

  currentPhotos = currentPhotos.filter(p => p.id !== photoId);
  renderPhotoThumbnails();
}

async function deletePendingPhoto(clientId) {
  if (!confirm("Ta bort detta (ej synkade) foto?")) return;
  await idbDelete("pending_photos", clientId);
  currentPendingPhotos = currentPendingPhotos.filter(p => p.client_id !== clientId);
  renderPhotoThumbnails();
  await updateSyncBadge();
}

function compressImage(file, maxDim, quality) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const reader = new FileReader();
    reader.onload = (e) => { img.src = e.target.result; };
    reader.onerror = reject;
    img.onload = () => {
      let { width, height } = img;
      if (width > height && width > maxDim) { height *= maxDim / width; width = maxDim; }
      else if (height > maxDim) { width *= maxDim / height; height = maxDim; }
      const canvas = document.createElement("canvas");
      canvas.width = width; canvas.height = height;
      canvas.getContext("2d").drawImage(img, 0, 0, width, height);
      canvas.toBlob(blob => resolve(blob), "image/jpeg", quality);
    };
    img.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// ==================================================================
// OFFLINE-KÖ (IndexedDB) + SYNK
// ==================================================================

const OFFLINE_DB_NAME = "installationsintyg-offline";
const OFFLINE_DB_VERSION = 1;

function openOfflineDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(OFFLINE_DB_NAME, OFFLINE_DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains("pending_certificates")) {
        db.createObjectStore("pending_certificates", { keyPath: "client_id" });
      }
      if (!db.objectStoreNames.contains("pending_photos")) {
        db.createObjectStore("pending_photos", { keyPath: "client_id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function idbGetAll(storeName) {
  return openOfflineDB().then(db => new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readonly");
    const req = tx.objectStore(storeName).getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  }));
}

function idbPut(storeName, value) {
  return openOfflineDB().then(db => new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readwrite");
    tx.objectStore(storeName).put(value);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  }));
}

function idbDelete(storeName, key) {
  return openOfflineDB().then(db => new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readwrite");
    tx.objectStore(storeName).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  }));
}

async function syncPending() {
  if (!navigator.onLine || !currentProfile) return;
  const btn = document.getElementById("btnSyncNow");
  if (btn) btn.disabled = true;

  try {
    // 1. Synka köade intyg
    const pendingCerts = await idbGetAll("pending_certificates");
    for (const cert of pendingCerts) {
      try {
        const { data, error } = await supabase
          .from("certificates")
          .upsert(cert, { onConflict: "client_id" })
          .select()
          .single();
        if (error) throw error;
        await idbDelete("pending_certificates", cert.client_id);
        if (currentCertificate && currentCertificate.client_id === cert.client_id) {
          currentCertificate = data;
        }
      } catch (e) {
        console.warn("Kunde inte synka intyg", cert.client_id, e.message);
      }
    }

    // 2. Synka köade foton (kräver att intyget redan har ett server-id)
    const pendingPhotos = await idbGetAll("pending_photos");
    for (const photo of pendingPhotos) {
      try {
        const { data: certRow, error: certErr } = await supabase
          .from("certificates")
          .select("id, org_id")
          .eq("client_id", photo.certificate_client_id)
          .maybeSingle();
        if (certErr || !certRow) continue; // intyget inte synkat ännu, försök igen senare

        const path = `${certRow.org_id}/${certRow.id}/${photo.category_key}_${Date.now()}.jpg`;
        const { error: uploadError } = await supabase.storage
          .from(PHOTO_BUCKET)
          .upload(path, photo.blob, { contentType: "image/jpeg" });
        if (uploadError) throw uploadError;

        const { error: insertError } = await supabase.from("certificate_photos").upsert({
          client_id: photo.client_id,
          certificate_id: certRow.id,
          org_id: certRow.org_id,
          category_key: photo.category_key,
          storage_path: path,
          uploaded_by: currentProfile.id,
        }, { onConflict: "client_id" });
        if (insertError) throw insertError;

        await idbDelete("pending_photos", photo.client_id);
      } catch (e) {
        console.warn("Kunde inte synka foto", photo.client_id, e.message);
      }
    }
  } finally {
    if (btn) btn.disabled = false;
    await updateSyncBadge();

    if (!document.getElementById("view-dashboard").classList.contains("hidden")) {
      await loadCertificates();
    }
    if (!document.getElementById("view-editor").classList.contains("hidden") && currentCertificate) {
      const { data: freshPhotos } = currentCertificate.id
        ? await supabase.from("certificate_photos").select("*").eq("certificate_id", currentCertificate.id)
        : { data: currentPhotos };
      currentPhotos = freshPhotos || currentPhotos;
      currentPendingPhotos = (await idbGetAll("pending_photos").catch(() => []))
        .filter(p => p.certificate_client_id === currentCertificate.client_id);
      renderPhotoThumbnails();
    }
  }
}

async function updateSyncBadge() {
  const certs = await idbGetAll("pending_certificates").catch(() => []);
  const photos = await idbGetAll("pending_photos").catch(() => []);
  const count = certs.length + photos.length;

  const dot = document.getElementById("netStatusDot");
  if (dot) {
    dot.classList.toggle("online", navigator.onLine);
    dot.classList.toggle("offline", !navigator.onLine);
    dot.title = navigator.onLine ? "Online" : "Offline";
  }

  const badge = document.getElementById("syncBadge");
  if (badge) {
    if (count > 0) {
      badge.textContent = `${count} väntar på synk`;
      badge.classList.remove("hidden");
    } else {
      badge.classList.add("hidden");
    }
  }
}

// ==================================================================
// SIGNATURE PAD
// ==================================================================

let sigCanvas, sigCtx, sigDrawing = false;

function wireSignaturePad() {
  sigCanvas = document.getElementById("sigCanvas");
  sigCtx = sigCanvas.getContext("2d");
  const hint = document.querySelector(".sig-hint");

  function resize() {
    const rect = sigCanvas.parentElement.getBoundingClientRect();
    sigCanvas.width = rect.width;
    sigCanvas.height = rect.height;
  }
  resize();
  window.addEventListener("resize", resize);

  function pos(e) {
    const rect = sigCanvas.getBoundingClientRect();
    if (e.touches) return { x: e.touches[0].clientX - rect.left, y: e.touches[0].clientY - rect.top };
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }
  function start(e) {
    sigDrawing = true; sigDirty = true;
    sigCtx.beginPath();
    const p = pos(e); sigCtx.moveTo(p.x, p.y);
    hint.style.display = "none";
  }
  function move(e) {
    if (!sigDrawing) return;
    const p = pos(e);
    sigCtx.lineTo(p.x, p.y);
    sigCtx.strokeStyle = "#00e5c0"; sigCtx.lineWidth = 2; sigCtx.lineCap = "round";
    sigCtx.stroke();
  }
  function end() { sigDrawing = false; }

  sigCanvas.addEventListener("mousedown", start);
  sigCanvas.addEventListener("mousemove", move);
  sigCanvas.addEventListener("mouseup", end);
  sigCanvas.addEventListener("mouseleave", end);
  sigCanvas.addEventListener("touchstart", e => { e.preventDefault(); start(e); }, { passive: false });
  sigCanvas.addEventListener("touchmove", e => { e.preventDefault(); move(e); }, { passive: false });
  sigCanvas.addEventListener("touchend", end);

  document.querySelector(".sig-reset").onclick = clearSig;
}

function clearSig() {
  if (sigCtx) sigCtx.clearRect(0, 0, sigCanvas.width, sigCanvas.height);
  const hint = document.querySelector(".sig-hint");
  if (hint) hint.style.display = "";
  sigDirty = false;
}

function drawSigFromDataUrl(dataUrl) {
  const img = new Image();
  img.onload = () => sigCtx.drawImage(img, 0, 0, sigCanvas.width, sigCanvas.height);
  img.src = dataUrl;
  document.querySelector(".sig-hint").style.display = "none";
}

// ==================================================================
// UTIL
// ==================================================================

function generateUUID() {
  if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function escapeHtml(str) {
  return String(str ?? "").replace(/[&<>"']/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}
