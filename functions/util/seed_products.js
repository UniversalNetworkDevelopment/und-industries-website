const fs = require('fs');
const devVars = fs.readFileSync('../../.dev.vars', 'utf8');
devVars.split('\n').forEach(line => {
  const [k, v] = line.split('=');
  if (k && v) process.env[k.trim()] = v.trim();
});
const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

const SERVICES = {
    quick:   { slug: 'website-fix-quick',    name: 'Website Quick Fix',    cents:  9900 },
    bundle:  { slug: 'website-fix-bundle',   name: 'Website Fix Bundle',   cents: 19900 },
    cleanup: { slug: 'website-fix-cleanup',  name: 'Website Full Cleanup', cents: 34900 },
    shopify_quick: { slug: 'shopify-quick-cleanup', name: 'Shopify Quick Cleanup', cents: 14900 },
    shopify_pro:   { slug: 'shopify-pro-upgrade',   name: 'Shopify Professionalization', cents: 29900 },
    shopify_drop:  { slug: 'shopify-dropshipping',  name: 'Dropshipping Integration', cents: 24900 },
    shopify_custom: { slug: 'shopify-custom-upgrade', name: 'Custom Shopify Upgrade', cents: 49900 },
    auto_start:    { slug: 'auto-starter', name: 'Starter Automation', cents: 19900 },
    auto_adv:      { slug: 'auto-advanced', name: 'Advanced Automation', cents: 39900 },
    seo:           { slug: 'seo-overhaul', name: 'SEO Overhaul', cents: 24900 },
    consulting:    { slug: 'consulting-session', name: 'Consulting Session', cents: 14900 }
};

async function rpc(method, params) {
  const res = await fetch(`${url}/rest/v1/rpc/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}`, 'apikey': key },
    body: JSON.stringify(params)
  });
  return res.ok;
}

async function upsert(table, data) {
  const res = await fetch(`${url}/rest/v1/${table}?on_conflict=slug`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}`, 'apikey': key, 'Prefer': 'resolution=merge-duplicates' },
    body: JSON.stringify(data)
  });
  if (!res.ok) throw new Error(await res.text());
}

async function run() {
    console.log('Dropping store_products_type_check constraint if exists (Rule 57)...');
    await rpc('exec_sql', { query: 'ALTER TABLE store_products DROP CONSTRAINT IF EXISTS store_products_type_check;' }).catch(() => {});
    
    console.log('Seeding products...');
    const products = Object.values(SERVICES).map(s => ({
        slug: s.slug,
        name: s.name,
        short_description: s.name + ' Service',
        price_cents: s.cents,
        type: 'product',
        active: true
    }));

    for (const p of products) {
        try {
            await upsert('store_products', p);
            console.log(`Successfully synced ${p.slug}`);
        } catch (err) {
            console.error(`Error inserting ${p.slug}:`, err.message);
        }
    }
    console.log('Done syncing.');
}

run();
