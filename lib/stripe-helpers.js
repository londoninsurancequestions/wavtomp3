const ACCESS_STATUSES = new Set(['active', 'trialing', 'past_due']);

export const UNLOCK_AMOUNT_USD = 9.99;

function subscriptionPeriodEnd(sub) {
  if (sub.current_period_end) return sub.current_period_end;
  const items = sub.items?.data || [];
  let max = 0;
  for (const item of items) {
    if (item.current_period_end > max) max = item.current_period_end;
  }
  return max || null;
}

export function getUnlockPriceId() {
  return process.env.STRIPE_PRICE_UNLOCK || process.env.STRIPE_PRICE_MONTHLY || null;
}

export function lifetimeAccessSummary() {
  return {
    active: true,
    status: 'active',
    plan: 'Lifetime',
    amount: UNLOCK_AMOUNT_USD,
    currency: 'USD',
    currentPeriodEnd: null,
    cancelAtPeriodEnd: false,
    lifetime: true,
  };
}

export async function listStripeCustomersByEmail(stripe, email) {
  if (!stripe || !email) return [];
  const customers = await stripe.customers.list({ email, limit: 100 });
  return customers.data;
}

export async function getLatestCustomerSubscription(stripe, customerId) {
  if (!stripe || !customerId) return null;
  const subs = await stripe.subscriptions.list({
    customer: customerId,
    status: 'all',
    limit: 1,
    expand: ['data.items.data.price'],
  });
  return subs.data[0] || null;
}

export async function getCustomerSubscription(stripe, customerId) {
  if (!stripe || !customerId) return null;
  const subs = await stripe.subscriptions.list({
    customer: customerId,
    status: 'all',
    limit: 10,
    expand: ['data.items.data.price'],
  });
  return subs.data.find((s) => ACCESS_STATUSES.has(s.status)) || null;
}

export async function hasActiveSubscription(stripe, customerId) {
  const sub = await getCustomerSubscription(stripe, customerId);
  return !!sub;
}

export function subscriptionToSummary(sub) {
  if (!sub) return { active: false, lifetime: false };

  const price = sub.items?.data?.[0]?.price;
  const interval = price?.recurring?.interval;
  const amount = price?.unit_amount;
  const periodEnd = subscriptionPeriodEnd(sub);

  return {
    active: ACCESS_STATUSES.has(sub.status),
    status: sub.status,
    plan: interval === 'year' ? 'Annual' : interval === 'month' ? 'Monthly' : 'Subscription',
    amount: amount ? amount / 100 : null,
    currency: price?.currency?.toUpperCase() || 'USD',
    currentPeriodEnd: periodEnd ? new Date(periodEnd * 1000).toISOString() : null,
    cancelAtPeriodEnd: sub.cancel_at_period_end,
    lifetime: false,
  };
}

async function sessionIncludesUnlockPrice(stripe, session, priceId) {
  if (!priceId) return session.mode === 'payment';
  const full =
    session.line_items?.data?.length > 0
      ? session
      : await stripe.checkout.sessions.retrieve(session.id, {
          expand: ['line_items.data.price'],
        });
  return (full.line_items?.data || []).some((li) => li.price?.id === priceId);
}

export async function hasLifetimeUnlock(stripe, customerId) {
  if (!stripe || !customerId) return false;

  const priceId = getUnlockPriceId();
  const sessions = await stripe.checkout.sessions.list({
    customer: customerId,
    status: 'complete',
    limit: 25,
  });

  for (const session of sessions.data) {
    if (session.payment_status !== 'paid' || session.mode !== 'payment') continue;
    if (await sessionIncludesUnlockPrice(stripe, session, priceId)) return true;
  }
  return false;
}

export async function hasPaidAccess(stripe, customerId, { unlockedAt = null } = {}) {
  if (unlockedAt) return true;
  if (!stripe || !customerId) return false;
  if (await hasActiveSubscription(stripe, customerId)) return true;
  return hasLifetimeUnlock(stripe, customerId);
}

export async function getAccessSummary(stripe, customerId, { unlockedAt = null } = {}) {
  if (!stripe || !customerId) {
    return unlockedAt ? lifetimeAccessSummary() : { active: false, lifetime: false };
  }

  if (unlockedAt) return lifetimeAccessSummary();

  const activeSub = await getCustomerSubscription(stripe, customerId);
  if (activeSub) return subscriptionToSummary(activeSub);

  if (await hasLifetimeUnlock(stripe, customerId)) return lifetimeAccessSummary();

  const latest = await getLatestCustomerSubscription(stripe, customerId);
  return subscriptionToSummary(latest) || { active: false, lifetime: false };
}

