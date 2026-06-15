const fs = require('fs');
const path = require('path');

// Parse .dev.vars
const varsPath = path.join(__dirname, '.dev.vars');
const envVars = fs.readFileSync(varsPath, 'utf8').split('\n').reduce((acc, line) => {
  const [key, ...val] = line.split('=');
  if (key && val) acc[key.trim()] = val.join('=').trim();
  return acc;
}, {});

async function run() {
  const payload = {
    user_id: '00000000-0000-0000-0000-000000000000', // Fake UUID
    service_slug: 'quick',
    service_name: 'Quick Fix Test',
    status: 'paid',
    amount_cents: 9900,
    detail: { source: 'cart_checkout', testing: true }
  };

  const res = await fetch(envVars.SUPABASE_URL + '/rest/v1/service_tickets', {
    method: 'POST',
    headers: {
      'apikey': envVars.SUPABASE_SERVICE_ROLE_KEY,
      'Authorization': 'Bearer ' + envVars.SUPABASE_SERVICE_ROLE_KEY,
      'Content-Type': 'application/json',
      'Prefer': 'return=representation'
    },
    body: JSON.stringify(payload)
  });

  if (!res.ok) {
    const text = await res.text();
    console.error('Error inserting test ticket:', res.status, text);
  } else {
    const data = await res.json();
    console.log('Inserted test ticket successfully:', data);
  }
}
run();
