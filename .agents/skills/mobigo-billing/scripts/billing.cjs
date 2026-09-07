#!/usr/bin/env node
/**
 * Mobigo DocuSeal Billing CLI Tool
 * Manage eSignature & AI balance top-ups, check balances, and generate clear invoices.
 */

const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');

// --- Helper: Parse .env file without external dependencies ---
function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const content = fs.readFileSync(filePath, 'utf8');
  const env = {};
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx !== -1) {
      const key = trimmed.slice(0, eqIdx).trim();
      let val = trimmed.slice(eqIdx + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      env[key] = val;
    }
  }
  return env;
}

// Search for .env from current directory up to root
function findEnv() {
  let curr = process.cwd();
  for (let i = 0; i < 5; i++) {
    const p = path.join(curr, '.env');
    if (fs.existsSync(p)) return loadEnvFile(p);
    const parent = path.dirname(curr);
    if (parent === curr) break;
    curr = parent;
  }
  return {};
}

// --- Parse CLI Arguments ---
const args = process.argv.slice(2);
const options = {
  env: 'production',
  url: '',
  token: '',
  help: false
};

const positionalArgs = [];
for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (arg === '--help' || arg === '-h') {
    options.help = true;
  } else if (arg.startsWith('--env=')) {
    options.env = arg.split('=')[1].toLowerCase();
  } else if (arg === '--env' && args[i + 1]) {
    options.env = args[++i].toLowerCase();
  } else if (arg.startsWith('--url=')) {
    options.url = arg.split('=')[1];
  } else if (arg === '--url' && args[i + 1]) {
    options.url = args[++i];
  } else if (arg.startsWith('--token=')) {
    options.token = arg.split('=')[1];
  } else if (arg === '--token' && args[i + 1]) {
    options.token = args[++i];
  } else {
    positionalArgs.push(arg);
  }
}

const command = positionalArgs[0] || 'check';

if (options.help || command === 'help') {
  console.log(`
Mobigo Billing CLI

Usage:
  node billing.cjs [command] [options]

Commands:
  check | balance                    View current balance and usage stats
  topup <amount> [description]       Top up credit balance with clear invoice
  set-balance <amount> [description] Set exact credit balance
  topup-ai <credits> [description]   Top up AI credits ($1.00 = 100 credits)

Options:
  --env=production | dev             Target environment (default: production)
  --url=<url>                        Custom DocuSeal Base URL
  --token=<api_token>                Custom X-Auth-Token
  -h, --help                         Show help information

Examples:
  node billing.cjs check
  node billing.cjs topup 400 "API Credit Top-Up ($400.00 USD)"
  node billing.cjs topup 50 --env=dev
  `);
  process.exit(0);
}

// --- Resolve Base URL and Auth Token ---
const envVars = findEnv();

let baseUrl = options.url;
let apiToken = options.token;

if (!baseUrl || !apiToken) {
  if (options.env === 'production' || options.env === 'prod') {
    baseUrl = baseUrl || envVars.PROD_DOCUSEAL_URL || 'https://mobigo.io7.my';
    apiToken = apiToken || envVars.PROD_DOCUSEAL_API_KEY || 'dwvP7HPoWiJsvcETWeLfR8K6NVf4a9vefLhiTydH5xk';
  } else {
    baseUrl = baseUrl || envVars.DEV_DOCUSEAL_URL || 'http://localhost:3000';
    apiToken = apiToken || envVars.DEV_DOCUSEAL_API_KEY || '9ewYoE91wx1p8hASHVMaoJBuvA4uP2vyU14WaPMGAe6';
  }
}

if (!baseUrl) {
  console.error('[Error] No target URL found. Specify --url=<url> or define PROD_DOCUSEAL_URL in .env');
  process.exit(1);
}

if (!apiToken) {
  console.error('[Error] No API token found. Specify --token=<token> or define PROD_DOCUSEAL_API_KEY in .env');
  process.exit(1);
}

// Clean base URL
baseUrl = baseUrl.replace(/\/+$/, '');

// --- HTTP Request Helper ---
function sendRequest(method, endpointPath, bodyData = null) {
  return new Promise((resolve, reject) => {
    const fullUrl = new URL(endpointPath, baseUrl);
    const isHttps = fullUrl.protocol === 'https:';
    const client = isHttps ? https : http;

    const headers = {
      'X-Auth-Token': apiToken,
      'Accept': 'application/json'
    };

    let postData = '';
    if (bodyData) {
      postData = JSON.stringify(bodyData);
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = Buffer.byteLength(postData);
    }

    const reqOptions = {
      hostname: fullUrl.hostname,
      port: fullUrl.port || (isHttps ? 443 : 80),
      path: fullUrl.pathname + fullUrl.search,
      method: method,
      headers: headers
    };

    const req = client.request(reqOptions, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        let parsed = data;
        try {
          parsed = JSON.parse(data);
        } catch (_) {}

        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve({ status: res.statusCode, data: parsed });
        } else {
          reject(new Error(`API Error [${res.statusCode}]: ${typeof parsed === 'object' ? JSON.stringify(parsed) : parsed}`));
        }
      });
    });

    req.on('error', err => reject(err));
    if (postData) req.write(postData);
    req.end();
  });
}

