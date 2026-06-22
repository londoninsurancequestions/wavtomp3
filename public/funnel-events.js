export function trackFunnelEvent(event) {
  return fetch('/api/events/funnel', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ event }),
  }).catch(() => {});
}
