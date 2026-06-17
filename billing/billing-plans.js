'use strict';
/**
 * billing-plans.js — UND Industries Service & Maintenance Plan Definitions
 * Single source of truth for all recurring and one-time billing products.
 * Used by: Stripe product seeding, services.html, Qwep job dispatch, Nexus dashboard.
 *
 * RECURRING PLANS (Stripe Subscriptions → invoice.paid → Qwep auto-dispatch)
 * ONE-TIME SERVICES (Stripe PaymentIntent → payment_intent.succeeded → Qwep job)
 *
 * Rule 26.5: All services must have payment architecture fully wired before enabling.
 * Rule 141: Store Freeze Law — do NOT enable checkout until Qwep fulfillment is live.
 */

const PLANS = {

  // ══════════════════════════════════════════════════════
  // RECURRING — Monthly Maintenance Plans
  // These are the base revenue layer. Cover operating costs.
  // Stripe: create as Products with Price (recurring, monthly)
  // ══════════════════════════════════════════════════════

  maintenance_basic: {
    slug:         'maintenance_basic',
    type:         'recurring',
    name:         'Basic Maintenance',
    tagline:      'Keep your site alive and secure',
    price_usd:    49,
    interval:     'month',
    stripe_price_id: null,        // fill after Stripe product creation
    features: [
      'Uptime monitoring (99.9% SLA)',
      'Monthly security patches',
      'Plugin/dependency updates',
      'Monthly health report',
      'Email support (48h response)',
    ],
    qwep_job_type:  'MAINTENANCE_BASIC',
    sla_hours:      48,
    active:         false,        // FROZEN — enable when Qwep is live
  },

  maintenance_standard: {
    slug:         'maintenance_standard',
    type:         'recurring',
    name:         'Standard Maintenance',
    tagline:      'Proactive care + minor improvements',
    price_usd:    99,
    interval:     'month',
    stripe_price_id: null,
    features: [
      'Everything in Basic',
      'Speed optimization (Core Web Vitals)',
      'Up to 2 content updates/month',
      'Broken link & error monitoring',
      'Priority email support (24h response)',
      'Monthly performance report',
    ],
    qwep_job_type:  'MAINTENANCE_STANDARD',
    sla_hours:      24,
    active:         false,
  },

  maintenance_premium: {
    slug:         'maintenance_premium',
    type:         'recurring',
    name:         'Premium Maintenance',
    tagline:      'Full-service care with priority access',
    price_usd:    199,
    interval:     'month',
    stripe_price_id: null,
    features: [
      'Everything in Standard',
      'Up to 5 content updates/month',
      'Emergency response (4h SLA)',
      'Monthly strategy call (30 min)',
      'A/B test monitoring',
      'Full backup + restore service',
      'Dedicated Slack channel',
    ],
    qwep_job_type:  'MAINTENANCE_PREMIUM',
    sla_hours:      4,
    active:         false,
  },

  shopify_retainer: {
    slug:         'shopify_retainer',
    type:         'recurring',
    name:         'Shopify Monthly Retainer',
    tagline:      'Ongoing Shopify store management',
    price_usd:    149,
    interval:     'month',
    stripe_price_id: null,
    features: [
      'Product listings management (up to 20/mo)',
      'Theme updates and fixes',
      'App configuration',
      'Conversion rate monitoring',
      'Monthly analytics report',
      '24h priority support',
    ],
    qwep_job_type:  'SHOPIFY_RETAINER',
    sla_hours:      24,
    active:         false,
  },

  automation_retainer: {
    slug:         'automation_retainer',
    type:         'recurring',
    name:         'Automation Retainer',
    tagline:      'Keep your automations running and evolving',
    price_usd:    299,
    interval:     'month',
    stripe_price_id: null,
    features: [
      'Workflow monitoring and maintenance',
      'Up to 2 automation improvements/month',
      'Integration health checks',
      'Error alerts and auto-remediation',
      'Monthly usage report',
      'Priority support (12h SLA)',
    ],
    qwep_job_type:  'AUTOMATION_RETAINER',
    sla_hours:      12,
    active:         false,
  },

  // ══════════════════════════════════════════════════════
  // ONE-TIME SERVICES
  // Stripe: PaymentIntent. Qwep dispatches on payment confirmed.
  // Stripe 2-5 day hold = fulfillment window. Use it.
  // ══════════════════════════════════════════════════════

  website_starter: {
    slug:         'website_starter',
    type:         'one_time',
    name:         'Starter Website',
    tagline:      'Professional site, fast turnaround',
    price_usd:    499,
    stripe_price_id: null,
    features: [
      '5-page responsive website',
      'Mobile-first design',
      'Contact form + analytics',
      '1 revision round',
      '14-day delivery',
    ],
    qwep_job_type:  'WEBSITE_STARTER',
    sla_hours:      336,   // 14 days
    active:         false,
  },

  website_professional: {
    slug:         'website_professional',
    type:         'one_time',
    name:         'Professional Website',
    tagline:      'Full-featured site built to convert',
    price_usd:    999,
    stripe_price_id: null,
    features: [
      'Up to 10 pages',
      'Custom design system',
      'CMS integration',
      'SEO foundation setup',
      '2 revision rounds',
      '21-day delivery',
    ],
    qwep_job_type:  'WEBSITE_PROFESSIONAL',
    sla_hours:      504,   // 21 days
    active:         false,
  },

  shopify_setup: {
    slug:         'shopify_setup',
    type:         'one_time',
    name:         'Shopify Store Setup',
    tagline:      'Launch-ready Shopify store',
    price_usd:    799,
    stripe_price_id: null,
    features: [
      'Theme customization',
      'Up to 25 products loaded',
      'Payment + shipping configured',
      'App setup (email, reviews, etc.)',
      'SEO optimization',
      '14-day delivery',
    ],
    qwep_job_type:  'SHOPIFY_SETUP',
    sla_hours:      336,
    active:         false,
  },

  automation_custom: {
    slug:         'automation_custom',
    type:         'one_time',
    name:         'Custom Automation Build',
    tagline:      'Custom workflow built for your business',
    price_usd:    599,
    stripe_price_id: null,
    features: [
      'Requirements discovery call',
      'Custom workflow design + build',
      'Integration with your existing tools',
      'Testing + documentation',
      '10-day delivery',
    ],
    qwep_job_type:  'AUTOMATION_CUSTOM',
    sla_hours:      240,   // 10 days
    active:         false,
  },
};

// Helper: get all active plans (for checkout — when Qwep is live, flip active: true)
function getActivePlans() {
  return Object.values(PLANS).filter(p => p.active);
}

// Helper: get all recurring plans (for subscription page)
function getRecurringPlans() {
  return Object.values(PLANS).filter(p => p.type === 'recurring');
}

// Helper: get all one-time plans
function getOneTimePlans() {
  return Object.values(PLANS).filter(p => p.type === 'one_time');
}

// Helper: get plan by slug (used by Stripe webhook handler and Qwep intake)
function getPlan(slug) {
  return PLANS[slug] || null;
}

// Helper: get qwep_job_type from stripe product metadata slug
function getJobTypeForSlug(slug) {
  const plan = PLANS[slug];
  return plan ? plan.qwep_job_type : null;
}

// Revenue projection at full capacity (for planning)
function _projectedMRR() {
  const recurring = getRecurringPlans();
  return recurring.reduce((sum, p) => sum + p.price_usd, 0);
}

module.exports = {
  PLANS,
  getActivePlans,
  getRecurringPlans,
  getOneTimePlans,
  getPlan,
  getJobTypeForSlug,
};
