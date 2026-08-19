# DocuSeal Billing & Balance Top-Up API Documentation

This document explains how to interact with the DocuSeal Billing API to retrieve the current credit balance, check usage statistics, and programmatically top up the balance from external services (e.g., payment gateways like Stripe, LemonSqueezy, PayPal, or internal microservices).

---

## 🔑 Authentication

All requests to the Billing API must include your DocuSeal API Token in the HTTP request headers:

```http
X-Auth-Token: YOUR_API_TOKEN
```

> **Where to find your API Token:**  
> Go to **Settings** $\rightarrow$ **API** (`http://localhost:3000/settings/api`) in your DocuSeal dashboard to copy your `X-Auth-Token`.

---

## 📡 Base URL

```
http://localhost:3000/api
```
*(Or your production host: `https://your-docuseal-domain.com/api`)*

---

## 1. Top Up, Deduct, or Edit Balance

### **Option A: Edit / Set Exact Balance**
Directly set the exact account balance to a specific USD amount.

#### **Endpoint**
`PUT /api/billing` or `PATCH /api/billing` (or `POST /api/billing` with `"balance": 50.00`)

#### **Request Body**
```json
{
  "balance": 50.00,
  "description": "Adjusted balance"
}
```

#### **Success Response** (`200 OK`)
```json
{
  "success": true,
  "message": "Successfully updated balance to $50.00 USD",
  "account_id": 1,
  "previous_balance": 33.0,
  "new_balance": 50.0,
  "difference": 17.0,
  "invoice_id": "INV-20260819-A1B2C3",
  "currency": "USD"
}
```

---

### **Option B: Add or Deduct Balance (Amount Adjustment)**
Add funds or deduct amount from the current credit balance.

#### **Endpoint**
`POST /api/billing`

#### **Headers**
| Header | Value | Description |
| :--- | :--- | :--- |
| `X-Auth-Token` | `YOUR_API_TOKEN` | Required. Your DocuSeal API authentication token. |
| `Content-Type` | `application/json` | Required. Must be `application/json`. |

#### **Request Body (Top-Up)**
```json
{
  "amount": 20.00
}
```

#### **Request Body (Deduction)**
```json
{
  "amount": -10.00
}
```

#### **Success Response (Top-Up)** (`200 OK`)
```json
{
  "success": true,
  "message": "Successfully topped up $20.00 USD",
  "account_id": 1,
  "amount_added": 20.0,
  "previous_balance": 30.0,
  "new_balance": 50.0,
  "invoice_id": "INV-20260819-A1B2C3",
  "currency": "USD"
}
```

---

## 2. Get Current Balance & Usage

Retrieve the current credit balance, rate per completed signature, and month/all-time metrics.

### **Endpoint**
`GET /api/billing`

### **Headers**
```http
X-Auth-Token: YOUR_API_TOKEN
```

### **Success Response** (`200 OK`)
```json
{
  "account_id": 1,
  "account_name": "My Company",
  "balance": 60.0,
  "currency": "USD",
  "rate_per_signature": 0.2,
  "total_completed_signatures": 14,
  "total_spent": 2.8,
  "this_month_completed_signatures": 5,
  "this_month_spent": 1.0
}
```

---

## 💻 Code Examples

### **1. cURL**

#### Top Up $50.00 USD:
```bash
curl -X POST "http://localhost:3000/api/billing" \
  -H "X-Auth-Token: YOUR_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"amount": 50.0}'
```

#### Check Balance:
```bash
curl -X GET "http://localhost:3000/api/billing" \
  -H "X-Auth-Token: YOUR_API_TOKEN"
```

---

### **2. Node.js (Fetch / Axios)**

```javascript
// Using Node.js 18+ native fetch
async function topUpDocusealBalance(amount) {
  const response = await fetch('http://localhost:3000/api/billing', {
    method: 'POST',
    headers: {
      'X-Auth-Token': process.env.DOCUSEAL_API_TOKEN,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ amount: amount })
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || 'Top-up failed');
  }

  console.log('Top-up successful:', data);
  return data;
}

// Example usage:
// topUpDocusealBalance(50.00);
```

---

### **3. Python (requests)**

```python
import os
import requests

API_URL = "http://localhost:3000/api/billing"
API_TOKEN = os.getenv("DOCUSEAL_API_TOKEN", "YOUR_API_TOKEN")

def top_up_balance(amount: float):
    headers = {
        "X-Auth-Token": API_TOKEN,
        "Content-Type": "application/json"
    }
    payload = {
        "amount": amount
    }

    response = requests.post(API_URL, json=payload, headers=headers)
    if response.status_code == 200:
        print("Top up succeeded:", response.json())
        return response.json()
    else:
        print(f"Error {response.status_code}:", response.json())
        return None

# Example usage:
# top_up_balance(50.00)
```

---

### **4. PHP (cURL)**

```php
<?php

function topUpDocusealBalance($amount, $apiToken, $baseUrl = 'http://localhost:3000') {
    $ch = curl_init("{$baseUrl}/api/billing");

    $payload = json_encode(['amount' => (float)$amount]);

    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_POST, true);
    curl_setopt($ch, CURLOPT_POSTFIELDS, $payload);
    curl_setopt($ch, CURLOPT_HTTPHEADER, [
        "X-Auth-Token: {$apiToken}",
        "Content-Type: application/json"
    ]);

    $response = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);

    return [
        'status' => $httpCode,
        'data' => json_decode($response, true)
    ];
}

// Example usage:
// $result = topUpDocusealBalance(50.00, 'YOUR_API_TOKEN');
// print_r($result);
```
