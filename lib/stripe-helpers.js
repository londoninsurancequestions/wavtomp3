export async function getCustomerSubscription(stripe, customerId) {
  if (!stripe || !customerId) return null;
  const subs = await stripe.subscriptions.list({
    customer: customerId,
    status: 'all',
    limit: 5,
    expand: ['data.items.data.price'],
  });
  return (
    subs.data.find((s) => s.status === 'active' || s.status === 'trialing') || null
  );
}

export async function hasActiveSubscription(stripe, customerId) {
  const sub = await getCustomerSubscription(stripe, customerId);
  return !!sub;
}

export function subscriptionToSummary(sub) {
  if (!sub) return { active: false };

  const price = sub.items?.data?.[0]?.price;
  const interval = price?.recurring?.interval;
  const amount = price?.unit_amount;

  return {
    active: sub.status === 'active' || sub.status === 'trialing',
    status: sub.status,
    plan: interval === 'year' ? 'Annual' : interval === 'month' ? 'Monthly' : 'Subscription',
    amount: amount ? amount / 100 : null,
    currency: price?.currency?.toUpperCase() || 'USD',
    currentPeriodEnd: sub.current_period_end
      ? new Date(sub.current_period_end * 1000).toISOString()
      : null,
    cancelAtPeriodEnd: sub.cancel_at_period_end,
  };
}

export async function getSubscriptionSummary(stripe, customerId) {
  if (!stripe || !customerId) return null;
  return subscriptionToSummary(await getCustomerSubscription(stripe, customerId));
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
  const session = await stripe.checkout.sessions.retrieve(sessionId);
  if (session.payment_status !== 'paid') {
    return { error: 'Payment not completed for this session' };
  }

  const customerId =
    typeof session.customer === 'string' ? session.customer : session.customer?.id;

  if (!customerId) {
    return { error: 'No customer found for this checkout' };
  }

  const active = await hasActiveSubscription(stripe, customerId);
  if (!active) {
    return { error: 'No active subscription found for this payment' };
  }

  let email = session.customer_details?.email || session.customer_email || null;
  if (!email) {
    const customer = await stripe.customers.retrieve(customerId);
    if (!customer.deleted) {
      email = customer.email;
    }
  }

  return { sessionId, customerId, email, active: true };
}

export async function findStripeCustomerByEmail(stripe, email) {
  const customers = await stripe.customers.list({ email, limit: 1 });
  const customer = customers.data[0];
  if (!customer) return null;

  const active = await hasActiveSubscription(stripe, customer.id);
  if (!active) return null;

  return { customerId: customer.id, email: customer.email };
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
