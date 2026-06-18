// ============================================================
// FX JOURNAL — MAIN APPLICATION LOGIC
// ============================================================
let trades = [];
let currentUser = null;
let editingId = null;
let currentFilter = 'all';
let currentSort = { col: 'trade_date', dir: -1 };
let currentPage = 1;
const PER_PAGE = 10;

let equityChartInst=null, pairChartInst=null, monthlyChartInst=null;
let pairPnlInst=null, setupInst=null, dowInst=null;

Chart.defaults.color = '#8b8f99';
Chart.defaults.borderColor = 'rgba(255,255,255,0.06)';
Chart.defaults.font.family = "'Inter', sans-serif";

// ============================================================
// AUTH GUARD — must run before anything else
// ============================================================
(async function initAuth() {
  const { data, error } = await supabaseClient.auth.getSession();

  if (error || !data.session) {
    window.location.href = 'login.html';
    return;
  }

  currentUser = data.session.user;
  setupUserUI();

  await loadTrades();

  document.getElementById('appLoading').style.display = 'none';
  document.getElementById('appRoot').style.display = '';

  renderDashboard();
  renderTable();

  // Listen for auth changes (e.g. token expiry, logout from another tab)
  supabaseClient.auth.onAuthStateChange((event) => {
    if (event === 'SIGNED_OUT') window.location.href = 'login.html';
  });
})();

function setupUserUI() {
  const meta = currentUser.user_metadata || {};
  const name = meta.full_name || meta.name || currentUser.email.split('@')[0];
  const avatarUrl = meta.avatar_url || meta.picture;

  document.getElementById('userName').textContent = name;
  document.getElementById('userEmail').textContent = currentUser.email;
  if (avatarUrl) {
    document.getElementById('userAvatar').innerHTML = `<img src="${avatarUrl}" alt="${name}">`;
  }
}

async function logout() {
  if (!confirm('Yakin ingin keluar?')) return;
  await supabaseClient.auth.signOut();
  window.location.href = 'login.html';
}

// ============================================================
// DATA LOADING (from Supabase)
// ============================================================
async function loadTrades() {
  const { data, error } = await supabaseClient
    .from('trades')
    .select('*')
    .order('trade_date', { ascending: false });

  if (error) {
    console.error(error);
    showToast('⚠️', 'Gagal memuat data: ' + error.message, 'error');
    trades = [];
    return;
  }
  trades = data || [];
}

// ============================================================
// NAVIGATION
// ============================================================
function showPage(name) {
  ['dashboard','journal','statistics'].forEach(p => {
    document.getElementById('page-'+p).style.display = p===name ? '' : 'none';
  });
  document.querySelectorAll('.nav-item[data-page]').forEach(el => {
    el.classList.toggle('active', el.dataset.page === name);
  });
  const titles = { dashboard:'Dashboard', journal:'Trade Journal', statistics:'Statistics' };
  const subs   = { dashboard:'Pantau performa trading Anda secara real-time.', journal:'Semua riwayat dan catatan trade Anda.', statistics:'Analisa mendalam kinerja trading Anda.' };
  document.getElementById('pageTitle').textContent = titles[name];
  document.getElementById('pageSubtitle').textContent = subs[name];
  closeSidebar();
  if (name==='dashboard')  renderDashboard();
  if (name==='journal')    renderTable();
  if (name==='statistics') renderStatistics();
}

function toggleSidebar() {
  document.getElementById('sidebar').classList.toggle('open');
  document.getElementById('dimOverlay').classList.toggle('open');
}
function closeSidebar() {
  document.getElementById('sidebar').classList.remove('open');
  document.getElementById('dimOverlay').classList.remove('open');
}

