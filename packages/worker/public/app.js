let apiKey = sessionStorage.getItem('fogApiKey');

async function callApi(method, path, body) {
  if (!apiKey) {
    apiKey = prompt('Enter your Fog API key:');
    if (!apiKey) throw new Error('API key required');
    sessionStorage.setItem('fogApiKey', apiKey);
  }
  const res = await fetch(path, {
    method,
    headers: { 'X-API-Key': apiKey, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
  if (res.status === 204) return null;
  return res.json();
}

const app = document.getElementById('app');

// Escape user-controlled strings before inserting into innerHTML
const esc = s => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;')
  .replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function render(html) { app.innerHTML = html; }

function loading(msg = 'Loading\u2026') {
  return `<div class="spinner-wrap"><div class="spinner"></div><p class="loading-label">${msg}</p></div>`;
}

const warnSvg = `<svg width="40" height="40" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" stroke="#dc2626" stroke-width="1.5" stroke-linejoin="round"/><line x1="12" y1="9" x2="12" y2="13" stroke="#dc2626" stroke-width="1.5" stroke-linecap="round"/><circle cx="12" cy="17" r="1" fill="#dc2626"/></svg>`;

// All user-controlled values passed through esc() before insertion
function renderError(err, retryFn) {
  const is401 = err.message.startsWith('401');
  const title = is401 ? 'Invalid API Key' : 'Something went wrong';
  const body = is401 ? 'Your API key was rejected. Please check your key and try again.' : esc(err.message);
  const btnClass = is401 ? 'btn-primary' : 'btn-secondary';
  const btnLabel = is401 ? 'Clear Key &amp; Retry' : 'Try Again';
  render(`<div class="card"><div class="error-state">${warnSvg}<p class="error-title">${title}</p><p class="error-body">${body}</p><button class="btn ${btnClass}" id="err-retry">${btnLabel}</button></div></div>`);
  document.getElementById('err-retry').addEventListener('click', () => {
    if (is401) { apiKey = null; sessionStorage.removeItem('fogApiKey'); }
    retryFn();
  });
}

// Show an inline error banner inside a container element, clearing any prior one
function showInlineError(container, message) {
  const existing = container.querySelector('.inline-error');
  if (existing) existing.remove();
  const el = document.createElement('div');
  el.className = 'inline-error';
  el.textContent = message;
  container.prepend(el);
  el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function statusBadge(status) {
  const cls = { active: 'badge-active', paused: 'badge-paused', completed: 'badge-completed' }[status] || 'badge-completed';
  return `<span class="badge ${cls}">${esc(status)}</span>`;
}

function probBadge(prob) {
  if (prob == null) return '<span class="badge badge-prob-low">N/A</span>';
  const pct = (prob * 100).toFixed(1);
  const cls = prob >= 0.95 ? 'badge-prob-high' : prob >= 0.80 ? 'badge-prob-mid' : 'badge-prob-low';
  return `<span class="badge ${cls}">${pct}%</span>`;
}

function convBar(rate, variantIndex) {
  const pct = (rate * 100).toFixed(2);
  const fillClass = variantIndex === 0 ? 'bar-fill-a' : 'bar-fill-b';
  const w = Math.min(rate * 100, 100).toFixed(1);
  return `${pct}%<span class="bar-track"><span class="${fillClass}" style="width:${w}%"></span></span>`;
}

// Generate P(X>A) label for column header given variant index and name
function probColumnLabel(variantIndex, variantName) {
  if (variantIndex === 0) return '-';
  // Use single uppercase letter for first few variants, fall back to name
  const letters = 'BCDEFGHIJKLMNOPQRSTUVWXYZ';
  const label = variantIndex - 1 < letters.length ? letters[variantIndex - 1] : esc(variantName);
  return `P(${label}&gt;A)`;
}

// --- Views ---

const emptyStateSvg = `<svg width="56" height="56" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg"><rect x="6" y="28" width="9" height="12" rx="2" fill="#d1d5db"/><rect x="19.5" y="18" width="9" height="22" rx="2" fill="#d1d5db"/><rect x="33" y="10" width="9" height="30" rx="2" fill="#d1d5db"/><line x1="3" y1="40" x2="45" y2="40" stroke="#d1d5db" stroke-width="2" stroke-linecap="round"/></svg>`;

async function renderList() {
  render(loading('Loading experiments\u2026'));
  try {
    const experiments = await callApi('GET', '/api/experiments');

    const content = experiments.length
      ? `<table>
          <thead><tr><th>Name</th><th>Status</th><th>Variants</th><th>Traffic</th><th>Created</th></tr></thead>
          <tbody>${experiments.map(e => `
            <tr>
              <td><a href="#/experiments/${esc(e.id)}">${esc(e.name)}</a></td>
              <td>${statusBadge(e.status)}</td>
              <td>${e.variants.length}</td>
              <td>${Number(e.trafficPercent)}%</td>
              <td>${new Date(e.createdAt).toLocaleDateString()}</td>
            </tr>`).join('')}
          </tbody>
        </table>`
      : `<div class="empty-state">
          ${emptyStateSvg}
          <h3>No experiments yet</h3>
          <p>Create your first A/B test to get started</p>
          <a href="#/experiments/new" class="btn btn-primary">+ New Experiment</a>
        </div>`;

    render(`
      <div class="nav-tabs">
        <a href="#/" class="nav-tab nav-tab-active">Experiments</a>
        <a href="#/analytics" class="nav-tab">Analytics</a>
      </div>
      <div class="card">
        <div class="card-header">
          <h1>Experiments</h1>
          ${experiments.length ? '<a href="#/experiments/new" class="btn btn-primary">+ New Experiment</a>' : ''}
        </div>
        ${content}
      </div>
    `);
  } catch (err) {
    renderError(err, renderList);
  }
}

async function renderNew() {
  render(`
    <div class="card">
      <div class="card-header">
        <h1>New Experiment</h1>
        <a href="#/" class="btn btn-secondary">Cancel</a>
      </div>
      <form id="new-form">
        <div id="form-error-wrap"></div>
        <div class="form-group">
          <label for="exp-name">Name</label>
          <input type="text" id="exp-name" placeholder="My Experiment" autocomplete="off">
        </div>
        <div class="form-group">
          <label for="exp-variants">Variants (comma-separated)</label>
          <input type="text" id="exp-variants" value="control,treatment">
        </div>
        <div class="form-group">
          <label for="exp-traffic">Traffic %: <span id="traffic-val">100</span>%</label>
          <input type="range" id="exp-traffic" min="1" max="100" value="100"
            oninput="document.getElementById('traffic-val').textContent=this.value">
        </div>
        <button type="submit" class="btn btn-primary">Create Experiment</button>
      </form>
    </div>
  `);

  document.getElementById('new-form').addEventListener('submit', async e => {
    e.preventDefault();
    const name = document.getElementById('exp-name').value.trim();
    const variants = document.getElementById('exp-variants').value
      .split(',').map(v => v.trim()).filter(Boolean);
    const trafficPercent = parseInt(document.getElementById('exp-traffic').value, 10);
    const errorWrap = document.getElementById('form-error-wrap');

    // DASH-7: Inline validation
    if (!name) {
      showInlineError(errorWrap, 'Experiment name is required.');
      document.getElementById('exp-name').focus();
      return;
    }
    if (variants.length < 2) {
      showInlineError(errorWrap, 'At least 2 variants are required (e.g. control,treatment).');
      document.getElementById('exp-variants').focus();
      return;
    }
    const uniqueVariants = new Set(variants.map(v => v.toLowerCase()));
    if (uniqueVariants.size !== variants.length) {
      showInlineError(errorWrap, 'Variant names must be unique.');
      document.getElementById('exp-variants').focus();
      return;
    }

    const submitBtn = e.target.querySelector('[type="submit"]');
    submitBtn.disabled = true;
    submitBtn.textContent = 'Creating\u2026';
    try {
      await callApi('POST', '/api/experiments', { name, variants, trafficPercent });
      location.hash = '#/';
    } catch (err) {
      // DASH-1: Replace alert() with inline error
      showInlineError(errorWrap, err.message);
      submitBtn.disabled = false;
      submitBtn.textContent = 'Create Experiment';
    }
  });
}

// Build integration snippet HTML for a given experiment ID.
// Worker URL is inferred from window.location.origin since the dashboard
// is served from the same origin as the API and SDK endpoints.
function renderSnippet(experimentId) {
  const workerUrl = window.location.origin;
  const safeId = esc(experimentId);
  const safeUrl = esc(workerUrl);

  const scriptSnippet = `<!-- Load Fog SDK -->
&lt;script src="${safeUrl}/t.js" async&gt;&lt;/script&gt;
&lt;script&gt;
  Fog.init({ experimentId: '${safeId}' });
&lt;/script&gt;`;

  const npmSnippet = `import { Fog } from '@fogalytics/sdk';

Fog.init({
  endpoint: '${safeUrl}',
  experimentId: '${safeId}',
});

const variant = Fog.getVariant('${safeId}');`;

  // Raw (unescaped) text used for clipboard copy
  const scriptRaw = `<!-- Load Fog SDK -->\n<script src="${workerUrl}/t.js" async></script>\n<script>\n  Fog.init({ experimentId: '${experimentId}' });\n</script>`;
  const npmRaw = `import { Fog } from '@fogalytics/sdk';\n\nFog.init({\n  endpoint: '${workerUrl}',\n  experimentId: '${experimentId}',\n});\n\nconst variant = Fog.getVariant('${experimentId}');`;

  return { scriptSnippet, npmSnippet, scriptRaw, npmRaw };
}

// Attach copy-to-clipboard behaviour to snippet copy buttons.
// Called after renderResults injects the snippet HTML into the DOM.
function attachSnippetListeners(scriptRaw, npmRaw) {
  const tabs = document.querySelectorAll('.snippet-tab');
  const panels = document.querySelectorAll('.snippet-panel');

  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      tabs.forEach(t => t.classList.remove('active'));
      panels.forEach(p => { p.style.display = 'none'; });
      tab.classList.add('active');
      const target = document.getElementById(tab.dataset.target);
      if (target) target.style.display = 'block';
    });
  });

  const copyMap = { 'copy-script': scriptRaw, 'copy-npm': npmRaw };
  Object.entries(copyMap).forEach(([btnId, text]) => {
    const btn = document.getElementById(btnId);
    if (!btn) return;
    btn.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(text);
        btn.textContent = 'Copied!';
        btn.classList.add('copied');
        setTimeout(() => { btn.textContent = 'Copy'; btn.classList.remove('copied'); }, 2000);
      } catch {
        // Fallback for environments where clipboard API is blocked
        btn.textContent = 'Copy failed';
        setTimeout(() => { btn.textContent = 'Copy'; }, 2000);
      }
    });
  });
}

