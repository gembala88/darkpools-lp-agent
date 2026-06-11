import { BirdeyeAdapter } from './birdeye/birdeyeAdapter.js';
import { DexScreenerAdapter } from './dexscreener/dexscreenerAdapter.js';
import { JupiterAdapter } from './jupiter/jupiterAdapter.js';
import { MeteoraAdapter } from './meteora/meteoraAdapter.js';
import { MeteoraAnalyticsAdapter } from './meteora/meteoraAnalyticsAdapter.js';
import { RaydiumAdapter } from './raydium/raydiumAdapter.js';
import { OrcaAdapter } from './orca/orcaAdapter.js';
import { HawkFiAdapter } from './hawkfi/hawkfiAdapter.js';

export { BaseIntegration, type IntegrationConfig, type IntegrationAdapter } from './baseIntegration.js';
export { BirdeyeAdapter } from './birdeye/birdeyeAdapter.js';
export { DexScreenerAdapter } from './dexscreener/dexscreenerAdapter.js';
export { JupiterAdapter } from './jupiter/jupiterAdapter.js';
export { MeteoraAdapter } from './meteora/meteoraAdapter.js';
export { MeteoraAnalyticsAdapter } from './meteora/meteoraAnalyticsAdapter.js';
export { RaydiumAdapter } from './raydium/raydiumAdapter.js';
export { OrcaAdapter } from './orca/orcaAdapter.js';
export { HawkFiAdapter } from './hawkfi/hawkfiAdapter.js';

export const integrations = {
  birdeye: new BirdeyeAdapter(process.env.BIRDEYE_API_KEY),
  dexscreener: new DexScreenerAdapter(),
  jupiter: new JupiterAdapter(process.env.JUPITER_API_KEY),
  meteora: new MeteoraAdapter(),
  meteoraAnalytics: new MeteoraAnalyticsAdapter(),
  raydium: new RaydiumAdapter(),
  orca: new OrcaAdapter(),
  hawkfi: new HawkFiAdapter(),
} as const;

export type Integrations = typeof integrations;