// ============================================================
// MODAL — ADD / EDIT TRADE
// ============================================================
function openModal(id=null) {
  editingId = id;
  clearFormErrors();
  const overlay = document.getElementById('modalOverlay');
  document.getElementById('modalTitle').textContent = id ? '✏️ Edit Trade' : '➕ Add New Trade';

  if (id) {
    const t = trades.find(x=>x.id===id);
    if (!t) return;
    document.getElementById('f-date').value   = toLocalDatetimeInput(t.trade_date);
    setPairSelect(t.pair);
    document.getElementById('f-type').value   = t.type;
    document.getElementById('f-lot').value    = t.lot ?? '';
    document.getElementById('f-entry').value  = t.entry_price ?? '';
    document.getElementById('f-exit').value   = t.exit_price ?? '';
    document.getElementById('f-sl').value     = t.stop_loss ?? '';
    document.getElementById('f-tp').value     = t.take_profit ?? '';
    document.getElementById('f-pnl').value    = t.pnl ?? '';
    document.getElementById('f-result').value = t.result;
    document.getElementById('f-setup').value  = t.setup || '';
    document.getElementById('f-notes').value  = t.notes || '';
    calcRR();
  } else {
    document.getElementById('f-date').value = toLocalDatetimeInput(new Date().toISOString());
    ['f-pair','f-type','f-lot','f-entry','f-exit','f-sl','f-tp','f-pnl','f-result','f-setup','f-notes','f-pair-custom'].forEach(id=>{
      const el=document.getElementById(id);
      if(el.tagName==='SELECT') el.selectedIndex=0; else el.value='';
    });
    document.getElementById('f-rr').value='';
    document.getElementById('customPairGroup').style.display='none';
  }
  overlay.classList.add('open');
}

function setPairSelect(pairValue) {
  const select = document.getElementById('f-pair');
  const exists = Array.from(select.options).some(o => o.value === pairValue);
  if (exists) {
    select.value = pairValue;
    document.getElementById('customPairGroup').style.display = 'none';
  } else {
    select.value = 'custom';
    document.getElementById('customPairGroup').style.display = '';
    document.getElementById('f-pair-custom').value = pairValue;
  }
}

function toggleCustomPair() {
  const show = document.getElementById('f-pair').value === 'custom';
  document.getElementById('customPairGroup').style.display = show ? '' : 'none';
}

function closeModal() {
  document.getElementById('modalOverlay').classList.remove('open');
  editingId = null;
}
document.getElementById('modalOverlay').addEventListener('click', e => {
  if (e.target === document.getElementById('modalOverlay')) closeModal();
});

// Auto-calculate R:R whenever entry/sl/tp changes
['f-entry','f-sl','f-tp'].forEach(id => {
  document.getElementById(id).addEventListener('input', calcRR);
});
function calcRR() {
  const entry = parseFloat(document.getElementById('f-entry').value);
  const sl    = parseFloat(document.getElementById('f-sl').value);
  const tp    = parseFloat(document.getElementById('f-tp').value);
  const rrField = document.getElementById('f-rr');
  if (!entry || !sl || !tp || entry===sl) { rrField.value=''; return; }
  const risk   = Math.abs(entry - sl);
  const reward = Math.abs(tp - entry);
  rrField.value = '1:' + (reward/risk).toFixed(2);
}

// ============================================================
// FORM VALIDATION
// ============================================================
function clearFormErrors() {
  document.querySelectorAll('.form-group').forEach(g => g.classList.remove('invalid'));
}
function markInvalid(fieldId) {
  document.getElementById(fieldId).closest('.form-group').classList.add('invalid');
}

function validateForm(pair) {
  clearFormErrors();
  let valid = true;
  if (!document.getElementById('f-date').value) { markInvalid('f-date'); valid = false; }
  if (!pair) { markInvalid('f-pair'); valid = false; }
  if (document.getElementById('f-pnl').value === '') { markInvalid('f-pnl'); valid = false; }
  return valid;
}

