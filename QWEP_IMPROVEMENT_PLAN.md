# QWEP IMPROVEMENT PLAN

## 1. Design & UX Improvements
- **Animation Easing:** Update Qwep's base CSS templates to mandate `cubic-bezier` easing for all transitions and animations to ensure a premium feel.
- **Mobile Nav Fix:** Explicitly instruct Qwep to apply `z-index` layering correctly to prevent background elements from overlapping mobile navigation.
- **Typography:** Implement a fluid typography system using `clamp()` instead of static media query breakpoints for smoother scaling.

## 2. Code Structure Improvements
- **Performance:** Enforce the use of `requestAnimationFrame` or `IntersectionObserver` for all scroll-based JS animations instead of raw scroll event listeners.
- **Lazy Loading:** Add a strict rule to Qwep's SOP: All images below the fold MUST include `loading="lazy"`.

## 3. Logging & Evidence Improvements
- **Atomic Commits:** Update the Test Mode SOP to force Qwep to make at least 3 distinct commits during a full build (e.g., "Scaffold structure", "Apply styles", "Add interactions") to generate a richer audit trail.
- **Visual Snapshots:** Implement a headless browser step via Puppeteer/Playwright in Qwep's local environment to automatically capture the required `/Snapshots/before.png` and `/Snapshots/after.png` rather than relying on manual intervention.
