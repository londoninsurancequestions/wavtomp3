const app = document.getElementById('app');
const panelPath = window.location.pathname;

let selectedUserId = null;
let searchTimer = null;

async function api(path, options = {}) {
  const res = await fetch(path, { credentials: 'include', ...options });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

function fmtDate(value) {
  if (!value) return '—';
  const d = typeof value === 'number' ? new Date(value * 1000) : new Date(value);
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function fmtMoney(amount, currency = 'usd') {
  if (amount == null) return '—';
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: currency.toUpperCase(),
  }).format(amount / 100);
}

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function subBadge(sub) {
  if (sub?.active) {
    if (sub.cancelAtPeriodEnd) return '<span class="badge canceling">Canceling</span>';
    return '<span class="badge active">Active</span>';
  }
  if (sub?.status === 'canceled') return '<span class="badge inactive">Canceled</span>';
  if (sub?.status === 'past_due') return '<span class="badge canceling">Past due</span>';
  if (sub?.status) return `<span class="badge inactive">${esc(sub.status.replace(/_/g, ' '))}</span>`;
  return '<span class="badge inactive">Inactive</span>';
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

async function loadOverview() {
  const data = await api('/api/admin/overview');
  document.getElementById('overviewStats').innerHTML = `
    <div class="admin-stat"><span class="n">${data.totalUsers}</span><span class="l">Users</span></div>
    <div class="admin-stat"><span class="n">${data.activeSubscriptions}</span><span class="l">Active subs</span></div>
    <div class="admin-stat"><span class="n">${data.conversions.total}</span><span class="l">Conversions</span></div>
    <div class="admin-stat"><span class="n">${data.conversions.today}</span><span class="l">Today</span></div>
  `;

  const formats = data.topFormats || [];
  document.getElementById('formatStats').innerHTML = formats.length
    ? `<table class="inv-table admin-table">
        <thead><tr><th>Route</th><th>Count</th></tr></thead>
        <tbody>${formats
          .map(
            (f) =>
              `<tr><td class="mono">${esc(f.inputFormat)} → ${esc(f.outputFormat)}</td><td class="mono">${f.count}</td></tr>`
          )
          .join('')}</tbody>
      </table>`
    : '<p class="empty">No conversions logged yet.</p>';
}

async function loadUsers() {
  const q = document.getElementById('userSearch').value.trim();
  const data = await api(`/api/admin/users?q=${encodeURIComponent(q)}`);
  const rows = data.users || [];

  document.getElementById('usersTable').innerHTML = rows.length
    ? `<table class="inv-table admin-table">
        <thead><tr><th>Email</th><th>Joined</th><th>Conversions</th><th></th></tr></thead>
        <tbody>${rows
          .map(
            (u) => `<tr>
              <td>${esc(u.email)}</td>
              <td class="mono">${fmtDate(u.createdAt)}</td>
              <td class="mono">${u.conversionCount}</td>
              <td class="inv-actions"><button type="button" class="btn-dl" data-user="${u.id}">View</button></td>
            </tr>`
          )
          .join('')}</tbody>
      </table>
      <p class="batch-count">${data.total} user${data.total === 1 ? '' : 's'} total</p>`
    : '<p class="empty">No users found.</p>';

  document.querySelectorAll('[data-user]').forEach((btn) => {
    btn.addEventListener('click', () => loadUserDetail(Number(btn.dataset.user)));
  });
}

async function loadUserDetail(userId) {
  selectedUserId = userId;
  const el = document.getElementById('userDetail');
  el.hidden = false;
  el.innerHTML = '<p class="empty">Loading user…</p>';

  const data = await api(`/api/admin/users/${userId}`);
  const u = data.user;
  const sub = data.subscription;
  const formats = data.formatStats || [];
  const recent = data.recentConversions || [];
  const invoices = data.invoices || [];

  el.innerHTML = `
    <div class="admin-detail-head">
      <div>
        <h2>${esc(u.email)}</h2>
        <p class="file-sub">User #${u.id} · joined ${fmtDate(u.createdAt)} · ${data.conversionCount} conversions</p>
      </div>
      <button type="button" class="btn-ghost" id="closeDetail">Close</button>
    </div>

    <div class="admin-detail-grid">
      <div>
        <h3>Subscription</h3>
        <div class="stat-row"><span class="lab">Status</span><span class="val">${subBadge(sub)}</span></div>
        <div class="stat-row"><span class="lab">Plan</span><span class="val">${esc(sub?.plan || '—')}</span></div>
        <div class="stat-row"><span class="lab">Renews</span><span class="val">${sub?.currentPeriodEnd ? fmtDate(sub.currentPeriodEnd) : '—'}</span></div>
        <div class="sub-btns" style="margin-top:14px">
          <button type="button" class="btn-cancel" id="cancelSubBtn" ${sub?.active ? '' : 'disabled'}>Cancel at period end</button>
          <button type="button" class="btn-cancel" id="cancelSubNowBtn" ${sub?.active ? '' : 'disabled'}>Cancel immediately</button>
        </div>
        <p class="sub-err" id="subActionErr" hidden></p>
      </div>

      <div>
        <h3>Reset password</h3>
        <form id="resetPwForm" class="password-form">
          <div class="field">
            <label for="newPw">New password</label>
            <input type="password" id="newPw" minlength="8" required autocomplete="new-password">
          </div>
          <button type="submit" class="btn" style="width:auto;padding:10px 18px">Set password</button>
        </form>
        <p class="sub-err" id="pwErr" hidden></p>
        <p class="ok" id="pwOk" hidden>Password updated.</p>
      </div>
    </div>

    <h3 style="margin-top:22px">Conversions by format</h3>
    ${
      formats.length
        ? `<table class="inv-table admin-table">
            <thead><tr><th>Route</th><th>Mode</th><th>Count</th></tr></thead>
            <tbody>${formats
              .map(
                (f) =>
                  `<tr><td class="mono">${esc(f.inputFormat)} → ${esc(f.outputFormat)}</td><td><span class="mode-badge ${f.mode}">${f.mode}</span></td><td class="mono">${f.count}</td></tr>`
              )
              .join('')}</tbody>
          </table>`
        : '<p class="empty">No conversions recorded for this user.</p>'
    }

    <h3 style="margin-top:22px">Recent conversions</h3>
    ${
      recent.length
        ? `<table class="inv-table admin-table">
            <thead><tr><th>When</th><th>Route</th><th>Mode</th><th>Library</th></tr></thead>
            <tbody>${recent
              .map(
                (r) =>
                  `<tr><td class="mono">${fmtDate(r.createdAt)}</td><td class="mono">${esc(r.inputFormat)} → ${esc(r.outputFormat)}</td><td><span class="mode-badge ${r.mode}">${r.mode}</span></td><td>${r.savedToLibrary ? 'Yes' : '—'}</td></tr>`
              )
              .join('')}</tbody>
          </table>`
        : '<p class="empty">No recent activity.</p>'
    }

    <h3 style="margin-top:22px">Payments</h3>
    ${
      invoices.length
        ? `<table class="inv-table admin-table">
            <thead><tr><th>Date</th><th>Amount</th><th>Status</th><th></th></tr></thead>
            <tbody>${invoices
              .map(
                (inv) =>
                  `<tr>
                    <td class="mono">${fmtDate(inv.date)}</td>
                    <td class="mono">${fmtMoney(inv.amount, inv.currency)}</td>
                    <td><span class="status ${esc(inv.status)}">${esc(inv.status)}</span></td>
                    <td class="inv-actions">${inv.pdfUrl ? `<a class="btn-dl" href="${esc(inv.pdfUrl)}" target="_blank" rel="noopener">PDF</a>` : ''}</td>
                  </tr>`
              )
              .join('')}</tbody>
          </table>`
        : '<p class="empty">No invoices for this customer.</p>'
    }

    <div class="admin-danger" style="margin-top:28px">
      <h3>Delete account</h3>
      <p class="lead" style="font-size:14px;margin-top:8px">Permanently removes the user, their library files, and conversion history. Optionally cancels their Stripe subscription first.</p>
      <label class="batch-check" style="margin:14px 0">
        <input type="checkbox" id="deleteCancelStripe" checked>
        Cancel Stripe subscription when deleting
      </label>
      <button type="button" class="btn-cancel" id="deleteUserBtn">Delete account</button>
      <p class="sub-err" id="deleteErr" hidden></p>
    </div>
  `;

  document.getElementById('closeDetail').onclick = () => {
    el.hidden = true;
    selectedUserId = null;
  };

  document.getElementById('cancelSubBtn').onclick = () => cancelSub(false);
  document.getElementById('cancelSubNowBtn').onclick = () => cancelSub(true);

  document.getElementById('resetPwForm').onsubmit = async (e) => {
    e.preventDefault();
    const pwErr = document.getElementById('pwErr');
    const pwOk = document.getElementById('pwOk');
    pwErr.hidden = true;
    pwOk.hidden = true;
    try {
      await api(`/api/admin/users/${userId}/password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ newPassword: document.getElementById('newPw').value }),
      });
      pwOk.hidden = false;
      e.target.reset();
    } catch (err) {
      pwErr.textContent = err.message;
      pwErr.hidden = false;
    }
  };

  document.getElementById('deleteUserBtn').onclick = async () => {
    if (!confirm(`Delete ${u.email}? This cannot be undone.`)) return;
    const deleteErr = document.getElementById('deleteErr');
    deleteErr.hidden = true;
    try {
      await api(`/api/admin/users/${userId}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cancelStripe: document.getElementById('deleteCancelStripe').checked }),
      });
      el.hidden = true;
      selectedUserId = null;
      await loadUsers();
      await loadOverview();
    } catch (err) {
      deleteErr.textContent = err.message;
      deleteErr.hidden = false;
    }
  };

  async function cancelSub(immediate) {
    const subActionErr = document.getElementById('subActionErr');
    subActionErr.hidden = true;
    const label = immediate ? 'cancel this subscription immediately' : 'cancel at period end';
    if (!confirm(`Are you sure you want to ${label}?`)) return;
    try {
      await api(`/api/admin/users/${userId}/cancel-subscription`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ immediate }),
      });
      await loadUserDetail(userId);
    } catch (err) {
      subActionErr.textContent = err.message;
      subActionErr.hidden = false;
    }
  }
}

