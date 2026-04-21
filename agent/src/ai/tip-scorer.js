import OpenAI from 'openai';
import { config } from '../config.js';

/**
 * Tip Scorer
 * Uses DGrid AI to evaluate and rank community trading tips
 */
export class TipScorer {
  constructor() {
    this.client = new OpenAI({
      apiKey: config.dgridApiKey,
      baseURL: config.dgridApiUrl,
    });
    this.model = config.dgridModel;
  }

  /**
   * Score multiple tips and rank by quality
   * @param {Array} tips - Array of tip objects from contract
   * @param {Array} activePairs - Currently tradable pairs
   * @returns {Array} Sorted tips with scores
   */
  async scoreTips(tips, activePairs) {
    if (!tips || tips.length === 0) {
      return [];
    }

    console.log(`[TipScorer] Scoring ${tips.length} tips...`);

    // Format tips for DGrid
    const tipText = tips
      .map((t, i) => {
        const weight = parseFloat(t.weight) / 1e18; // Convert from wei
        const stake = t.stakeAmount ? parseFloat(t.stakeAmount) / 1e18 : 0;
        return `Tip ${i} (weight: ${weight.toFixed(0)} tokens, stake: ${stake.toFixed(0)} tokens): "${t.content}"`;
      })
      .join('\n');

    const prompt = `Evaluate these community trading tips for quality and actionability.

Active trading pairs: ${activePairs.join(', ')}

Tips to score:
${tipText}

Score each tip 0-10 based on:
1. **Relevance** (5 points): Is it actionable for perpetual futures trading?
2. **Specificity** (3 points): Does it name a specific pair and direction (LONG/SHORT)?
3. **Originality** (2 points): Does it provide unique insight vs generic advice?

Respond ONLY with valid JSON (no markdown, no code blocks):
{
  "scores": [
    {
      "index": 0,
      "score": 7,
      "reason": "Specific LONG ETH signal with technical reasoning"
    }
  ]
}`;

    try {
      const response = await this.client.chat.completions.create({
        model: this.model,
        messages: [
          {
            role: 'system',
            content: `You are a trading signal evaluator. Score tips objectively based on actionability, specificity, and originality. Be strict - most tips should score 3-7 out of 10.`,
          },
          {
            role: 'user',
            content: prompt,
          },
        ],
        temperature: 0.3, // Low temperature for consistent scoring
        max_tokens: 1000,
      });

      const content = response.choices[0]?.message?.content?.trim();

      if (!content) {
        console.error('[TipScorer] Received empty response from DGrid');
        return this._defaultScores(tips);
      }

      // Parse JSON response
      const cleanContent = content.replace(/```json\n?/g, '').replace(/```\n?/g, '');
      const result = JSON.parse(cleanContent);

      // Merge scores with original tips
      const scoredTips = tips.map((tip, i) => {
        const scoreData = result.scores.find((s) => s.index === i);
        return {
          ...tip,
          score: scoreData?.score || 0,
          scoreReason: scoreData?.reason || 'No score provided',
        };
      });

      // Sort by score (highest first)
      scoredTips.sort((a, b) => b.score - a.score);

      console.log('[TipScorer] Top 3 tips:');
      scoredTips.slice(0, 3).forEach((tip, i) => {
        console.log(`  ${i + 1}. Score ${tip.score}/10: "${tip.content.substring(0, 60)}..."`);
      });

      return scoredTips;
    } catch (err) {
      console.error('[TipScorer] Failed to score tips:', err.message);
      return this._defaultScores(tips);
    }
  }

  /**
   * Detect if a tip is contrarian vs the crowd consensus
   * @param {Object} tip - Tip to evaluate
   * @param {Object} crowdThesis - Synthesized crowd sentiment
   * @returns {Object} Contrarian analysis
   */
  async detectContrarian(tip, crowdThesis) {
    if (!crowdThesis || !tip) {
      return { isContrarian: false, contrarian_score: 0, reasoning: 'No crowd thesis available' };
    }

    console.log(`[TipScorer] Checking contrarian status for tip: "${tip.content.substring(0, 50)}..."`);

    const prompt = `Analyze if this tip goes against the current crowd consensus.

Crowd thesis:
- Direction: ${crowdThesis.direction || 'NEUTRAL'}
- Consensus pair: ${crowdThesis.pair || 'None'}
- Bullish weight: ${crowdThesis.bullishWeight || 0}
- Bearish weight: ${crowdThesis.bearishWeight || 0}

Tip to evaluate: "${tip.content}"

Determine if this tip is contrarian (opposes the crowd). A tip is contrarian if:
1. Crowd is >70% bullish and tip suggests SHORT/SELL/BEARISH
2. Crowd is >70% bearish and tip suggests LONG/BUY/BULLISH
3. Crowd focuses on one asset but tip strongly suggests opposite or different asset

Respond ONLY with valid JSON (no markdown):
{
  "is_contrarian": true/false,
  "contrarian_score": 0.0-1.0,
  "reasoning": "Explanation"
}`;

    try {
      const response = await this.client.chat.completions.create({
        model: this.model,
        messages: [
          {
            role: 'system',
            content: `You analyze trading tips to identify contrarian positions. Be objective - only flag clear opposition to the crowd.`,
          },
          {
            role: 'user',
            content: prompt,
          },
        ],
        temperature: 0.3,
        max_tokens: 300,
      });

      const content = response.choices[0]?.message?.content?.trim();

      if (!content) {
        return { isContrarian: false, contrarian_score: 0, reasoning: 'Empty response' };
      }

      const cleanContent = content.replace(/```json\n?/g, '').replace(/```\n?/g, '');
      const result = JSON.parse(cleanContent);

      console.log(
        `[TipScorer] Contrarian: ${result.is_contrarian} (score: ${result.contrarian_score.toFixed(2)})`
      );

      return {
        isContrarian: result.is_contrarian && result.contrarian_score > 0.7,
        contrarian_score: result.contrarian_score,
        reasoning: result.reasoning,
      };
    } catch (err) {
      console.error('[TipScorer] Failed to detect contrarian:', err.message);
      return { isContrarian: false, contrarian_score: 0, reasoning: 'Error analyzing' };
    }
  }

  /**
   * Fallback scoring when DGrid fails
   * @param {Array} tips - Tips to score
   * @returns {Array} Tips with basic scores
   */
  _defaultScores(tips) {
    console.warn('[TipScorer] Using fallback scoring (weight-based)');
    return tips
      .map((tip) => ({
        ...tip,
        score: 5, // Neutral score
        scoreReason: 'Default score (AI unavailable)',
      }))
      .sort((a, b) => parseFloat(b.weight) - parseFloat(a.weight)); // Sort by weight
  }
}