// ============================================================
// SAVE TRADE (insert or update in Supabase)
// ============================================================
async function saveTrade() {
  let pair = document.getElementById('f-pair').value;
  if (pair === 'custom') pair = document.getElementById('f-pair-custom').value.trim().toUpperCase();

  if (!validateForm(pair)) {
    showToast('⚠️', 'Lengkapi field yang wajib diisi (bertanda *)', 'warn');
    return;
  }

  const saveBtn = document.getElementById('saveBtn');
  saveBtn.disabled = true;
  saveBtn.textContent = '⏳ Menyimpan...';

  const payload = {
    user_id:      currentUser.id,
    trade_date:   new Date(document.getElementById('f-date').value).toISOString(),
    pair,
    type:         document.getElementById('f-type').value,
    lot:          parseFloat(document.getElementById('f-lot').value)   || 0,
    entry_price:  parseFloat(document.getElementById('f-entry').value) || null,
    exit_price:   parseFloat(document.getElementById('f-exit').value)  || null,
    stop_loss:    parseFloat(document.getElementById('f-sl').value)    || null,
    take_profit:  parseFloat(document.getElementById('f-tp').value)    || null,
    pnl:          parseFloat(document.getElementById('f-pnl').value)   || 0,
    result:       document.getElementById('f-result').value,
    setup:        document.getElementById('f-setup').value || null,
    notes:        document.getElementById('f-notes').value.trim() || null,
  };

  let result;
  if (editingId) {
    result = await supabaseClient.from('trades').update(payload).eq('id', editingId).select();
  } else {
    result = await supabaseClient.from('trades').insert(payload).select();
  }

  saveBtn.disabled = false;
  saveBtn.textContent = '💾 Simpan Trade';

  if (result.error) {
    console.error(result.error);
    showToast('⚠️', 'Gagal menyimpan: ' + result.error.message, 'error');
    return;
  }

  showToast('✅', editingId ? 'Trade berhasil diperbarui!' : 'Trade berhasil ditambahkan!', 'success');
  closeModal();
  await loadTrades();
  renderDashboard();
  renderTable();
}

async function deleteTrade(id) {
  if (!confirm('Hapus trade ini? Tindakan ini tidak bisa dibatalkan.')) return;

  const { error } = await supabaseClient.from('trades').delete().eq('id', id);
  if (error) {
    showToast('⚠️', 'Gagal menghapus: ' + error.message, 'error');
    return;
  }
  showToast('🗑️', 'Trade dihapus.', 'info');
  await loadTrades();
  renderDashboard();
  renderTable();
}

// ============================================================
// DASHBOARD RENDERING
// ============================================================
function renderDashboard() {
  const sorted = [...trades].sort((a,b) => new Date(a.trade_date)-new Date(b.trade_date));
  const totalPnl = trades.reduce((s,t)=>s+Number(t.pnl), 0);
  const wins   = trades.filter(t=>t.result==='win').length;
  const losses = trades.filter(t=>t.result==='loss').length;
  const wr     = trades.length ? (wins/trades.length*100).toFixed(1) : 0;
  const gross_profit = trades.filter(t=>t.pnl>0).reduce((s,t)=>s+Number(t.pnl),0);
  const gross_loss   = Math.abs(trades.filter(t=>t.pnl<0).reduce((s,t)=>s+Number(t.pnl),0));
  const pf = gross_loss > 0 ? (gross_profit/gross_loss).toFixed(2) : gross_profit > 0 ? '∞' : '0.00';

  let peak=0, dd=0, equity=0;
  sorted.forEach(t => { equity+=Number(t.pnl); if(equity>peak) peak=equity; dd=Math.max(dd, peak-equity); });

  const pnlEl = document.getElementById('stat-pnl');
  pnlEl.textContent = (totalPnl>=0?'+':'')+formatUSD(totalPnl);
  pnlEl.className = 'stat-value ' + (totalPnl>0?'profit-pos':totalPnl<0?'profit-neg':'');
  const pnlBadge = document.getElementById('stat-pnl-badge');
  pnlBadge.textContent = `${trades.length} Trades`;
  pnlBadge.className = 'stat-badge ' + (totalPnl>0?'badge-profit':totalPnl<0?'badge-loss':'badge-neutral');

  const wrEl = document.getElementById('stat-wr');
  wrEl.textContent = wr+'%';
  wrEl.className = 'stat-value ' + (parseFloat(wr)>=50?'profit-pos':'profit-neg');
  document.getElementById('stat-wr-badge').textContent = `W:${wins} L:${losses}`;

  document.getElementById('stat-pf').textContent = pf;

  const ddEl = document.getElementById('stat-dd');
  ddEl.textContent = '-'+formatUSD(dd);
  ddEl.className = 'stat-value ' + (dd>0?'profit-neg':'');

  renderEquityChart(sorted);
  renderPairChart();
  renderMonthlyChart();
  renderBreakdown(wins, losses, trades.filter(t=>t.result==='be').length);
}

