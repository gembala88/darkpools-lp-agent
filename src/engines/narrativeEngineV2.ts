import { BaseEngine, EngineResult } from './baseEngine.js';

interface NarrativeDef {
  name: string;
  keywords: string[];
  weight: number;
  isActive: boolean;
}

export class NarrativeEngineV2 extends BaseEngine {
  readonly name = 'narrative_v2';
  readonly version = '2.0.0';

  private narratives: NarrativeDef[] = [
    { name: 'AI', keywords: ['ai', 'artificial intelligence', 'llm', 'gpt', 'neural', 'deep learning', 'machine learning', 'tensor', 'compute', 'inference'], weight: 20, isActive: true },
    { name: 'Agents', keywords: ['agent', 'autonomous', 'bot', 'automation', 'orchestrator', 'swarm', 'multi-agent'], weight: 18, isActive: true },
    { name: 'Infra', keywords: ['infrastructure', 'protocol', 'layer', 'bridge', 'oracle', 'cross-chain', 'interop', 'staking', 'validator'], weight: 15, isActive: true },
    { name: 'DePIN', keywords: ['depin', 'physical', 'network', 'sensor', 'iot', 'bandwidth', 'storage', 'compute network'], weight: 12, isActive: true },
    { name: 'Gaming', keywords: ['game', 'gaming', 'metaverse', 'rpg', 'guild', 'play', 'esports', 'virtual'], weight: 10, isActive: true },
    { name: 'RWA', keywords: ['rwa', 'real world', 'asset', 'treasury', 'bond', 'commodity', 'security', 'tokenized'], weight: 10, isActive: true },
    { name: 'SocialFi', keywords: ['social', 'socialfi', 'community', 'creator', 'platform', 'feed', 'farcaster', 'lens'], weight: 8, isActive: true },
    { name: 'Base', keywords: ['base', 'coinbase', 'l2', 'layer2', 'base chain'], weight: 3, isActive: true },
    { name: 'Solana', keywords: ['solana', 'sol', 'spl', 'meteora', 'dlmm', 'jupiter', 'raydium', 'pump'], weight: 2, isActive: true },
    { name: 'Meme', keywords: ['meme', 'meme coin', 'dog', 'cat', 'pepe', 'wojak', 'chad', 'doge', 'shib', 'floki', 'bonk', 'wif'], weight: 2, isActive: true },
  ];

  async evaluate(params?: { tokenName?: string; tokenSymbol?: string; narrative?: string }): Promise<EngineResult> {
    const { tokenName, tokenSymbol, narrative: explicitNarrative } = params ?? {};
    const textToAnalyze = [tokenName, tokenSymbol, explicitNarrative].filter(Boolean).join(' ').toLowerCase();

    if (!textToAnalyze) {
      return { score: 0, signal: 'neutral', reason: 'No token info to analyze narrative', metadata: {} };
    }

    const metadata: Record<string, unknown> = {};
    const matchedNarratives: string[] = [];
    let totalScore = 0;

    for (const n of this.narratives) {
      if (!n.isActive) continue;
      const matchCount = n.keywords.filter(kw => textToAnalyze.includes(kw)).length;
      if (matchCount > 0) {
        matchedNarratives.push(n.name);
        const narrativeScore = Math.min(matchCount * n.weight * 0.5, n.weight);
        totalScore += narrativeScore;
        metadata[`narrative_${n.name}`] = narrativeScore;
      }
    }

    metadata.matchedNarratives = matchedNarratives;
    metadata.primaryNarrative = matchedNarratives[0] ?? 'unknown';

    if (explicitNarrative) {
      const explicitMatch = this.narratives.find(n =>
        n.name.toLowerCase() === explicitNarrative.toLowerCase()
      );
      if (explicitMatch) {
        totalScore += explicitMatch.weight * 0.8;
        metadata.explicitNarrativeBonus = explicitMatch.weight * 0.8;
        if (!matchedNarratives.includes(explicitMatch.name)) {
          matchedNarratives.push(explicitMatch.name);
          metadata.primaryNarrative = explicitMatch.name;
        }
      }
    }

    const score = this.normalizeScore(Math.min(totalScore, 100));
    return {
      score,
      signal: this.getSignal(score),
      reason: `narratives=[${matchedNarratives.join(', ')}], primary=${metadata.primaryNarrative}`,
      metadata,
    };
  }
}
