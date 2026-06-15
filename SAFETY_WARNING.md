# 🚨 LEGAL / SAFETY WARNING 🚨

**DO NOT MARKET OR SELL THESE SERVICES TO REAL CUSTOMERS YET.**

The checkout pipeline works, but the **Fulfillment Pipeline (Qwep Integration)** is not yet finished. If you take real customer money right now, the orders will sit in the database and nothing will happen. 

**Requirements before going live:**
1. Qwep must have the Supabase Realtime listener active (`status = 'paid'`).
2. Qwep must automatically send the client intake email.
3. We must test the flow end-to-end with a test ticket.

Do not remove this warning until the test ticket successfully traverses the entire pipeline from Stripe -> Supabase -> Qwep -> Client Email.