function renderEquityChart(sorted) {
  const ctx = document.getElementById('equityChart').getContext('2d');
  let cum = 0;
  const labels = sorted.map((t,i) => '#'+(i+1));
  const data   = sorted.map(t => { cum+=Number(t.pnl); return parseFloat(cum.toFixed(2)); });

  if (equityChartInst) equityChartInst.destroy();
  equityChartInst = new Chart(ctx, {
    type: 'line',
    data: { labels, datasets: [{
      label: 'Equity ($)', data,
      borderColor: data.length && data[data.length-1]>=0 ? '#3ddc97' : '#ff5c7a',
      backgroundColor: ctx => {
        const g = ctx.chart.ctx.createLinearGradient(0,0,0,200);
        g.addColorStop(0, 'rgba(255,255,255,0.12)');
        g.addColorStop(1, 'rgba(255,255,255,0)');
        return g;
      },
      fill: true, tension: 0.4, pointRadius: data.length > 30 ? 0 : 4,
      pointBackgroundColor: '#eceef2', borderWidth: 2.5,
    }]},
    options: {
      responsive: true, animation: { duration: 600 },
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => ' $'+c.parsed.y.toFixed(2) } } },
      scales: { x: { grid: { display: false }, ticks: { maxTicksLimit: 8 } }, y: { grid: { color: 'rgba(255,255,255,0.04)' } } }
    }
  });
}

function renderPairChart() {
  const ctx = document.getElementById('pairChart').getContext('2d');
  const counts = {};
  trades.forEach(t => { counts[t.pair] = (counts[t.pair]||0)+1; });
  const entries = Object.entries(counts).sort((a,b)=>b[1]-a[1]).slice(0,6);
  const COLORS = ['#eceef2','#9aa0ad','#6e7480','#3ddc97','#ffc857','#ff5c7a'];

  if (pairChartInst) pairChartInst.destroy();
  if (!entries.length) return;
  pairChartInst = new Chart(ctx, {
    type: 'doughnut',
    data: { labels: entries.map(e=>e[0]), datasets: [{ data: entries.map(e=>e[1]), backgroundColor: COLORS, borderWidth: 0, hoverOffset: 8 }] },
    options: { responsive: true, cutout: '65%',
      plugins: { legend: { position: 'bottom', labels: { padding: 12, boxWidth: 10 } },
        tooltip: { callbacks: { label: c => ` ${c.label}: ${c.raw} trades` } } } }
  });
}

function renderMonthlyChart() {
  const ctx = document.getElementById('monthlyChart').getContext('2d');
  const now = new Date();
  const months = ['Jan','Feb','Mar','Apr','Mei','Jun','Jul','Agt','Sep','Okt','Nov','Des'];
  const monthly = new Array(12).fill(0);
  trades.forEach(t => {
    const d = new Date(t.trade_date);
    if (d.getFullYear() === now.getFullYear()) monthly[d.getMonth()] += Number(t.pnl);
  });

  if (monthlyChartInst) monthlyChartInst.destroy();
  monthlyChartInst = new Chart(ctx, {
    type: 'bar',
    data: { labels: months, datasets: [{
      data: monthly.map(v=>parseFloat(v.toFixed(2))),
      backgroundColor: monthly.map(v => v>=0 ? 'rgba(61,220,151,0.6)' : 'rgba(255,92,122,0.6)'),
      borderRadius: 6, borderSkipped: false,
    }]},
    options: { responsive: true, animation: { duration: 600 },
      plugins: { legend:{display:false}, tooltip:{callbacks:{label:c=>' $'+c.parsed.y.toFixed(2)}} },
      scales: { x:{grid:{display:false}}, y:{grid:{color:'rgba(255,255,255,0.04)'}} } }
  });
}

