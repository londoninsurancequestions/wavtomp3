const PURCHASE_VALUE = 9.99;
const PURCHASE_CURRENCY = 'USD';

export function trackPurchaseConversion(transactionId) {
  if (!transactionId || typeof gtag !== 'function') return;

  const key = `ga_purchase_${transactionId}`;
  try {
    if (sessionStorage.getItem(key)) return;
    sessionStorage.setItem(key, '1');
  } catch {
    // sessionStorage unavailable
  }

  gtag('event', 'purchase', {
    transaction_id: transactionId,
    value: PURCHASE_VALUE,
    currency: PURCHASE_CURRENCY,
    items: [
      {
        item_id: 'lifetime_unlock',
        item_name: 'Lifetime unlock',
        price: PURCHASE_VALUE,
        quantity: 1,
      },
    ],
  });
}