/** @deprecated Use getAccessSummary */
export async function getSubscriptionSummary(stripe, customerId) {
  return getAccessSummary(stripe, customerId);
}

/** Prefer stored customer; if no access, look for another Stripe customer with the same email. */
export async function resolveUserStripeContext(stripe, user) {
  if (!stripe || !user) {
    return { customerId: user?.stripe_customer_id || null, subscription: null, relinked: false };
  }

  if (user.unlocked_at) {
    return {
      customerId: user.stripe_customer_id || null,
      subscription: lifetimeAccessSummary(),
      relinked: false,
    };
  }

  let customerId = user.stripe_customer_id;
  let subscription = customerId
    ? await getAccessSummary(stripe, customerId, { unlockedAt: user.unlocked_at })
    : null;

  if (!subscription?.active && user.email) {
    const customers = await listStripeCustomersByEmail(stripe, user.email);
    for (const customer of customers) {
      if (customer.id === customerId) continue;
      const alt = await getAccessSummary(stripe, customer.id);
      if (alt?.active) {
        return { customerId: customer.id, subscription: alt, relinked: true };
      }
    }
  }

  return { customerId, subscription, relinked: false };
}

export async function cancelSubscriptionAtPeriodEnd(stripe, customerId) {
  const sub = await getCustomerSubscription(stripe, customerId);
  if (!sub) return { error: 'No active subscription found' };
  if (sub.cancel_at_period_end) {
    return { error: 'Your subscription is already set to cancel' };
  }

  const updated = await stripe.subscriptions.update(sub.id, {
    cancel_at_period_end: true,
    expand: ['items.data.price'],
  });
  return { ok: true, subscription: subscriptionToSummary(updated) };
}

export async function cancelSubscriptionImmediately(stripe, customerId) {
  const sub = await getCustomerSubscription(stripe, customerId);
  if (!sub) return { error: 'No active subscription found' };

  const updated = await stripe.subscriptions.cancel(sub.id, {
    expand: ['items.data.price'],
  });
  return { ok: true, subscription: subscriptionToSummary(updated) };
}

export async function reactivateSubscription(stripe, customerId) {
  const sub = await getCustomerSubscription(stripe, customerId);
  if (!sub) return { error: 'No subscription found' };
  if (!sub.cancel_at_period_end) {
    return { error: 'Your subscription is not scheduled for cancellation' };
  }

  const updated = await stripe.subscriptions.update(sub.id, {
    cancel_at_period_end: false,
    expand: ['items.data.price'],
  });
  return { ok: true, subscription: subscriptionToSummary(updated) };
}

export async function resolvePaidCheckout(stripe, sessionId) {
  const session = await stripe.checkout.sessions.retrieve(sessionId, {
    expand: ['line_items.data.price'],
  });
  if (session.payment_status !== 'paid') {
    return { error: 'Payment not completed for this session' };
  }

  const customerId =
    typeof session.customer === 'string' ? session.customer : session.customer?.id;

  if (!customerId) {
    return { error: 'No customer found for this checkout' };
  }

  let lifetime = false;

  if (session.mode === 'payment') {
    const priceId = getUnlockPriceId();
    if (priceId && !(await sessionIncludesUnlockPrice(stripe, session, priceId))) {
      return { error: 'This checkout session is not a valid unlock purchase' };
    }
    lifetime = true;
  } else if (session.mode === 'subscription') {
    const active = await hasActiveSubscription(stripe, customerId);
    if (!active) {
      return { error: 'No active subscription found for this payment' };
    }
  } else {
    return { error: 'Unsupported checkout type' };
  }

  let email = session.customer_details?.email || session.customer_email || null;
  if (!email) {
    const customer = await stripe.customers.retrieve(customerId);
    if (!customer.deleted) {
      email = customer.email;
    }
  }

  return { sessionId, customerId, email, active: true, lifetime };
}

export async function findStripeCustomerByEmail(stripe, email) {
  const customers = await listStripeCustomersByEmail(stripe, email);
  for (const customer of customers) {
    const active = await hasPaidAccess(stripe, customer.id);
    if (active) {
      return { customerId: customer.id, email: customer.email };
    }
  }
  return null;
}

export async function listCustomerInvoices(stripe, customerId) {
  const invoices = await stripe.invoices.list({
    customer: customerId,
    limit: 24,
  });

  return invoices.data.map((inv) => ({
    id: inv.id,
    number: inv.number,
    date: inv.created,
    amount: inv.amount_paid,
    currency: inv.currency,
    status: inv.status,
    pdfUrl: inv.invoice_pdf,
    hostedUrl: inv.hosted_invoice_url,
  }));
}