async function renderResults(id) {
  render(loading());
  try {
    const [exp, results] = await Promise.all([
      callApi('GET', `/api/experiments/${id}`),
      callApi('GET', `/api/results/${id}`).catch(() => null),
    ]);

    const safeId = esc(id);
    const nextStatus = exp.status === 'active' ? 'paused' : exp.status === 'paused' ? 'active' : null;
    const toggleLabel = nextStatus === 'active' ? 'Resume' : 'Pause';
    const toggleBtn = nextStatus
      ? `<button class="btn btn-secondary" data-action="toggle" data-id="${safeId}" data-status="${esc(nextStatus)}">${toggleLabel}</button>`
      : '';
    const completeBtn = exp.status !== 'completed'
      ? `<button class="btn btn-secondary" data-action="complete" data-id="${safeId}">Complete</button>`
      : '';

    // DASH-6: Experiment metadata
    const createdDate = new Date(exp.createdAt).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
    const variantNamesList = exp.variants.map(v => esc(v)).join(', ');
    const metaHtml = `
      <div class="meta-row">
        <span class="meta-item"><span class="meta-label">Traffic</span>${Number(exp.trafficPercent)}%</span>
        <span class="meta-item"><span class="meta-label">Variants</span>${variantNamesList}</span>
        <span class="meta-item"><span class="meta-label">Created</span>${createdDate}</span>
      </div>`;

    const variantRows = results?.variants?.length
      ? results.variants.map((v, i) => `
        <tr>
          <td>${esc(v.name)}</td>
          <td>${(v.impressions ?? 0).toLocaleString()}</td>
          <td>${(v.conversions ?? 0).toLocaleString()}</td>
          <td>${convBar(v.conversionRate ?? 0, i)}</td>
          <td>${i > 0 ? probBadge(v.probability ?? null) : '-'}</td>
        </tr>`).join('')
      : '<tr><td colspan="5" style="color:#86868b;padding:1rem">No data yet</td></tr>';

    const { scriptSnippet, npmSnippet, scriptRaw, npmRaw } = renderSnippet(id);

    render(`
      <div class="card">
        <div class="card-header">
          <div>
            <h1>${esc(exp.name)}</h1>
            <div style="margin-top:.3rem">${statusBadge(exp.status)}</div>
          </div>
          <div class="actions">
            ${toggleBtn}${completeBtn}
            <button class="btn btn-secondary" data-action="export" data-id="${safeId}">Export CSV</button>
            <button class="btn btn-secondary" data-action="refresh" data-id="${safeId}">&#8635; Refresh</button>
            <button class="btn btn-danger" data-action="delete" data-id="${safeId}">Delete</button>
            <a href="#/" class="btn btn-secondary">&#8592; Back</a>
          </div>
        </div>
        ${metaHtml}
        <div id="action-error-wrap" style="margin-bottom:.5rem"></div>
        <div id="export-success-wrap" style="margin-bottom:.5rem"></div>
        <h2>Results</h2>
        <table>
          <thead><tr>
            <th>Variant</th><th>Impressions</th><th>Conversions</th><th>Conv. Rate</th><th>P(beat control)</th>
          </tr></thead>
          <tbody>${variantRows}</tbody>
        </table>
        <div class="snippet-section">
          <h2>Integration</h2>
          <div class="snippet-tabs">
            <button class="snippet-tab active" data-target="snippet-script">Script tag</button>
            <button class="snippet-tab" data-target="snippet-npm">npm</button>
          </div>
          <div id="snippet-script" class="snippet-panel snippet-block">
            <pre class="snippet-code">${scriptSnippet}</pre>
            <button class="snippet-copy" id="copy-script">Copy</button>
          </div>
          <div id="snippet-npm" class="snippet-panel snippet-block" style="display:none">
            <pre class="snippet-code">${npmSnippet}</pre>
            <button class="snippet-copy" id="copy-npm">Copy</button>
          </div>
        </div>
      </div>
    `);

    attachSnippetListeners(scriptRaw, npmRaw);

    // Attach event listeners via data attributes (avoids inline onclick with user-controlled IDs)
    app.querySelectorAll('[data-action]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const action = btn.dataset.action;
        const expId = btn.dataset.id;
        const actionErrorWrap = document.getElementById('action-error-wrap');
        const exportSuccessWrap = document.getElementById('export-success-wrap');

        if (action === 'refresh') {
          renderResults(expId);
        } else if (action === 'delete') {
          // DASH-3: Delete button with confirmation
          if (!confirm(`Delete experiment "${exp.name}"? This cannot be undone.`)) return;
          btn.disabled = true;
          try {
            await callApi('DELETE', `/api/experiments/${expId}`);
            location.hash = '#/';
          } catch (err) {
            // DASH-1: Inline error for action failure
            showInlineError(actionErrorWrap, `Delete failed: ${err.message}`);
            btn.disabled = false;
          }
        } else if (action === 'toggle' || action === 'complete') {
          const status = action === 'complete' ? 'completed' : btn.dataset.status;
          btn.disabled = true;
          try {
            await callApi('PATCH', `/api/experiments/${expId}`, { status });
            renderResults(expId);
          } catch (err) {
            // DASH-1: Inline error for action failure
            showInlineError(actionErrorWrap, `Update failed: ${err.message}`);
            btn.disabled = false;
          }
        } else if (action === 'export') {
          btn.disabled = true;
          btn.textContent = 'Exporting\u2026';
          try {
            const result = await callApi('POST', `/api/export/${expId}`);
            // DASH-2: Show export key/path instead of vague alert
            const key = result?.key ?? result?.path ?? null;
            if (exportSuccessWrap) {
              const existing = exportSuccessWrap.querySelector('.export-success');
              if (existing) existing.remove();
              const el = document.createElement('div');
              el.className = 'export-success';
              el.innerHTML = key
                ? `Export complete. File saved to: <code>${esc(key)}</code>`
                : 'Export triggered successfully.';
              exportSuccessWrap.appendChild(el);
            }
          } catch (err) {
            showInlineError(actionErrorWrap, `Export failed: ${err.message}`);
          } finally {
            btn.disabled = false;
            btn.textContent = 'Export CSV';
          }
        }
      });
    });
  } catch (err) {
    renderError(err, () => renderResults(id));
  }
}

