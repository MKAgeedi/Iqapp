/* ============================================================
   إعدادات المستودع — عدّل هذه القيم الثلاث فقط لتطابق مستودعك
   ============================================================ */
const CONFIG = {
  owner: 'MKAgeedi',                // اسم المستخدم/المنظمة على GitHub
  repo: 'Iqapp',                    // اسم المستودع
  branch: 'main',                  // اسم الفرع الرئيسي (main أو master)
  dataPath: 'apps.json',           // اسم ملف البيانات (لا تغيّره إلا إذا غيّرت اسم الملف فعليًا)
  unlockWord: 'baghdad'            // الكلمة السريعة لفتح وضع الإدارة على هذا الجهاز بعد الإعداد الأول
};
/* ============================================================ */

const LOCAL_TOKEN_KEY = 'app-store-admin-token';

let DATA = { apps: {} };
let isAdmin = false;
let adminToken = null;   // يبقى في الذاكرة أثناء الجلسة فقط
let activeCategory = 'الكل';
let currentAppId = null;

const el = (id) => document.getElementById(id);
const contentEl = el('content');

function showToast(msg){
  const t = el('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(()=>t.classList.remove('show'), 2600);
}

function openOverlay(id){ el(id).classList.add('show'); }
function closeOverlay(id){ el(id).classList.remove('show'); }
document.querySelectorAll('[data-close]').forEach(b=>{
  b.addEventListener('click', ()=>closeOverlay(b.dataset.close));
});
document.querySelectorAll('.overlay').forEach(o=>{
  o.addEventListener('click', (e)=>{ if(e.target===o) o.classList.remove('show'); });
});

function slugify(name){
  return 'app_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2,7);
}

function fmtDate(iso){
  try{
    const d = new Date(iso);
    return d.toLocaleDateString('ar-EG', {year:'numeric', month:'short', day:'numeric'});
  }catch(e){ return ''; }
}

function iconHTML(icon){
  if(icon && /^https?:\/\//.test(icon.trim())){
    return `<img src="${icon.trim()}" alt="" onerror="this.parentElement.textContent='📦'">`;
  }
  return icon && icon.trim() ? icon.trim() : '📦';
}

function escapeHTML(s){
  return (s||'').replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
}

function b64EncodeUnicode(str){
  return btoa(unescape(encodeURIComponent(str)));
}
function b64DecodeUnicode(str){
  return decodeURIComponent(escape(atob(str)));
}

/* ============================================================
   القراءة العامة: يقرأ apps.json مباشرة من نفس الموقع (بدون توكن)
   ============================================================ */
async function loadData(){
  try{
    const res = await fetch(`./${CONFIG.dataPath}?t=${Date.now()}`, {cache:'no-store'});
    if(!res.ok) throw new Error('not found');
    const json = await res.json();
    DATA = json && json.apps ? json : { apps: {} };
  }catch(e){
    DATA = { apps: {} };
  }
  render();
}

/* ============================================================
   الكتابة (للمشرف فقط): عبر GitHub Contents API باستخدام التوكن
   ============================================================ */
async function githubGetFile(){
  const url = `https://api.github.com/repos/${CONFIG.owner}/${CONFIG.repo}/contents/${CONFIG.dataPath}?ref=${CONFIG.branch}`;
  const res = await fetch(url, {
    headers: {
      'Authorization': `token ${adminToken}`,
      'Accept': 'application/vnd.github+json'
    }
  });
  if(!res.ok){
    throw new Error(res.status === 404 ? 'ملف apps.json غير موجود في المستودع' : 'تعذّر الاتصال بالمستودع — تحقق من الرمز والصلاحيات');
  }
  return res.json();
}

async function githubPutFile(newDataObj, sha, message){
  const url = `https://api.github.com/repos/${CONFIG.owner}/${CONFIG.repo}/contents/${CONFIG.dataPath}`;
  const body = {
    message,
    content: b64EncodeUnicode(JSON.stringify(newDataObj, null, 2)),
    sha,
    branch: CONFIG.branch
  };
  const res = await fetch(url, {
    method: 'PUT',
    headers: {
      'Authorization': `token ${adminToken}`,
      'Accept': 'application/vnd.github+json',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });
  if(!res.ok){
    const errBody = await res.json().catch(()=>({}));
    throw new Error(errBody.message || 'فشل حفظ التغييرات على GitHub');
  }
  return res.json();
}

async function commitData(newDataObj, message){
  const file = await githubGetFile();
  await githubPutFile(newDataObj, file.sha, message);
  DATA = newDataObj;
}

/* ============================================================
   وضع الإدارة — كلمة سريعة "baghdad" + رمز GitHub محفوظ على هذا الجهاز فقط
   ============================================================ */
async function handleAdminToggle(){
  if(isAdmin){
    logoutAdmin();
    return;
  }

  const word = prompt('أدخل كلمة المرور:');
  if(word === null) return;
  if(word.trim().toLowerCase() !== CONFIG.unlockWord.toLowerCase()){
    showToast('كلمة المرور غير صحيحة');
    return;
  }

  const savedToken = localStorage.getItem(LOCAL_TOKEN_KEY);
  if(savedToken){
    adminToken = savedToken;
    showToast('جاري التحقق...');
    try{
      await githubGetFile();
      isAdmin = true;
      updateAdminUI();
      showToast('تم تفعيل وضع الإدارة');
    }catch(e){
      localStorage.removeItem(LOCAL_TOKEN_KEY);
      adminToken = null;
      showToast('انتهت صلاحية الرمز المحفوظ، الرجاء إدخاله من جديد');
      await setupTokenFirstTime();
    }
    return;
  }

  await setupTokenFirstTime();
}

async function setupTokenFirstTime(){
  const token = prompt(
    'هذا أول استخدام على هذا الجهاز.\n' +
    'الصق رمز الوصول الشخصي (Personal Access Token) الخاص بمستودعك على GitHub (صلاحية Contents: Read and write).\n' +
    'سيتم حفظه على هذا الجهاز فقط، وبعدها تكفي كلمة "' + CONFIG.unlockWord + '" في كل مرة.'
  );
  if(!token) return;
  adminToken = token.trim();
  showToast('جاري التحقق من الرمز...');
  try{
    await githubGetFile();
    localStorage.setItem(LOCAL_TOKEN_KEY, adminToken);
    isAdmin = true;
    updateAdminUI();
    showToast('تم حفظ الرمز على هذا الجهاز وتفعيل وضع الإدارة');
  }catch(e){
    adminToken = null;
    showToast(e.message || 'رمز غير صالح أو لا يملك صلاحية الوصول');
  }
}

function logoutAdmin(){
  isAdmin = false;
  adminToken = null;
  updateAdminUI();
  showToast('تم الخروج من وضع الإدارة');
}

function forgetSavedToken(){
  if(!confirm('سيتم حذف الرمز المحفوظ على هذا الجهاز، وستحتاج لإدخاله من جديد في المرة القادمة. متابعة؟')) return;
  localStorage.removeItem(LOCAL_TOKEN_KEY);
  logoutAdmin();
  showToast('تم حذف الرمز المحفوظ على هذا الجهاز');
}

function updateAdminUI(){
  el('admin-header-actions').style.display = isAdmin ? 'flex' : 'none';
  el('admin-footer').style.display = isAdmin ? 'inline' : 'none';
  const toggle = el('btn-admin-toggle');
  toggle.textContent = isAdmin ? '🔓' : '🔑';
  toggle.title = isAdmin ? 'الخروج من وضع الإدارة' : 'دخول وضع الإدارة';
  render();
}

/* ---------------- render ---------------- */
function allApps(){
  return Object.values(DATA.apps).sort((a,b)=> (b.createdAt||0) - (a.createdAt||0));
}
function latestVersion(app){
  return app.versions && app.versions.length ? app.versions[0] : null;
}

function renderCategories(){
  const cats = ['الكل', ...new Set(allApps().map(a=>a.category || 'أخرى'))];
  el('cat-row').innerHTML = cats.map(c=>
    `<div class="chip ${c===activeCategory?'active':''}" data-cat="${c}">${c}</div>`
  ).join('');
  el('cat-row').querySelectorAll('.chip').forEach(chip=>{
    chip.addEventListener('click', ()=>{
      activeCategory = chip.dataset.cat;
      render();
    });
  });
}

function render(){
  renderCategories();
  const apps = allApps();
  el('app-count-label').textContent = apps.length ? `${apps.length} تطبيق متوفر` : 'لا توجد تطبيقات بعد';

  const q = (el('search-input').value || '').trim().toLowerCase();
  let filtered = apps.filter(a=>{
    const matchCat = activeCategory==='الكل' || (a.category||'أخرى')===activeCategory;
    const matchQ = !q || a.name.toLowerCase().includes(q);
    return matchCat && matchQ;
  });

  if(apps.length === 0){
    contentEl.innerHTML = `
      <div class="empty">
        <div class="big">📭</div>
        <h2>لا توجد تطبيقات بعد</h2>
        <p>${isAdmin ? 'ابدأ بإضافة أول تطبيق إلى المتجر.' : 'سيتم إضافة التطبيقات قريبًا من قبل المشرف.'}</p>
        ${isAdmin ? '<button class="btn btn-primary" onclick="document.getElementById(\'btn-add\').click()">+ إضافة تطبيق</button>' : ''}
      </div>`;
    return;
  }

  if(filtered.length === 0){
    contentEl.innerHTML = `<div class="empty"><div class="big">🔍</div><h2>لا توجد نتائج</h2><p>جرّب كلمة بحث أو فئة مختلفة.</p></div>`;
    return;
  }

  contentEl.innerHTML = `
    <div class="section-title">${activeCategory==='الكل' ? 'جميع التطبيقات' : activeCategory}</div>
    <div class="grid">
      ${filtered.map(a=>{
        const lv = latestVersion(a);
        return `
        <div class="card" data-id="${a.id}">
          <div class="icon-box">${iconHTML(a.icon)}</div>
          <h3>${escapeHTML(a.name)}</h3>
          <div class="meta-line"><span class="badge">v${lv ? escapeHTML(lv.version) : '—'}</span></div>
          <div class="meta-line">${escapeHTML(a.category||'أخرى')}${lv && lv.size ? ' · ' + escapeHTML(lv.size) : ''}</div>
        </div>`;
      }).join('')}
    </div>
  `;
  contentEl.querySelectorAll('.card').forEach(c=>{
    c.addEventListener('click', ()=> openDetail(c.dataset.id));
  });
}

function openDetail(id){
  const app = DATA.apps[id];
  if(!app) return;
  currentAppId = id;
  const lv = latestVersion(app);
  el('detail-body').innerHTML = `
    <div class="detail-top">
      <div class="icon-box">${iconHTML(app.icon)}</div>
      <div>
        <h2>${escapeHTML(app.name)}</h2>
        <div class="meta-line">${escapeHTML(app.category||'أخرى')}</div>
      </div>
    </div>
    ${app.description ? `<p class="detail-desc">${escapeHTML(app.description)}</p>` : ''}
    <div class="stat-row">
      <div class="stat"><b>${app.versions.length}</b><span>عدد الإصدارات</span></div>
      <div class="stat"><b>v${lv?escapeHTML(lv.version):'—'}</b><span>الإصدار الحالي</span></div>
      <div class="stat"><b>${lv&&lv.size?escapeHTML(lv.size):'—'}</b><span>الحجم</span></div>
    </div>
    <div class="detail-actions">
      <a class="btn btn-primary" href="${lv?lv.link:'#'}" target="_blank" rel="noopener">⬇️ تنزيل أحدث إصدار</a>
      ${isAdmin ? '<button class="btn btn-teal" id="btn-open-update">🔄 نشر تحديث</button>' : ''}
    </div>
    <div class="vh-title">📜 سجل الإصدارات (تنزيل نسخة سابقة)</div>
    ${app.versions.map((v,i)=>`
      <div class="version-item ${i===0?'latest':''}">
        <div class="v-num">v${escapeHTML(v.version)}</div>
        <div class="v-info">
          <div class="v-top">${i===0?'الإصدار الحالي':'إصدار سابق'} ${v.size?'· '+escapeHTML(v.size):''}</div>
          ${v.notes?`<div class="v-notes">${escapeHTML(v.notes)}</div>`:''}
          <div class="v-date">${fmtDate(v.date)}</div>
        </div>
        <a class="btn btn-ghost btn-sm" href="${v.link}" target="_blank" rel="noopener">تنزيل</a>
      </div>
    `).join('')}
  `;
  const updateBtn = document.getElementById('btn-open-update');
  if(updateBtn){
    updateBtn.addEventListener('click', ()=>{
      closeOverlay('overlay-detail');
      openUpdateForm(id);
    });
  }
  openOverlay('overlay-detail');
}

el('btn-admin-toggle').addEventListener('click', handleAdminToggle);

/* ---------------- add app ---------------- */
el('btn-add').addEventListener('click', ()=> openOverlay('overlay-add'));

el('form-add').addEventListener('submit', async (e)=>{
  e.preventDefault();
  if(!isAdmin){ showToast('وضع الإدارة غير مفعّل'); return; }
  const name = el('add-name').value.trim();
  const version = el('add-version').value.trim();
  const link = el('add-link').value.trim();
  if(!name || !version || !link) return;

  const submitBtn = e.target.querySelector('button[type=submit]');
  submitBtn.disabled = true; submitBtn.textContent = 'جاري الحفظ على GitHub...';

  const id = slugify(name);
  const newData = JSON.parse(JSON.stringify(DATA));
  newData.apps[id] = {
    id, name,
    icon: el('add-icon').value.trim(),
    category: el('add-category').value,
    description: el('add-desc').value.trim(),
    createdAt: Date.now(),
    versions: [{
      version, link,
      size: el('add-size').value.trim(),
      notes: 'الإصدار الأول',
      date: new Date().toISOString()
    }]
  };

  try{
    await commitData(newData, `إضافة تطبيق: ${name}`);
    showToast('تمت إضافة التطبيق ونشره على GitHub');
    e.target.reset();
    closeOverlay('overlay-add');
    render();
  }catch(err){
    showToast(err.message || 'فشل الحفظ');
  }finally{
    submitBtn.disabled = false; submitBtn.textContent = 'حفظ التطبيق';
  }
});

/* ---------------- update flow ---------------- */
el('btn-update').addEventListener('click', ()=>{
  const apps = allApps();
  if(apps.length === 0){
    showToast('لا توجد تطبيقات لتحديثها بعد');
    return;
  }
  el('choose-body').innerHTML = apps.map(a=>{
    const lv = latestVersion(a);
    return `
    <div class="app-pick" data-id="${a.id}">
      <div class="icon-box">${iconHTML(a.icon)}</div>
      <div>
        <div class="p-name">${escapeHTML(a.name)}</div>
        <div class="p-sub">الإصدار الحالي: v${lv?escapeHTML(lv.version):'—'}</div>
      </div>
    </div>`;
  }).join('');
  el('choose-body').querySelectorAll('.app-pick').forEach(p=>{
    p.addEventListener('click', ()=>{
      closeOverlay('overlay-choose');
      openUpdateForm(p.dataset.id);
    });
  });
  openOverlay('overlay-choose');
});

function openUpdateForm(id){
  const app = DATA.apps[id];
  if(!app) return;
  currentAppId = id;
  el('update-title').textContent = `تحديث: ${app.name}`;
  el('form-update').reset();
  openOverlay('overlay-update');
}

el('form-update').addEventListener('submit', async (e)=>{
  e.preventDefault();
  if(!isAdmin){ showToast('وضع الإدارة غير مفعّل'); return; }
  const app = DATA.apps[currentAppId];
  if(!app) return;
  const version = el('up-version').value.trim();
  const link = el('up-link').value.trim();
  if(!version || !link) return;

  const submitBtn = e.target.querySelector('button[type=submit]');
  submitBtn.disabled = true; submitBtn.textContent = 'جاري النشر على GitHub...';

  const newData = JSON.parse(JSON.stringify(DATA));
  newData.apps[currentAppId].versions.unshift({
    version, link,
    size: el('up-size').value.trim(),
    notes: el('up-notes').value.trim(),
    date: new Date().toISOString()
  });

  try{
    await commitData(newData, `تحديث ${app.name} إلى v${version}`);
    showToast('تم نشر التحديث على GitHub');
    closeOverlay('overlay-update');
    render();
  }catch(err){
    showToast(err.message || 'فشل نشر التحديث');
  }finally{
    submitBtn.disabled = false; submitBtn.textContent = 'نشر التحديث';
  }
});

/* ---------------- search ---------------- */
el('search-input').addEventListener('input', render);

/* ---------------- reset ---------------- */
el('btn-reset').addEventListener('click', async ()=>{
  if(!isAdmin){ showToast('وضع الإدارة غير مفعّل'); return; }
  if(!confirm('سيتم حذف جميع التطبيقات والإصدارات من المستودع على GitHub. هل أنت متأكد؟')) return;
  try{
    await commitData({ apps: {} }, 'مسح جميع بيانات المتجر');
    showToast('تم مسح البيانات');
    render();
  }catch(err){
    showToast(err.message || 'فشل المسح');
  }
});

el('btn-logout').addEventListener('click', logoutAdmin);
const forgetBtn = document.getElementById('btn-forget-token');
if(forgetBtn) forgetBtn.addEventListener('click', forgetSavedToken);

/* ---------------- init ---------------- */
loadData();