// --- Command Execution ---
async function run() {
  try {
    if (command === 'check' || command === 'balance' || command === 'status') {
      console.log(`Fetching billing info from: ${baseUrl} (${options.env}) ...`);
      const { data } = await sendRequest('GET', '/api/billing');

      console.log('\n--- Mobigo Billing Summary ---');
      console.log(`Account:                ${data.account_name} (ID: ${data.account_id})`);
      console.log(`Current Balance:        $${Number(data.balance).toFixed(2)} ${data.currency || 'USD'}`);
      console.log(`Rate Per Signature:     $${Number(data.rate_per_signature || 0.20).toFixed(2)} USD`);
      console.log(`Signatures Remaining:   ~${Math.floor(Number(data.balance) / Number(data.rate_per_signature || 0.20))}`);
      console.log(`Total Completed Sigs:   ${data.total_completed_signatures}`);
      console.log(`Total Amount Spent:     $${Number(data.total_spent).toFixed(2)} USD`);
      console.log(`This Month Sigs:        ${data.this_month_completed_signatures}`);
      console.log(`This Month Spent:       $${Number(data.this_month_spent).toFixed(2)} USD`);
      console.log('------------------------------\n');
      return;
    }

    if (command === 'topup') {
      const rawAmount = positionalArgs[1];
      if (!rawAmount || isNaN(Number(rawAmount)) || Number(rawAmount) <= 0) {
        console.error('[Error] Please specify a valid top-up amount greater than 0. (e.g. node billing.cjs topup 400)');
        process.exit(1);
      }

      const amount = Number(rawAmount);
      const desc = positionalArgs[2] || `eSignature API Credit Top-Up ($${amount.toFixed(2)} USD)`;

      console.log(`Initiating top-up of $${amount.toFixed(2)} USD on: ${baseUrl} (${options.env}) ...`);

      const payload = {
        amount: amount,
        description: desc,
        method: 'API'
      };

      const { data } = await sendRequest('POST', '/api/billing', payload);

      console.log('\n✅ Top-up successful!');
      console.log('----------------------------------------------------');
      console.log(`Message:          ${data.message}`);
      console.log(`Invoice ID:       ${data.invoice_id || 'N/A'}`);
      console.log(`Amount Added:     +$${Number(data.amount_added).toFixed(2)} ${data.currency || 'USD'}`);
      console.log(`Previous Balance: $${Number(data.previous_balance).toFixed(2)} ${data.currency || 'USD'}`);
      console.log(`New Balance:      $${Number(data.new_balance).toFixed(2)} ${data.currency || 'USD'}`);
      console.log(`Equivalent Sigs:  +${Math.floor(amount / 0.20)} signatures`);
      console.log('----------------------------------------------------');
      console.log(`View invoice at:  ${baseUrl}/settings/billing\n`);
      return;
    }

    if (command === 'set-balance') {
      const rawAmount = positionalArgs[1];
      if (rawAmount === undefined || isNaN(Number(rawAmount)) || Number(rawAmount) < 0) {
        console.error('[Error] Please specify a non-negative balance amount. (e.g. node billing.cjs set-balance 100)');
        process.exit(1);
      }

      const balance = Number(rawAmount);
      const desc = positionalArgs[2] || `API Balance Adjustment ($${balance.toFixed(2)} USD)`;

      console.log(`Setting balance to $${balance.toFixed(2)} USD on: ${baseUrl} (${options.env}) ...`);
      const payload = {
        balance: balance,
        description: desc,
        method: 'API'
      };

      const { data } = await sendRequest('POST', '/api/billing', payload);

      console.log('\n✅ Balance updated!');
      console.log('----------------------------------------------------');
      console.log(`Message:          ${data.message}`);
      console.log(`Invoice ID:       ${data.invoice_id || 'N/A'}`);
      console.log(`Previous Balance: $${Number(data.previous_balance).toFixed(2)} ${data.currency || 'USD'}`);
      console.log(`New Balance:      $${Number(data.new_balance).toFixed(2)} ${data.currency || 'USD'}`);
      console.log(`Difference:       ${data.difference >= 0 ? '+' : ''}$${Number(data.difference).toFixed(2)} USD`);
      console.log('----------------------------------------------------');
      return;
    }

    if (command === 'topup-ai') {
      const rawCredits = positionalArgs[1];
      if (!rawCredits || isNaN(Number(rawCredits)) || Number(rawCredits) <= 0) {
        console.error('[Error] Please specify positive AI credits. (e.g. node billing.cjs topup-ai 1000)');
        process.exit(1);
      }

      const credits = parseInt(rawCredits, 10);
      const desc = positionalArgs[2] || `${credits} AI credits`;

      console.log(`Adding ${credits} AI credits on: ${baseUrl} (${options.env}) ...`);
      const payload = {
        ai_credits: credits,
        description: desc,
        method: 'API'
      };

      const { data } = await sendRequest('POST', '/api/billing', payload);

      console.log('\n✅ AI Credits topped up!');
      console.log('----------------------------------------------------');
      console.log(`Message:          ${data.message}`);
      console.log(`Invoice ID:       ${data.invoice_id || 'N/A'}`);
      console.log(`Credits Added:    +${data.credits_added}`);
      console.log(`Amount Added:     +$${Number(data.amount_added).toFixed(2)} ${data.currency || 'USD'}`);
      console.log(`New AI Balance:   $${Number(data.new_ai_balance).toFixed(2)} USD`);
      console.log('----------------------------------------------------');
      return;
    }

    console.error(`[Error] Unknown command: "${command}". Run with --help to see available commands.`);
    process.exit(1);
  } catch (err) {
    console.error('\n❌ Billing operation failed:');
    console.error(err.message || err);
    process.exit(1);
  }
}

run();
