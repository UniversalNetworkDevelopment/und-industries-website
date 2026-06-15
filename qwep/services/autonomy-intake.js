const { createClient } = require("@supabase/supabase-js");
const axios = require("axios");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const envPath = path.join(__dirname, '../../.env');
const envVars = fs.readFileSync(envPath, 'utf8').split('\n').reduce((acc, line) => {
    const [key, ...val] = line.split('=');
    if (key && val) acc[key.trim()] = val.join('=').trim();
    return acc;
}, {});

const supabase = createClient(
  envVars.SUPABASE_URL,
  envVars.SUPABASE_SERVICE_ROLE_KEY
);

const QWEP_API_URL = "http://127.0.0.1:3133/api/jobs";
const POLL_INTERVAL_MS = 10000; // 10 seconds

async function fetchNewTickets() {
  const { data, error } = await supabase
    .from("service_tickets")
    .select("*")
    .eq("status", "paid"); // Looking for paid tickets awaiting intake

  if (error) {
    console.error("[Autonomy][Intake] Supabase error:", error.message);
    return [];
  }

  // Also check for test tickets marked 'ready'
  const { data: testData, error: testError } = await supabase
    .from("service_tickets")
    .select("*")
    .eq("status", "ready")
    .eq("service_slug", "full_website_build_test");

  return [...(data || []), ...(testData || [])];
}

function buildJobPacket(ticket) {
  return {
    job_id: crypto.randomUUID(),
    ticket_id: ticket.ticket_number || ticket.id,
    service_type: ticket.service_slug === 'full_website_build_test' ? 'website' : ticket.service_slug,
    target_repo: ticket.target_repo_name || "web-builder-ai",
    intake: ticket.intake_data || {},
    mode: ticket.service_slug === "full_website_build_test" ? "test" : "live"
  };
}

async function sendJobToQwep(jobPacket) {
  await axios.post(QWEP_API_URL, jobPacket);
  console.log("[Autonomy][Intake] Sent job to Qwep:", jobPacket.job_id);
}

async function markTicketInProgress(ticketId) {
  await supabase
    .from("service_tickets")
    .update({ status: "intake_pending", claimed_by: "qwep_core_1" })
    .eq("ticket_number", ticketId);
}

async function startAutonomousIntakeLoop() {
  console.log("[Autonomy][Intake] Starting intake loop...");

  setInterval(async () => {
    try {
      const tickets = await fetchNewTickets();
      if (!tickets.length) return;

      for (const ticket of tickets) {
        const jobPacket = buildJobPacket(ticket);
        await markTicketInProgress(ticket.ticket_number || ticket.id);
        await sendJobToQwep(jobPacket);
      }
    } catch (e) {
      console.error("[Autonomy][Intake] Loop error:", e.message);
    }
  }, POLL_INTERVAL_MS);
}

module.exports = { startAutonomousIntakeLoop };
