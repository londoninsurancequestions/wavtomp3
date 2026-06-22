const app = document.getElementById('app');
const panelPath = window.location.pathname;

async function api(path, options = {}) {
  const res = await fetch(path, { credentials: 'include', ...options });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function fmtPct(value) {
  if (value == null || Number.isNaN(value)) return '—';
  return `${(value * 100).toFixed(1)}%`;
}

function fmtNum(n) {
  return new Intl.NumberFormat().format(n ?? 0);
}

async function ensureAdmin() {
  const me = await fetch('/api/auth/me', { credentials: 'include' }).then((r) => r.json());
  if (!me.user) {
    window.location.replace('/login/?next=' + encodeURIComponent(panelPath));
    return false;
  }

  const admin = await fetch('/api/admin/me', { credentials: 'include' }).then((r) => r.json());
  if (!admin.admin) {
    window.location.replace('/');
    return false;
  }

  app.hidden = false;
  return true;
}

function renderFunnel(data) {
  const max = Math.max(...data.steps.map((s) => s.count), 1);
  const funnelEl = document.getElementById('funnelSteps');
  funnelEl.innerHTML = data.steps
    .map(
      (step, i) => `
      <div class="funnel-step">
        <div class="funnel-step-head">
          <span class="funnel-step-num">${i + 1}</span>
          <div>
            <div class="funnel-step-label">${esc(step.label)}</div>
            <div class="funnel-step-meta">
              ${i > 0 ? `<span>${fmtPct(step.fromPrevious)} of previous step</span>` : ''}
              <span>${fmtPct(step.fromVisitors)} of visitors</span>
            </div>
          </div>
          <div class="funnel-step-count">${fmtNum(step.count)}</div>
        </div>
        <div class="funnel-bar-track">
          <div class="funnel-bar-fill" style="width:${Math.max((step.count / max) * 100, step.count ? 4 : 0)}%"></div>
        </div>
      </div>`
    )
    .join('');

  const dailyEl = document.getElementById('dailyTable');
  const rows = data.daily || [];
  if (!rows.length) {
    dailyEl.innerHTML = '<p class="empty">No funnel activity recorded yet.</p>';
    return;
  }

  const eventLabels = {
    visit: 'Visitors',
    conversion: 'Conversions',
    limit_modal_shown: 'Limit modal',
    modal_closed: 'Modal closed',
    stripe_checkout: 'Stripe',
    paid_signup: 'Paid signups',
  };

  dailyEl.innerHTML = `
    <table class="inv-table admin-table">
      <thead>
        <tr>
          <th>Day</th>
          ${Object.values(eventLabels)
            .map((label) => `<th>${esc(label)}</th>`)
            .join('')}
        </tr>
      </thead>
      <tbody>
        ${rows
          .map(
            (row) => `<tr>
              <td class="mono">${esc(row.day)}</td>
              ${Object.keys(eventLabels)
                .map((key) => `<td class="mono">${fmtNum(row.events?.[key] ?? 0)}</td>`)
                .join('')}
            </tr>`
          )
          .join('')}
      </tbody>
    </table>`;
}

async function loadStats(period) {
  document.querySelectorAll('[data-period]').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.period === period);
  });
  const data = await api(`/api/admin/funnel-stats?period=${encodeURIComponent(period)}`);
  renderFunnel(data);
}

document.querySelectorAll('[data-period]').forEach((btn) => {
  btn.addEventListener('click', () => loadStats(btn.dataset.period));
});

(async () => {
  try {
    if (!(await ensureAdmin())) return;
    await loadStats('all');
  } catch {
    window.location.replace('/');
  }
})();