// --- Analytics view ---

// Draw a bar chart using SVG. bars is [{label, value}], maxValue is the scale ceiling.
function renderBarChart(bars, maxValue) {
  if (!bars.length) return '<p class="analytics-empty">No data for this period.</p>';

  const W = 600;
  const H = 120;
  const MARGIN_LEFT = 0;
  const MARGIN_BOTTOM = 28;
  const chartH = H - MARGIN_BOTTOM;
  const barW = Math.max(4, Math.floor((W - MARGIN_LEFT) / bars.length) - 2);
  const gap = Math.max(1, Math.floor((W - MARGIN_LEFT) / bars.length) - barW);

  const rects = bars.map((b, i) => {
    const barH = maxValue > 0 ? Math.round((b.value / maxValue) * chartH) : 0;
    const x = MARGIN_LEFT + i * (barW + gap);
    const y = chartH - barH;
    return `<rect x="${x}" y="${y}" width="${barW}" height="${barH}" rx="2" fill="#1a1a2e"/>`;
  }).join('');

  // Show first, middle, last labels only to avoid crowding
  const labelIndices = new Set([0, Math.floor(bars.length / 2), bars.length - 1]);
  const labels = bars.map((b, i) => {
    if (!labelIndices.has(i) && bars.length > 3) return '';
    const x = MARGIN_LEFT + i * (barW + gap) + barW / 2;
    return `<text x="${x}" y="${H - 6}" text-anchor="middle" font-size="9" fill="#86868b">${esc(b.label)}</text>`;
  }).join('');

  return `<div class="chart-wrap">
    <svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}" xmlns="http://www.w3.org/2000/svg" aria-label="Pageviews chart">
      ${rects}
      ${labels}
    </svg>
  </div>`;
}