async function loadPayments() {
  const el = document.getElementById('paymentsTable');
  el.innerHTML = '<p class="empty">Loading…</p>';
  try {
    const data = await api('/api/admin/payments');
    const rows = data.payments || [];
    el.innerHTML = rows.length
      ? `<table class="inv-table admin-table">
          <thead><tr><th>Date</th><th>User</th><th>Amount</th><th>Status</th><th></th></tr></thead>
          <tbody>${rows
            .map(
              (p) =>
                `<tr>
                  <td class="mono">${fmtDate(p.date)}</td>
                  <td>${esc(p.userEmail || p.customerEmail || '—')}</td>
                  <td class="mono">${fmtMoney(p.amount, p.currency)}</td>
                  <td><span class="status ${esc(p.status)}">${esc(p.status)}</span></td>
                  <td class="inv-actions">${p.pdfUrl ? `<a class="btn-dl" href="${esc(p.pdfUrl)}" target="_blank" rel="noopener">PDF</a>` : ''}</td>
                </tr>`
            )
            .join('')}</tbody>
        </table>`
      : '<p class="empty">No payments found.</p>';
  } catch (err) {
    el.innerHTML = `<p class="empty">${esc(err.message)}</p>`;
  }
}

function switchTab(tab) {
  document.querySelectorAll('.admin-tab').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  document.querySelectorAll('.admin-section').forEach((s) => {
    s.hidden = s.id !== `tab-${tab}`;
  });
  if (tab === 'overview') loadOverview();
  if (tab === 'users') loadUsers();
  if (tab === 'payments') loadPayments();
}

document.querySelectorAll('.admin-tab').forEach((btn) => {
  btn.addEventListener('click', () => switchTab(btn.dataset.tab));
});

document.getElementById('userSearch').addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(loadUsers, 300);
});
document.getElementById('refreshUsers').addEventListener('click', loadUsers);

(async () => {
  try {
    if (!(await ensureAdmin())) return;
    await loadOverview();
  } catch {
    window.location.replace('/');
  }
})();
