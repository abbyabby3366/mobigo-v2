---
name: mobigo-billing
description: >-
  Manage Mobigo eSignature and AI balance top-ups, check live balances and usage stats,
  and generate clear, audit-compliant invoices and transaction records. Use whenever
  the user asks to check balance, top up credits (USD or AI credits), inspect billing,
  or manage invoices on Mobigo / DocuSeal (production or development).
---

# Mobigo Billing & Credit Top-Up

This skill manages DocuSeal / Mobigo eSignature credit balances, AI credits, and automated invoice records.

## Environments & Credentials

Credentials are auto-detected from `.env` in the workspace root:

| Environment | Host | Variable |
| :--- | :--- | :--- |
| **Production** | `https://mobigo.io7.my` | `PROD_DOCUSEAL_URL`, `PROD_DOCUSEAL_API_KEY` |
| **Development** | `http://localhost:3000` | `DEV_DOCUSEAL_URL`, `DEV_DOCUSEAL_API_KEY` |

---

## Quick Execution via CLI Helper

A ready-to-use cross-platform CLI tool is bundled in this skill:

```bash
# Check current balance and signature usage
node .agents/skills/mobigo-billing/scripts/billing.cjs check

# Top up credit balance (default environment: production)
node .agents/skills/mobigo-billing/scripts/billing.cjs topup 400 "eSignature API Credit Top-Up ($400.00 USD)"

# Top up on local development environment
node .agents/skills/mobigo-billing/scripts/billing.cjs topup 50 --env=dev

# Top up AI credits (100 credits = $1.00 USD)
node .agents/skills/mobigo-billing/scripts/billing.cjs topup-ai 1000 "1000 AI credits"

# Set exact balance
node .agents/skills/mobigo-billing/scripts/billing.cjs set-balance 100 "Balance adjustment"
```

---

## Direct API Specifications

When executing via HTTP requests or code, communicate with the DocuSeal Billing API directly:

### 1. Check Balance (`GET /api/billing`)

**Headers:**
```http
X-Auth-Token: <DOCUSEAL_API_KEY>
```

**Response Format:**
```json
{
  "account_id": 1,
  "account_name": "Mobigo",
  "balance": 404.6,
  "currency": "USD",
  "rate_per_signature": 0.2,
  "total_completed_signatures": 727,
  "total_spent": 145.4,
  "this_month_completed_signatures": 217,
  "this_month_spent": 43.4
}
```

---

### 2. Top-Up Balance (`POST /api/billing`)

Every top-up automatically increments the account credit balance, removes any active low-balance alerts, and creates an official invoice in the billing database with a unique ID (`INV-YYYYMMDD-XXXXXX`).

**Request Headers:**
```http
X-Auth-Token: <DOCUSEAL_API_KEY>
Content-Type: application/json
```

**Request Body:**
```json
{
  "amount": 400.00,
  "description": "eSignature API Credit Top-Up ($400.00 USD)",
  "method": "API"
}
```

**Response Format:**
```json
{
  "success": true,
  "message": "Successfully topped up $400.00 USD",
  "account_id": 1,
  "amount_added": 400.0,
  "previous_balance": 4.6,
  "new_balance": 404.6,
  "invoice_id": "INV-20260907-8E5E75",
  "currency": "USD"
}
```

---

### 3. Top-Up AI Credits (`POST /api/billing`)

To add credits specifically for AI document analysis and field extraction:

**Request Body:**
```json
{
  "ai_credits": 1000,
  "description": "1000 AI credits",
  "method": "API"
}
```

---

## Verification & Auditing

After any top-up or balance adjustment:
1. Always confirm the returned `invoice_id`, `amount_added`, and `new_balance`.
2. Re-fetch `GET /api/billing` to ensure the live balance reflects the change.
3. Invoices can be viewed and printed directly on the web dashboard: `https://mobigo.io7.my/settings/billing`.
