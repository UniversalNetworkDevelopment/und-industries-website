# U.N.D — SEO & Growth Notes (action-focused)

Notes distilled from Google's SEO Starter Guide, turned into a prioritized action list for
the website (and how to push the apps / company into the public eye). Goal: get crawled,
get indexed, get found for the terms that bring customers.

## Done (2026-06-13)
- ✅ `sitemap.xml` rewritten — **clean URLs** (the live site serves `/services` = 200; `.html`
  = 308 redirect), and it now **includes the Services page** (was missing) + refund + disclaimer.
- ✅ `robots.txt` already allows crawl, blocks private pages, and points to the sitemap.

## DO NOW (highest impact, low effort)
1. **Submit the sitemap in Search Console** — you're already on the Sitemaps page. In the
   "Add a new sitemap" box type **`sitemap.xml`** → Submit. (Full URL becomes
   `https://universalnetworkdevelopment.com/sitemap.xml`.) This tells Google all your pages.
2. **Use the URL Inspection tool** in Search Console on `https://universalnetworkdevelopment.com/services`
   → "Request indexing" so your money page gets crawled fast.
3. **Fix canonical tags → clean URLs.** Right now several pages have `<link rel="canonical" href=".../refund.html">` but the served URL is `/refund` (the `.html` 308-redirects).
   Canonical should point to the **non-redirecting** URL. → Change every page's canonical to the
   clean form (`/refund`, `/services`, …). *(This is a real "duplicate content / canonical"
   item from the guide. Claude can do this pass.)*

## DO SOON (content = the biggest ranking lever, per the guide)
4. **Per-page `<title>` + meta description.** Each page needs a unique, descriptive title and a
   1–2 sentence meta description (Google often uses it as the search snippet). Priority:
   - **Services** (money page): title e.g. *"Website Fixes & AI Development — Fast Flat-Rate Dev | U.N.D Industries"*; meta description targeting what customers search: "fix my website", "website bug fix", "broken contact form", "hire a developer".
   - Home, Store, Music, About — confirm each has a unique title + description.
5. **Write for what customers actually search** ("fix my website", "website not working",
   "developer near me", "AI automation for my business") — work those phrases naturally into the
   Services page copy + headings. Don't keyword-stuff (against Google policy).
6. **Image alt text** — every meaningful image (logos, product art) gets descriptive `alt`.
7. **Structured data (later):** add Organization + Service schema (JSON-LD) so Google can show
   rich results. Eligible once content is solid.

## PROMOTE (off-site — this is how you actually get traffic + backlinks)
- **Link the site from every profile you own:** Spotify, Apple Music, YouTube, BandLab, Fiverr,
  Upwork, social bios. Backlinks + referral traffic = discovery (the guide: most new pages are
  found via links).
- **Fiverr/Upwork gigs** (copy in `E:\Plans\Business\WEBSITE-FIX-SERVICE.md`) point back to the site.
- Business cards / posters / email signature → the URL.
- Word of mouth + community engagement (the guide's #1 lasting method).

## DON'T waste time on (guide explicitly says these don't help)
- Meta **keywords** tag (unused by Google), keyword **stuffing**, obsessing over heading order,
  exact word counts, or treating "E-E-A-T" as a ranking knob. Focus on real, useful content.

## Apps / company visibility
- The **website is the hub** — every product (ECAM, music, future apps) should have a real,
  linkable, indexable page here. (UND Nexus is the *internal* portal → keep it `noindex`.)
- A short blog / "updates" section (product launches, fixes) gives Google fresh content + more
  keywords to match, and gives you things to share.
