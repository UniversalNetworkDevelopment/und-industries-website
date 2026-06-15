# WEBSITE_SERVICES_SOP

## 1. Trigger

- Source: Supabase `service_tickets` table
- Condition: `status = 'paid'`
- Actor: Qwep Fulfillment Engine

## 2. Intake

- Qwep sends secure intake link to client email.
- Client provides:
  - GitHub repo or Shopify store URL
  - Access method (collaborator, staff account, etc.)
  - Brief description of issue

## 3. Fulfillment Flow (Quick Fix)

1. Qwep clones repo or accesses theme.
2. Qwep analyzes issue using Gemini/Qwen.
3. Qwep proposes fix and applies it in a branch or draft theme.
4. Qwep tests basic functionality.
5. Qwep sends summary + confirmation to client.

## 4. Fulfillment Flow (Shopify Cleanup)

1. Qwep audits theme and apps.
2. Qwep identifies redundant apps, broken sections, performance issues.
3. Qwep generates cleanup plan.
4. Qwep applies changes in a duplicate theme.
5. Qwep requests client approval before publishing.

## 5. Failure / Refund

- If access is not provided within 7 days → ticket paused, client notified.
- If work cannot be completed → partial or full refund per internal policy.