function renderBreakdown(wins,losses,be) {
  const total = wins+losses+be||1;
  document.getElementById('breakdown-visual').innerHTML = `
    <div style="display:flex;flex-direction:column;gap:14px;padding-top:8px;">
      <div>
        <div style="display:flex;justify-content:space-between;margin-bottom:6px;font-size:13px;">
          <span style="color:var(--profit);">✅ Win</span>
          <span style="font-family:'Orbitron',monospace;font-size:12px;">${wins} (${(wins/total*100).toFixed(1)}%)</span>
        </div>
        <div style="height:10px;background:rgba(255,255,255,0.06);border-radius:5px;overflow:hidden;">
          <div style="height:100%;width:${wins/total*100}%;background:var(--profit);border-radius:5px;transition:width 0.8s ease;"></div>
        </div>
      </div>
      <div>
        <div style="display:flex;justify-content:space-between;margin-bottom:6px;font-size:13px;">
          <span style="color:var(--loss);">❌ Loss</span>
          <span style="font-family:'Orbitron',monospace;font-size:12px;">${losses} (${(losses/total*100).toFixed(1)}%)</span>
        </div>
        <div style="height:10px;background:rgba(255,255,255,0.06);border-radius:5px;overflow:hidden;">
          <div style="height:100%;width:${losses/total*100}%;background:var(--loss);border-radius:5px;transition:width 0.8s ease;"></div>
        </div>
      </div>
      <div>
        <div style="display:flex;justify-content:space-between;margin-bottom:6px;font-size:13px;">
          <span style="color:var(--warn);">⚖️ Break Even</span>
          <span style="font-family:'Orbitron',monospace;font-size:12px;">${be} (${(be/total*100).toFixed(1)}%)</span>
        </div>
        <div style="height:10px;background:rgba(255,255,255,0.06);border-radius:5px;overflow:hidden;">
          <div style="height:100%;width:${be/total*100}%;background:var(--warn);border-radius:5px;transition:width 0.8s ease;"></div>
        </div>
      </div>
      <div style="text-align:center;margin-top:8px;">
        <div style="font-size:40px;font-family:'Orbitron',monospace;font-weight:700;color:var(--text-main);">${total}</div>
        <div style="font-size:12px;color:var(--text-muted);margin-top:2px;">Total Trades</div>
      </div>
    </div>
  `;
}

// ============================================================
// TRADE TABLE
// ============================================================
function getFilteredTrades() {
  const q = (document.getElementById('searchInput')?.value || '').toLowerCase();
  return [...trades].filter(t => {
    if (currentFilter==='win')  return t.result==='win';
    if (currentFilter==='loss') return t.result==='loss';
    if (currentFilter==='buy')  return t.type==='buy';
    if (currentFilter==='sell') return t.type==='sell';
    if (currentFilter==='search') {
      return (t.pair||'').toLowerCase().includes(q) ||
             (t.notes||'').toLowerCase().includes(q) ||
             (t.setup||'').toLowerCase().includes(q);
    }
    return true;
  });
}

function renderTable() {
  let data = getFilteredTrades();
  data.sort((a,b) => {
    let av=a[currentSort.col], bv=b[currentSort.col];
    if (currentSort.col==='trade_date') { av=new Date(av); bv=new Date(bv); }
    else if (typeof av==='string') { av=(av||'').toLowerCase(); bv=(bv||'').toLowerCase(); }
    else { av = av ?? 0; bv = bv ?? 0; }
    return av<bv ? -currentSort.dir : av>bv ? currentSort.dir : 0;
  });

  const total = data.length;
  const pages = Math.ceil(total/PER_PAGE);
  currentPage = Math.min(currentPage, pages||1);
  const slice = data.slice((currentPage-1)*PER_PAGE, currentPage*PER_PAGE);

  const tbody = document.getElementById('tradeBody');
  document.getElementById('empty-table').style.display = total===0 ? '' : 'none';

  tbody.innerHTML = slice.map(t => `
    <tr>
      <td>${formatDate(t.trade_date)}</td>
      <td><span class="pair-badge">${t.pair}</span></td>
      <td><span class="tag tag-${t.type}">${t.type==='buy'?'↑ BUY':'↓ SELL'}</span></td>
      <td>${t.lot ?? '—'}</td>
      <td>${t.entry_price ?? '—'}</td>
      <td>${t.exit_price ?? '—'}</td>
      <td><span class="profit-text ${t.pnl>0?'profit-pos':t.pnl<0?'profit-neg':'profit-zero'}">${t.pnl>=0?'+':''}${formatUSD(t.pnl)}</span></td>
      <td><span class="tag ${t.result==='win'?'tag-win':t.result==='loss'?'tag-lose':'tag-be'}">${t.result==='win'?'✅ Win':t.result==='loss'?'❌ Loss':'⚖️ BE'}</span></td>
      <td style="color:var(--text-muted);font-size:12px;">${t.setup||'—'}</td>
      <td>
        <button class="btn-icon edit" onclick="openModal('${t.id}')" title="Edit">✏️</button>
        <button class="btn-icon del"  onclick="deleteTrade('${t.id}')" title="Hapus">🗑️</button>
      </td>
    </tr>
  `).join('');

  document.getElementById('paginationInfo').textContent = `Menampilkan ${slice.length} dari ${total} trade`;
  renderPagination(pages);
}

