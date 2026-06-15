-- ============================================================================
-- U.N.D Industries — Insert Services into Store Products
-- Run in: Supabase Dashboard -> SQL Editor
-- This ensures the Cloudflare SDK can resolve the prices server-side.
-- ============================================================================

-- Ensure the store_products table exists (in case it wasn't created yet)
CREATE TABLE IF NOT EXISTS public.store_products (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    slug text UNIQUE NOT NULL,
    title text NOT NULL,
    price_cents integer NOT NULL,
    currency text DEFAULT 'usd',
    type text DEFAULT 'service',
    is_published boolean DEFAULT true,
    created_at timestamptz DEFAULT now()
);

-- Enable RLS for store_products so clients can read the catalog
ALTER TABLE public.store_products ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "read active products" ON public.store_products;
CREATE POLICY "read active products" ON public.store_products FOR SELECT USING (is_published = true);

-- Insert all Website, Shopify, and Automation packages
INSERT INTO public.store_products (slug, title, price_cents, type)
VALUES 
    -- Website Fixes
    ('website-fix-quick', 'Website Quick Fix', 9900, 'service'),
    ('website-fix-bundle', 'Website Fix Bundle', 19900, 'service'),
    ('website-fix-cleanup', 'Website Full Cleanup', 34900, 'service'),
    
    -- Shopify Services
    ('shopify-quick-cleanup', 'Shopify Quick Cleanup', 14900, 'service'),
    ('shopify-pro-upgrade', 'Shopify Professionalization', 29900, 'service'),
    ('shopify-dropshipping', 'Dropshipping Integration', 24900, 'service'),
    ('shopify-custom-upgrade', 'Custom Shopify Upgrade', 49900, 'service'),

    -- Automation & AI
    ('auto-starter', 'Starter Automation', 19900, 'service'),
    ('auto-advanced', 'Advanced Automation', 39900, 'service'),

    -- Growth & Consulting
    ('seo-overhaul', 'SEO Overhaul', 24900, 'service'),
    ('consulting-session', 'Consulting Session', 14900, 'service')
ON CONFLICT (slug) DO UPDATE 
SET 
    title = EXCLUDED.title,
    price_cents = EXCLUDED.price_cents,
    is_published = true;
