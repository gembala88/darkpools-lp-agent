import { BirdeyeAdapter } from './birdeye/birdeyeAdapter.js';
import { DexScreenerAdapter } from './dexscreener/dexscreenerAdapter.js';
import { JupiterAdapter } from './jupiter/jupiterAdapter.js';
import { MeteoraAdapter } from './meteora/meteoraAdapter.js';

export { BaseIntegration, type IntegrationConfig, type IntegrationAdapter } from './baseIntegration.js';
export { BirdeyeAdapter } from './birdeye/birdeyeAdapter.js';
export { DexScreenerAdapter } from './dexscreener/dexscreenerAdapter.js';
export { JupiterAdapter } from './jupiter/jupiterAdapter.js';
export { MeteoraAdapter } from './meteora/meteoraAdapter.js';

export const integrations = {
  birdeye: new BirdeyeAdapter(process.env.BIRDEYE_API_KEY),
  dexscreener: new DexScreenerAdapter(),
  jupiter: new JupiterAdapter(process.env.JUPITER_API_KEY),
  meteora: new MeteoraAdapter(),
} as const;

export type Integrations = typeof integrations;