function renderPagination(pages) {
  const container = document.getElementById('pageBtns');
  if (pages<=1) { container.innerHTML=''; return; }
  let html = '';
  for(let i=1;i<=pages;i++) html+=`<button class="page-btn${i===currentPage?' active':''}" onclick="goPage(${i})">${i}</button>`;
  container.innerHTML = html;
}
function goPage(n) { currentPage=n; renderTable(); }

function filterTable(f, btn) {
  currentFilter = f;
  if (f !== 'search') {
    document.querySelectorAll('.filter-btn').forEach(b=>b.classList.remove('active'));
    if(btn) btn.classList.add('active');
  }
  currentPage=1;
  renderTable();
}

function sortTable(col) {
  if (currentSort.col===col) currentSort.dir*=-1; else { currentSort.col=col; currentSort.dir=-1; }
  renderTable();
}

// ============================================================
// STATISTICS PAGE
// ============================================================
function renderStatistics() {
  const wins   = trades.filter(t=>t.result==='win');
  const losses = trades.filter(t=>t.result==='loss');
  const avgWin  = wins.length   ? wins.reduce((s,t)=>s+Number(t.pnl),0)/wins.length     : 0;
  const avgLoss = losses.length ? losses.reduce((s,t)=>s+Number(t.pnl),0)/losses.length : 0;

  document.getElementById('s-avg-win').textContent  = '+'+formatUSD(avgWin);
  document.getElementById('s-avg-loss').textContent = formatUSD(avgLoss);

  const sortedByPnl = [...trades].sort((a,b)=>b.pnl-a.pnl);
  const best  = sortedByPnl[0];
  const worst = sortedByPnl[sortedByPnl.length-1];
  document.getElementById('s-best').textContent  = best  ? '+'+formatUSD(best.pnl)  : '$0';
  document.getElementById('s-worst').textContent = worst ? formatUSD(worst.pnl)      : '$0';
  document.getElementById('s-best-pair').textContent  = best  ? best.pair+' · '+formatDate(best.trade_date) : '—';
  document.getElementById('s-worst-pair').textContent = worst ? worst.pair+' · '+formatDate(worst.trade_date): '—';

  renderPairPnlChart();
  renderSetupChart();
  renderDOWChart();
}

function renderPairPnlChart() {
  const ctx = document.getElementById('pairPnlChart').getContext('2d');
  const pairPnl = {};
  trades.forEach(t => { pairPnl[t.pair]=(pairPnl[t.pair]||0)+Number(t.pnl); });
  const entries = Object.entries(pairPnl).sort((a,b)=>Math.abs(b[1])-Math.abs(a[1])).slice(0,8);
  if (pairPnlInst) pairPnlInst.destroy();
  if(!entries.length) return;
  pairPnlInst = new Chart(ctx, {
    type:'bar',
    data:{ labels: entries.map(e=>e[0]), datasets:[{
      data: entries.map(e=>parseFloat(e[1].toFixed(2))),
      backgroundColor: entries.map(e=>e[1]>=0?'rgba(61,220,151,0.65)':'rgba(255,92,122,0.65)'),
      borderRadius:6, borderSkipped:false
    }]},
    options:{ responsive:true, indexAxis:'y',
      plugins:{legend:{display:false}, tooltip:{callbacks:{label:c=>' $'+c.parsed.x.toFixed(2)}}},
      scales:{x:{grid:{color:'rgba(255,255,255,0.04)'}},y:{grid:{display:false}}} }
  });
}

