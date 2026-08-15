// devices.js — Client Device Management UI
(function() {
  'use strict';

  var rootEl = document.getElementById('devices-root');
  if (!rootEl) return;

  // Mock / Initial Device State (rendered if user is logged in or for demonstration)
  var sampleDevices = [
    {
      device_id: "3b08576ce99a9164dbbe2f462c05a0350234835c24c9b4983c1dc485bd8f79a6",
      name: "Workstation-Legion5 (Primary)",
      os: "Windows 11 NT 10.0.22631",
      status: "attested",
      attestation: "TPM 2.0 Hardware Attested",
      last_sync: "2026-08-15 19:10:00 UTC",
      offline_allowance: "30 Days (28 Days Remaining)"
    },
    {
      device_id: "7f90112ab88c9164dbbe2f462c05a0350234835c24c9b4983c1dc485bd8f79ff",
      name: "Studio-Laptop (Secondary)",
      os: "macOS Sonoma 14.5",
      status: "manual",
      attestation: "Manual Verification (Legacy)",
      last_sync: "2026-08-14 11:20:00 UTC",
      offline_allowance: "7 Days (5 Days Remaining)"
    }
  ];

  function renderDevices(devices) {
    if (!devices || devices.length === 0) {
      rootEl.innerHTML = '<p style="color:#9ca3af;">No active devices enrolled. Devices automatically register when launching UND Studio AI or RemiAI.</p>';
      return;
    }

    var html = '';
    devices.forEach(function(dev, idx) {
      html += '<div class="dev-card" id="dev-card-' + idx + '">' +
        '<div class="dev-header">' +
          '<div>' +
            '<span class="dev-name">' + dev.name + '</span>' +
          '</div>' +
          '<span class="dev-status ' + dev.status + '">' + dev.status + '</span>' +
        '</div>' +
        '<div class="dev-grid">' +
          '<div><span class="dev-label">Device SHA-256 ID</span><span class="dev-val">' + dev.device_id.slice(0, 16) + '...</span></div>' +
          '<div><span class="dev-label">Operating System</span><span class="dev-val">' + dev.os + '</span></div>' +
          '<div><span class="dev-label">Attestation Level</span><span class="dev-val">' + dev.attestation + '</span></div>' +
          '<div><span class="dev-label">Offline Grant</span><span class="dev-val">' + dev.offline_allowance + '</span></div>' +
        '</div>' +
        '<div style="margin-top:1.25rem; text-align:right;">' +
          '<button class="btn btn-outline btn-sm" onclick="revokeDevice(' + idx + ')" style="border-color:#ef4444; color:#f87171;">Revoke Device Seat</button>' +
        '</div>' +
      '</div>';
    });

    rootEl.innerHTML = html;
  }

  window.revokeDevice = function(idx) {
    if (confirm('Are you sure you want to revoke this device? Software on this machine will lose license authorization on next sync.')) {
      sampleDevices.splice(idx, 1);
      renderDevices(sampleDevices);
      alert('Device seat revoked successfully.');
    }
  };

  renderDevices(sampleDevices);
})();
