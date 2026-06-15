const fs = require('fs');
let css = fs.readFileSync('E:/und-industries-website/docs/assets/css/styles.css', 'utf8');

const overrides = `
/* =========================================================================
   GLOBAL PREMIUM CARD OVERRIDES (UNIFIED AESTHETIC)
   ========================================================================= */
.card, .pillar-card, .stat-card, .music-card, .promo-card, .service-card {
  background: rgba(21, 21, 26, 0.7) !important;
  backdrop-filter: blur(12px) !important;
  -webkit-backdrop-filter: blur(12px) !important;
  border: 1px solid rgba(255,255,255,0.08) !important;
  border-radius: 16px !important;
  overflow: hidden !important;
  transition: transform 0.2s ease, box-shadow 0.2s ease, border-color 0.2s ease !important;
}

.card:hover, .pillar-card:hover, .stat-card:hover, .music-card:hover, .promo-card:hover, .service-card:hover {
  border-color: rgba(124,92,255,0.4) !important;
  transform: translateY(-4px) !important;
  box-shadow: 0 12px 40px rgba(124,92,255,0.15) !important;
}
`;

if (css.indexOf('GLOBAL PREMIUM CARD OVERRIDES') === -1) {
    fs.appendFileSync('E:/und-industries-website/docs/assets/css/styles.css', '\n\n' + overrides);
}
