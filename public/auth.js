const SVG_DL =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3v12m0 0l-4-4m4 4l4-4"/><path d="M5 21h14"/></svg>';

export async function fetchMe() {
  const res = await fetch('/api/auth/me', { credentials: 'include' });
  if (!res.ok) return null;
  return res.json();
}

export async function requireAuth(redirectTo = '/login.html') {
  const me = await fetchMe();
  if (!me?.user) {
    const next = encodeURIComponent(window.location.pathname + window.location.search);
    window.location.href = `${redirectTo}?next=${next}`;
    return null;
  }
  return me;
}

export function formatMoney(cents, currency = 'USD') {
  if (cents == null) return '—';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currency.toUpperCase(),
  }).format(cents / 100);
}

export function formatDate(unixOrIso) {
  const d = typeof unixOrIso === 'number' ? new Date(unixOrIso * 1000) : new Date(unixOrIso);
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

export function formatDateTime(iso) {
  const d = new Date(iso);
  return d.toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function formatBytes(bytes) {
  if (!bytes) return '—';
  if (bytes > 1e9) return (bytes / 1e9).toFixed(2) + ' GB';
  if (bytes > 1e6) return (bytes / 1e6).toFixed(1) + ' MB';
  if (bytes > 1e3) return (bytes / 1e3).toFixed(0) + ' KB';
  return bytes + ' B';
}

export function showError(el, message) {
  if (!el) return;
  el.textContent = message;
  el.hidden = !message;
}

export function setLoading(btn, loading, label) {
  if (!btn) return;
  btn.disabled = loading;
  btn.dataset.label = btn.dataset.label || btn.textContent;
  btn.textContent = loading ? 'Please wait…' : label || btn.dataset.label;
}

export function renderInvoices(container, invoices) {
  if (!invoices?.length) {
    container.innerHTML =
      '<p class="empty">No invoices yet. Your first invoice will appear here after billing.</p>';
    return;
  }

  container.innerHTML = `
    <table class="inv-table">
      <thead>
        <tr>
          <th>Invoice</th>
          <th>Date</th>
          <th>Amount</th>
          <th>Status</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        ${invoices
          .map(
            (inv) => `
          <tr>
            <td class="inv-num">${inv.number || inv.id.slice(-8)}</td>
            <td>${formatDate(inv.date)}</td>
            <td>${formatMoney(inv.amount, inv.currency)}</td>
            <td><span class="status ${inv.status}">${inv.status}</span></td>
            <td class="inv-actions">
              ${
                inv.pdfUrl
                  ? `<a class="btn-dl" href="${inv.pdfUrl}" target="_blank" rel="noopener">${SVG_DL} PDF</a>`
                  : inv.hostedUrl
                    ? `<a class="btn-dl" href="${inv.hostedUrl}" target="_blank" rel="noopener">View</a>`
                    : '—'
              }
            </td>
          </tr>`
          )
          .join('')}
      </tbody>
    </table>`;
}

export async function logout() {
  await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
  window.location.href = '/';
}