// Format an AE timestamp bucket into a short label for the chart axis
function formatBucket(bucket, period) {
  // bucket is like "2026-02-15 00:00:00" or "2026-02-15 14:00:00"
  const d = new Date(bucket.replace(' ', 'T') + 'Z');
  if (isNaN(d.getTime())) return bucket;
  if (period === 'today') {
    return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'UTC' });
  }
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

async function renderAnalytics(period) {
  period = period || '7d';

  render(`
    <div class="nav-tabs">
      <a href="#/" class="nav-tab">Experiments</a>
      <a href="#/analytics" class="nav-tab nav-tab-active">Analytics</a>
    </div>
    ${loading('Loading analytics\u2026')}
  `);

  try {
    const data = await callApi('GET', `/api/analytics?period=${encodeURIComponent(period)}`);

    const periodLabels = { today: 'Today', '7d': 'Last 7 days', '30d': 'Last 30 days' };

    const bars = (data.timeseries || []).map(r => ({
      label: formatBucket(r.bucket, period),
      value: r.views,
    }));
    const maxViews = bars.reduce((m, b) => Math.max(m, b.value), 0);

    const topPagesRows = (data.topPages || []).map(p => `
      <tr>
        <td><span class="page-path">${esc(p.page || '(unknown)')}</span></td>
        <td>${Number(p.views).toLocaleString()}</td>
        <td>${Number(p.uniqueVisitors).toLocaleString()}</td>
      </tr>`).join('') || '<tr><td colspan="3" style="color:#86868b;padding:1rem">No page data yet</td></tr>';

    render(`
      <div class="nav-tabs">
        <a href="#/" class="nav-tab">Experiments</a>
        <a href="#/analytics" class="nav-tab nav-tab-active">Analytics</a>
      </div>
      <div class="card">
        <div class="card-header">
          <h1>Analytics</h1>
          <div class="period-selector">
            <button class="btn ${period === 'today' ? 'btn-primary' : 'btn-secondary'}" data-period="today">Today</button>
            <button class="btn ${period === '7d' ? 'btn-primary' : 'btn-secondary'}" data-period="7d">7 days</button>
            <button class="btn ${period === '30d' ? 'btn-primary' : 'btn-secondary'}" data-period="30d">30 days</button>
          </div>
        </div>

        <div class="analytics-summary">
          <div class="summary-stat">
            <span class="summary-value">${Number(data.totalViews).toLocaleString()}</span>
            <span class="summary-label">Pageviews</span>
          </div>
          <div class="summary-stat">
            <span class="summary-value">${Number(data.uniqueVisitors).toLocaleString()}</span>
            <span class="summary-label">Unique visitors</span>
          </div>
        </div>

        <h2>Pageviews - ${esc(periodLabels[period] || period)}</h2>
        ${renderBarChart(bars, maxViews)}

        <h2 style="margin-top:1.5rem">Top pages</h2>
        <table>
          <thead><tr><th>Page</th><th>Views</th><th>Unique visitors</th></tr></thead>
          <tbody>${topPagesRows}</tbody>
        </table>
      </div>
    `);

    // Period selector buttons
    app.querySelectorAll('[data-period]').forEach(btn => {
      btn.addEventListener('click', () => {
        const p = btn.dataset.period;
        location.hash = `#/analytics/${p}`;
      });
    });
  } catch (err) {
    renderError(err, () => renderAnalytics(period));
  }
}

// --- Router ---

function route() {
  const hash = location.hash || '#/';
  if (hash === '#/' || hash === '' || hash === '#') {
    renderList();
  } else if (hash === '#/experiments/new') {
    renderNew();
  } else if (hash === '#/analytics' || hash.startsWith('#/analytics/')) {
    const m = hash.match(/^#\/analytics\/?(today|7d|30d)?$/);
    const period = m?.[1] || '7d';
    renderAnalytics(period);
  } else {
    const m = hash.match(/^#\/experiments\/([^/]+)$/);
    if (m) renderResults(m[1]);
    else renderList();
  }
}

window.addEventListener('hashchange', route);
document.addEventListener('DOMContentLoaded', route);
