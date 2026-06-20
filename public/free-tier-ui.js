const UNLOCK_PRICE_LINE = '$9.99 · unlimited conversions';

const state = {
  freeTier: null,
  subscriptionActive: false,
};

let tickTimer = null;

function nextUtcMidnightMs() {
  const d = new Date();
  d.setUTCHours(24, 0, 0, 0);
  return d.getTime();
}

function resetTargetMs() {
  const iso = state.freeTier?.resetsAt;
  if (iso) {
    const t = Date.parse(iso);
    if (!Number.isNaN(t)) return t;
  }
  return nextUtcMidnightMs();
}

function formatCountdown(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return [h, m, s].map((n) => String(n).padStart(2, '0')).join(':');
}

function shouldShowPromo() {
  return !state.subscriptionActive && !state.freeTier?.unlimited;
}

function stopTicking() {
  if (!tickTimer) return;
  clearInterval(tickTimer);
  tickTimer = null;
}

function shouldShowFreeTierUi() {
  return shouldShowPromo() && (state.freeTier?.remaining ?? 0) <= 0;
}

function isQuotaExhausted() {
  return shouldShowFreeTierUi();
}

function bannerCopy() {
  const limit = state.freeTier?.limit ?? 5;
  return {
    eyebrow: 'Daily free limit reached',
    sub: `until your ${limit} free conversions return`,
  };
}

function modalCopy() {
  const limit = state.freeTier?.limit ?? 5;
  return {
    label: 'Your free conversions return in',
    sub: `You've used all ${limit} free full exports for today. Unlock now for unlimited conversions — no waiting.`,
  };
}

function setTimerText(el, ms) {
  if (el) el.textContent = formatCountdown(ms);
}

function syncBannerHeight() {
  const banner = document.getElementById('freeTierBanner');
  const height =
    banner && !banner.hidden ? `${banner.getBoundingClientRect().height}px` : '0px';
  document.documentElement.style.setProperty('--free-tier-banner-height', height);
}

function updateBanner() {
  const banner = document.getElementById('freeTierBanner');
  if (!banner) return;

  if (!shouldShowFreeTierUi()) {
    banner.hidden = true;
    document.body.classList.remove('has-free-tier-banner');
    syncBannerHeight();
    return;
  }

  banner.hidden = false;
  document.body.classList.add('has-free-tier-banner');

  const copy = bannerCopy();
  const eyebrow = document.getElementById('freeTierBannerEyebrow');
  const sub = document.getElementById('freeTierBannerSub');
  if (eyebrow) eyebrow.textContent = copy.eyebrow;
  if (sub) sub.textContent = copy.sub;

  const ms = resetTargetMs() - Date.now();
  setTimerText(document.getElementById('freeTierBannerTimer'), ms);
  requestAnimationFrame(syncBannerHeight);
}

function updateModalUrgency() {
  const block = document.getElementById('modalUrgency');
  const modal = document.querySelector('.modal-unlock');
  if (!block) return;

  if (!shouldShowFreeTierUi() || !document.getElementById('overlay')?.classList.contains('show')) {
    block.hidden = true;
    modal?.classList.remove('has-urgency');
    return;
  }

  block.hidden = false;
  modal?.classList.add('has-urgency');

  const copy = modalCopy();
  const label = document.getElementById('modalUrgencyLabel');
  const sub = document.getElementById('modalUrgencySub');
  if (label) label.textContent = copy.label;
  if (sub) sub.textContent = copy.sub;

  const ms = resetTargetMs() - Date.now();
  setTimerText(document.getElementById('modalUrgencyTimer'), ms);

  const heroPrice = document.getElementById('modalUrgencyPrice');
  if (heroPrice) heroPrice.textContent = UNLOCK_PRICE_LINE;
}

function tick() {
  if (!shouldShowFreeTierUi()) return;
  const ms = resetTargetMs() - Date.now();
  setTimerText(document.getElementById('freeTierBannerTimer'), ms);
  setTimerText(document.getElementById('modalUrgencyTimer'), ms);
}

function startTicking() {
  if (tickTimer) return;
  tick();
  tickTimer = window.setInterval(tick, 1000);
}

function applyState(freeTier, subscriptionActive) {
  if (freeTier) state.freeTier = freeTier;
  state.subscriptionActive = !!subscriptionActive;
  updateBanner();
  updateModalUrgency();
  if (shouldShowFreeTierUi()) startTicking();
  else stopTicking();
}

async function fetchStatus() {
  try {
    const meRes = await fetch('/api/auth/me', { credentials: 'include' });
    if (meRes.ok) {
      const me = await meRes.json();
      if (me.user) {
        applyState(me.freeTier, me.subscriptionActive);
        return;
      }
    }
  } catch {
    // fall through
  }

  try {
    const res = await fetch('/api/free-tier', { credentials: 'include' });
    if (res.ok) applyState(await res.json(), false);
  } catch {
    // ignore
  }
}

window.startUnlockCheckout = async function startUnlockCheckout() {
  if (typeof window.goToStripeCheckout === 'function') {
    return window.goToStripeCheckout();
  }

  const returnTo = window.location.pathname + window.location.search;

  try {
    const res = await fetch('/api/create-checkout-session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ returnTo }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Checkout unavailable');
    }
    const { url } = await res.json();
    if (url) {
      window.location.href = url;
      return;
    }
    throw new Error('No checkout URL returned');
  } catch (err) {
    console.error('Checkout error:', err);
    alert(err.message || 'Could not start checkout. Please try again.');
  }
};

window.syncFreeTierUi = function syncFreeTierUi(freeTier, subscriptionActive) {
  applyState(freeTier, subscriptionActive);
};

window.refreshUnlockModalUrgency = function refreshUnlockModalUrgency() {
  updateModalUrgency();
};

document.addEventListener('free-tier-update', (e) => {
  const { freeTier, subscriptionActive } = e.detail || {};
  window.syncFreeTierUi(freeTier, subscriptionActive);
});

function bindCtas() {
  document.getElementById('freeTierBannerCta')?.addEventListener('click', () => {
    if (
      typeof window.openUnlockModal === 'function' &&
      document.getElementById('overlay') &&
      typeof window.hasLockedConversions === 'function' &&
      window.hasLockedConversions()
    ) {
      window.openUnlockModal('all');
      return;
    }
    window.startUnlockCheckout();
  });

  document.getElementById('modalUrgencyCta')?.addEventListener('click', () => {
    if (typeof window.goToStripeCheckout === 'function') {
      window.goToStripeCheckout();
    } else {
      window.startUnlockCheckout();
    }
  });
}

const overlay = document.getElementById('overlay');
if (overlay) {
  new MutationObserver(() => updateModalUrgency()).observe(overlay, {
    attributes: true,
    attributeFilter: ['class'],
  });
}

bindCtas();
window.addEventListener('resize', syncBannerHeight);
fetchStatus().then(() => {
  if (shouldShowFreeTierUi()) startTicking();
  else stopTicking();
});
