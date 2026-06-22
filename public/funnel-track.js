import { trackFunnelEvent } from '/public/funnel-events.js';

const VISIT_KEY = 'yc_funnel_visit';

export function trackVisitOnce() {
  if (sessionStorage.getItem(VISIT_KEY)) return;
  sessionStorage.setItem(VISIT_KEY, '1');
  trackFunnelEvent('visit');
}

trackVisitOnce();
