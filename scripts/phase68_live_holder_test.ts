import { integrations } from '../src/integrations/index.js';
import { config as dotenvConfig } from 'dotenv';
import { existsSync, readFileSync } from 'fs';

dotenvConfig();

function loadEnv(): { birdeyeKey: string | undefined } {
  let birdeyeKey = process.env.BIRDEYE_API_KEY;
  if (!birdeyeKey && existsSync('.env')) {
    const envContent = readFileSync('.env', 'utf-8');
    const match = envContent.match(/^BIRDEYE_API_KEY=(.+)$/m);
    if (match) birdeyeKey = match[1].trim();
  }
  return { birdeyeKey };
}

async function main() {
  const { birdeyeKey } = loadEnv();
  const mint = 'So11111111111111111111111111111111111111112';

  console.log('=== HOLDER FETCH TEST ===');
  console.log('Mint:', mint);
  console.log('BIRDEYE_API_KEY:', birdeyeKey ? `present (${birdeyeKey.slice(0, 8)}...)` : 'NOT FOUND');

  const headers: Record<string, string> = { 'accept': 'application/json', 'x-chain': 'solana' };
  if (birdeyeKey) headers['x-api-key'] = birdeyeKey;

  console.log('\n--- raw HTTP: /defi/v3/token/holder ---');
  const url = `https://public-api.birdeye.so/defi/v3/token/holder?address=${mint}&offset=0&limit=5`;
  console.log('GET', url);
  try {
    const resp = await fetch(url, { headers });
    const body = await resp.json();
    console.log('HTTP', resp.status);
    console.log('raw body:', JSON.stringify(body).slice(0, 2000));
    if (resp.status === 200 && body?.data) {
      console.log('data.items:', body.data.items ? `array[${body.data.items.length}]` : 'missing');
      if (body.data.items?.length > 0) {
        console.log('first item:', JSON.stringify(body.data.items[0]));
      }
    }
  } catch (e: any) {
    console.log('FETCH ERROR:', e.message);
  }

  console.log('\n--- adapter.getTokenHolders ---');
  try {
    const holders = await integrations.birdeye.getTokenHolders(mint, 5);
    console.log('holder count:', holders.length);
    if (holders.length > 0) console.log('first holder:', JSON.stringify(holders[0], null, 2));
  } catch (e: any) {
    console.log('ADAPTER ERROR:', e.message);
  }
}

main().catch(e => console.error('FATAL:', e));