function renderSetupChart() {
  const ctx = document.getElementById('setupChart').getContext('2d');
  const setups = {};
  trades.forEach(t => {
    if (!t.setup) return;
    if (!setups[t.setup]) setups[t.setup]={wins:0,total:0};
    setups[t.setup].total++;
    if(t.result==='win') setups[t.setup].wins++;
  });
  const entries = Object.entries(setups).sort((a,b)=>b[1].total-a[1].total).slice(0,6);
  if (setupInst) setupInst.destroy();
  if(!entries.length) return;
  setupInst = new Chart(ctx, {
    type:'bar',
    data:{ labels: entries.map(e=>e[0]), datasets:[
      {label:'Win Rate %', data:entries.map(e=>parseFloat((e[1].wins/e[1].total*100).toFixed(1))),
       backgroundColor:'rgba(255,255,255,0.7)',borderRadius:6,borderSkipped:false,yAxisID:'y'},
      {label:'Trades',     data:entries.map(e=>e[1].total),
       backgroundColor:'rgba(255,255,255,0.25)',borderRadius:6,borderSkipped:false,yAxisID:'y1'},
    ]},
    options:{ responsive:true,
      plugins:{legend:{position:'bottom',labels:{padding:12,boxWidth:10}},
        tooltip:{callbacks:{label:c=>c.datasetIndex===0?' WR: '+c.parsed.y+'%':' Trades: '+c.parsed.y}}},
      scales:{ x:{grid:{display:false}},
        y:{grid:{color:'rgba(255,255,255,0.04)'},title:{display:true,text:'Win Rate %'},position:'left'},
        y1:{grid:{display:false},title:{display:true,text:'Jumlah'},position:'right'} } }
  });
}

function renderDOWChart() {
  const ctx = document.getElementById('dowChart').getContext('2d');
  const days=['Minggu','Senin','Selasa','Rabu','Kamis','Jumat','Sabtu'];
  const dayPnl = new Array(7).fill(0);
  const dayCnt = new Array(7).fill(0);
  trades.forEach(t=>{ const d=new Date(t.trade_date).getDay(); dayPnl[d]+=Number(t.pnl); dayCnt[d]++; });
  const avg = dayPnl.map((p,i)=>dayCnt[i]?parseFloat((p/dayCnt[i]).toFixed(2)):0);
  if(dowInst) dowInst.destroy();
  dowInst = new Chart(ctx,{
    type:'bar',
    data:{ labels:days, datasets:[{
      label:'Avg P&L ($)', data:avg,
      backgroundColor:avg.map(v=>v>=0?'rgba(255,255,255,0.5)':'rgba(255,92,122,0.6)'),
      borderRadius:8,borderSkipped:false
    }]},
    options:{ responsive:true,
      plugins:{legend:{display:false},tooltip:{callbacks:{label:c=>' $'+c.parsed.y.toFixed(2)}}},
      scales:{x:{grid:{display:false}},y:{grid:{color:'rgba(255,255,255,0.04)'}}} }
  });
}

// ============================================================
// EXPORT CSV
// ============================================================
function exportCSV() {
  if (!trades.length) return showToast('ℹ️', 'Tidak ada data untuk diekspor.', 'info');
  const headers = ['Tanggal','Pair','Type','Lot','Entry','Exit','SL','TP','PnL','Result','Setup','Notes'];
  const rows = trades.map(t=>[t.trade_date,t.pair,t.type,t.lot,t.entry_price,t.exit_price,t.stop_loss,t.take_profit,t.pnl,t.result,t.setup||'',`"${(t.notes||'').replace(/"/g,'""')}"`]);
  const csv = [headers.join(','), ...rows.map(r=>r.join(','))].join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], {type:'text/csv'}));
  a.download = 'fx_journal_'+new Date().toISOString().slice(0,10)+'.csv';
  a.click();
  showToast('📥', 'Export CSV berhasil!', 'success');
}

// ============================================================
// HELPERS
// ============================================================
function formatUSD(n) {
  return '$'+Math.abs(Number(n)).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
}
function formatDate(str) {
  if (!str) return '—';
  return new Date(str).toLocaleDateString('id-ID',{day:'2-digit',month:'short',year:'numeric'});
}
function toLocalDatetimeInput(isoStr) {
  const d = new Date(isoStr);
  const pad = n => String(n).padStart(2,'0');
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function showToast(icon, msg, type) {
  const colors = { success:'var(--profit)', warn:'var(--warn)', info:'var(--text-muted)', error:'var(--loss)' };
  const el = document.createElement('div');
  el.className = 'toast';
  el.style.borderLeftColor = colors[type]||'var(--text-muted)';
  el.innerHTML = `<span class="toast-icon">${icon}</span><span>${msg}</span>`;
  document.getElementById('toast-container').appendChild(el);
  setTimeout(()=>el.remove(), 3200);
}
