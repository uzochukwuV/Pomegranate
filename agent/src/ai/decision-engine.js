import OpenAI from 'openai';
import { config } from '../config.js';
import { TechnicalAnalysis } from './technical-analysis.js';
import { PerformanceTracker } from './performance-tracker.js';
import { TipScorer } from './tip-scorer.js';

/**
 * DGrid AI Decision Engine
 * Processes community tips and market data to make trading decisions
 */
export class DecisionEngine {
  constructor() {
    this.client = new OpenAI({
      apiKey: config.dgridApiKey,
      baseURL: config.dgridApiUrl,
    });
    this.model = config.dgridModel;
    this.performanceTracker = new PerformanceTracker();
    this.tipScorer = new TipScorer();
  }

  /**
   * Aggregate and analyze community tips
   * @param {Array} tips - Array of tips with {tipper, content, weight}
   * @returns {Object} Aggregated sentiment and key themes
   */
  analyzeTips(tips) {
    if (!tips || tips.length === 0) {
      return {
        totalWeight: 0,
        bullishWeight: 0,
        bearishWeight: 0,
        topTips: [],
        themes: [],
      };
    }

    // Sort by weight descending
    const sortedTips = [...tips].sort((a, b) => Number(b.weight) - Number(a.weight));

    // Calculate total weight
    const totalWeight = tips.reduce((sum, tip) => sum + Number(tip.weight), 0);

    // Extract bullish/bearish sentiment (basic keyword matching)
    let bullishWeight = 0;
    let bearishWeight = 0;

    tips.forEach((tip) => {
      const content = tip.content.toLowerCase();
      const weight = Number(tip.weight);

      // Bullish keywords
      if (
        content.includes('long') ||
        content.includes('buy') ||
        content.includes('bull') ||
        content.includes('moon') ||
        content.includes('up') ||
        content.includes('pump')
      ) {
        bullishWeight += weight;
      }

      // Bearish keywords
      if (
        content.includes('short') ||
        content.includes('sell') ||
        content.includes('bear') ||
        content.includes('down') ||
        content.includes('dump') ||
        content.includes('crash')
      ) {
        bearishWeight += weight;
      }
    });

    return {
      totalWeight,
      bullishWeight,
      bearishWeight,
      netSentiment: bullishWeight - bearishWeight,
      topTips: sortedTips.slice(0, 10), // Top 10 tips by weight
      themes: this.extractThemes(tips),
    };
  }

  /**
   * Extract common themes from tips
   */
  extractThemes(tips) {
    const themes = {};

    tips.forEach((tip) => {
      const words = tip.content.toLowerCase().split(/\s+/);

      // Look for trading pairs
      config.tradingPairs.forEach((pair) => {
        if (words.some((w) => w.includes(pair.toLowerCase().replace('usdt', '')))) {
          themes[pair] = (themes[pair] || 0) + Number(tip.weight);
        }
      });
    });

    return Object.entries(themes)
      .sort((a, b) => b[1] - a[1])
      .map(([pair, weight]) => ({ pair, weight }));
  }

  /**
   * Make a trading decision using AI
   * @param {Object} tipAnalysis - Aggregated tip analysis
   * @param {Object} marketData - Current market prices and trends
   * @returns {Object} Decision with {action, pair, reasoning, confidence, technicalAnalysis}
   */
  async makeDecision(tipAnalysis, marketData) {
    // Run technical analysis on all pairs
    const technicalData = {};
    Object.entries(marketData).forEach(([pair, data]) => {
      technicalData[pair] = TechnicalAnalysis.analyze(data);
    });

    const prompt = this.buildDecisionPrompt(tipAnalysis, marketData, technicalData);

    console.log('[AI] Requesting trading decision from DGrid...');

    const response = await this.client.chat.completions.create({
      model: this.model,
      messages: [
        {
          role: 'system',
          content: `You are AgentMeme, an AI-powered perpetual futures trading agent on MYX Finance.

DECISION INPUTS:
1. Community Tips - Weighted by token holdings × conviction multiplier (1x-3x based on hold duration)
2. Market Data - 24h price changes, trends, volatility
3. Risk Management - Position limits, exposure, market conditions

PERPETUAL FUTURES TRADING RULES:
- Instruments: BTCUSDT, ETHUSDT perpetual swaps (available on MYX BSC)
- Leverage: 2x default (amplifies both gains and losses)
- Position Size: $100-$${config.maxPositionSize} USDC collateral
- Liquidation Risk: Position liquidated if unrealized loss exceeds collateral
- Funding Rates: Long/short imbalance affects costs (not modeled here)

DECISION FRAMEWORK:

**Community Sentiment Analysis:**
- High tip weight (>5000): Strong community signal, higher confidence
- Bullish consensus (>70%): Consider LONG with caution (potential crowded trade)
- Bearish consensus (>70%): Consider SHORT with caution
- Contrarian signals (consensus wrong): 2x bonus potential if correct

**Risk Management:**
- Never risk more than $${config.maxPositionSize} per trade
- Avoid trades with confidence <0.5 unless strong community backing
- Close positions if unrealized loss approaches -15% (liquidation protection)
- Diversify across pairs when possible

**Technical Analysis:**
- RSI <30: Oversold (potential BUY), RSI >70: Overbought (potential SELL)
- RSI 40-60: Neutral zone
- STRONG_BUY/STRONG_SELL signals: RSI + EMA alignment (highest confidence)
- EMA Crossover: Fast EMA > Slow EMA = Bullish, Fast < Slow = Bearish

**Market Context:**
- Trend: 24h change >2% indicates momentum (trend following safer)
- Volatility: Large 24h swings = lower position size (auto-adjusted)
- No tips: Be conservative, only trade with >0.6 confidence on clear technical setups

**Position Sizing (Auto-Adjusted):**
- Low volatility (<2%): Full size up to $${config.maxPositionSize}
- Medium volatility (2-5%): 75% size
- High volatility (5-10%): 50% size
- Extreme volatility (>10%): 30% size

**Contrarian Strategy:**
- If community is 80%+ bullish but market declining: Consider SHORT (contrarian)
- If community is 80%+ bearish but market rising: Consider LONG (contrarian)
- Contrarian trades eligible for 2x attribution bonus if profitable

OUTPUT FORMAT (JSON only, no markdown):
{
  "action": "LONG" | "SHORT" | "CLOSE" | "HOLD",
  "pair": "BTCUSDT" | "ETHUSDT",
  "size": 100-${config.maxPositionSize},
  "reasoning": "Concise rationale with key factors (max 400 chars)",
  "confidence": 0.0-1.0,
  "attributedTip": 0-9 (tip index that most influenced decision, or null)
}

**Examples:**
- Strong bullish tips + uptrend → LONG with high size
- No tips + sideways market → HOLD
- Bearish tips + downtrend → SHORT
- Community wrong + clear reversal → Contrarian trade`,
        },
        {
          role: 'user',
          content: prompt,
        },
      ],
      temperature: 0.7,
      max_tokens: 500,
    });

    const content = response.choices[0]?.message?.content?.trim();

    // Handle null or empty responses
    if (!content) {
      console.error('[AI] Received null or empty response from DGrid API');
      return {
        action: 'HOLD',
        pair: 'BTCUSDT',
        size: 0,
        reasoning: 'AI returned empty response - holding for safety',
        confidence: 0,
        attributedTip: null,
      };
    }

    // Parse JSON response
    let decision;
    try {
      // Remove markdown code blocks if present
      const cleanContent = content.replace(/```json\n?/g, '').replace(/```\n?/g, '');
      decision = JSON.parse(cleanContent);
    } catch (err) {
      console.error('[AI] Failed to parse decision:', content);
      throw new Error('Invalid AI response format');
    }

    // Validate decision
    this.validateDecision(decision);

    // Adjust confidence based on past performance
    const perfAdjustment = this.performanceTracker.getConfidenceAdjustment(
      decision.technicalSignal || 'NEUTRAL',
      tipAnalysis.totalWeight
    );
    decision.confidence = Math.max(0, Math.min(1, decision.confidence + perfAdjustment));

    // Adjust position size based on volatility
    if (decision.action === 'LONG' || decision.action === 'SHORT') {
      const pairData = marketData[decision.pair];
      if (pairData) {
        decision.size = TechnicalAnalysis.adjustPositionSize(
          decision.size,
          Math.abs(pairData.change24h),
          config.maxPositionSize
        );
      }
    }

    console.log('[AI] Decision made:', decision);
    return decision;
  }

  /**
   * Build the decision prompt
   */
  buildDecisionPrompt(tipAnalysis, marketData, technicalData) {
    const { totalWeight, bullishWeight, bearishWeight, topTips, themes } = tipAnalysis;

    let prompt = `# MARKET SNAPSHOT\n\n`;

    // Market data for tradable pairs with technical indicators
    const tradablePairs = ['BTCUSDT', 'ETHUSDT'];
    prompt += `## Current Prices & Technical Analysis:\n`;
    tradablePairs.forEach((pair) => {
      const data = marketData[pair];
      const tech = technicalData[pair];
      if (data && tech) {
        const direction = data.change24h > 0 ? '🟢' : '🔴';
        const rsiStatus = tech.rsi < 30 ? '🔵OVERSOLD' : tech.rsi > 70 ? '🔴OVERBOUGHT' : '⚪NEUTRAL';

        prompt += `${direction} ${pair}: $${data.price.toFixed(2)} (${data.change24h > 0 ? '+' : ''}${data.change24h.toFixed(2)}%)\n`;
        prompt += `   RSI: ${tech.rsi} ${rsiStatus} | Trend: ${tech.trend} | Signal: ${tech.signal}\n`;
        prompt += `   EMA12: $${tech.emaFast} | EMA26: $${tech.emaSlow}\n\n`;
      }
    });

    prompt += `\n# COMMUNITY INTELLIGENCE\n\n`;

    if (totalWeight === 0) {
      prompt += `⚠️  No community tips submitted yet.\n`;
      prompt += `Strategy: Only trade on high-confidence technical setups (>0.6 confidence).\n\n`;
    } else {
      const bullishPct = (bullishWeight / totalWeight) * 100;
      const bearishPct = (bearishWeight / totalWeight) * 100;

      prompt += `📊 Total Weight: ${totalWeight.toLocaleString()}\n`;
      prompt += `🟢 Bullish: ${bullishWeight.toLocaleString()} (${bullishPct.toFixed(1)}%)\n`;
      prompt += `🔴 Bearish: ${bearishWeight.toLocaleString()} (${bearishPct.toFixed(1)}%)\n`;

      // Consensus analysis
      if (bullishPct > 70) {
        prompt += `\n⚡ STRONG BULLISH CONSENSUS - Watch for overcrowding, contrarian SHORT may pay off if wrong\n`;
      } else if (bearishPct > 70) {
        prompt += `\n⚡ STRONG BEARISH CONSENSUS - Watch for overcrowding, contrarian LONG may pay off if wrong\n`;
      } else {
        prompt += `\n⚖️  MIXED SENTIMENT - No clear consensus\n`;
      }

      prompt += `\n## Top Community Tips:\n`;
      topTips.slice(0, 5).forEach((tip, i) => {
        const multiplier = tip.weight > 10000 ? '🔥' : tip.weight > 5000 ? '⭐' : '';
        prompt += `${i}. ${multiplier} [Weight: ${tip.weight.toLocaleString()}] "${tip.content}"\n`;
      });

      if (themes.length > 0) {
        prompt += `\n## Pair-Specific Sentiment:\n`;
        themes.forEach(({ pair, weight }) => {
          prompt += `- ${pair}: ${weight.toLocaleString()} weight\n`;
        });
      }
    }

    // Add performance insights
    const perfStats = this.performanceTracker.getSummary();
    if (perfStats.totalTrades > 0) {
      prompt += `\n# PERFORMANCE INSIGHTS\n\n`;
      prompt += `Recent Performance: ${perfStats.wins}W-${perfStats.losses}L (${(perfStats.winRate * 100).toFixed(0)}% win rate)\n`;
      prompt += `Total PnL: ${perfStats.totalPnl > 0 ? '+' : ''}$${perfStats.totalPnl.toFixed(2)}\n`;
      prompt += `Profit Factor: ${perfStats.profitFactor.toFixed(2)}x\n`;

      const analysis = this.performanceTracker.analyzeWinningPatterns();
      if (analysis.recommendation) {
        prompt += `\n💡 Learning: ${analysis.recommendation}\n`;
      }
    }

    prompt += `\n# DECISION TASK\n\n`;
    prompt += `Analyze all data to make a perpetual futures trading decision.\n\n`;

    prompt += `PRIORITY CHECKLIST:\n`;
    prompt += `1. **Technical Confirmation**: Look for RSI + EMA alignment (STRONG_BUY/STRONG_SELL = best)\n`;
    prompt += `2. **Community + Technical Alignment**: Both pointing same direction = high confidence\n`;
    prompt += `3. **Contrarian Setups**: Consensus >70% but technicals opposite = potential 2x bonus\n`;
    prompt += `4. **Confidence Threshold**: Minimum 0.5 (0.6 without community tips)\n`;
    prompt += `5. **Attribution**: Which tip (index 0-${Math.max(0, topTips.length - 1)}) was most influential?\n\n`;

    prompt += `EXAMPLES:\n`;
    prompt += `- STRONG_BUY signal + bullish tips → LONG (high confidence)\n`;
    prompt += `- Oversold RSI + bullish EMA + no tips → LONG (medium confidence)\n`;
    prompt += `- STRONG_SELL + bearish tips → SHORT (high confidence)\n`;
    prompt += `- Sideways market + no clear signal → HOLD\n\n`;

    prompt += `Respond with JSON only (no markdown, no code blocks).`;

    return prompt;
  }

  /**
   * Validate AI decision
   */
  validateDecision(decision) {
    const validActions = ['LONG', 'SHORT', 'CLOSE', 'HOLD'];
    const validPairs = config.tradingPairs;

    if (!validActions.includes(decision.action)) {
      throw new Error(`Invalid action: ${decision.action}`);
    }

    if (decision.action !== 'HOLD' && decision.action !== 'CLOSE') {
      if (!validPairs.includes(decision.pair)) {
        throw new Error(`Invalid pair: ${decision.pair}`);
      }

      if (decision.size < 10 || decision.size > config.maxPositionSize) {
        throw new Error(`Invalid size: ${decision.size}`);
      }
    }

    if (!decision.reasoning || decision.reasoning.length > 500) {
      throw new Error('Invalid reasoning length');
    }

    if (decision.confidence < 0 || decision.confidence > 1) {
      throw new Error(`Invalid confidence: ${decision.confidence}`);
    }
  }

  /**
   * Record a completed trade for performance tracking
   */
  recordTrade(trade) {
    return this.performanceTracker.recordTrade(trade);
  }

  /**
   * Get performance summary
   */
  getPerformance() {
    return this.performanceTracker.getSummary();
  }

  /**
   * Generate a Narrative Pulse bulletin (weekly summary)
   */
  async generateNarrativePulse(weeklyStats) {
    const prompt = `Generate a brief Narrative Pulse bulletin summarizing this week's trading:

Trades: ${weeklyStats.tradeCount}
Win rate: ${(weeklyStats.winRate * 100).toFixed(1)}%
Total PnL: ${weeklyStats.totalPnl > 0 ? '+' : ''}$${weeklyStats.totalPnl.toFixed(2)}
Most traded pair: ${weeklyStats.mostTradedPair}
Top tip contributor: ${weeklyStats.topContributor}

Write a concise bulletin (max 280 chars) highlighting key insights and lessons learned.`;

    const response = await this.client.chat.completions.create({
      model: this.model,
      messages: [
        {
          role: 'system',
          content: 'You are AgentMeme, an AI trading agent. Write concise, transparent trading summaries.',
        },
        {
          role: 'user',
          content: prompt,
        },
      ],
      temperature: 0.8,
      max_tokens: 150,
    });

    return response.choices[0].message.content.trim();
  }

  /**
   * Score tips using DGrid AI
   * @param {Array} tips - Raw tips from contract
   * @param {Array} activePairs - Currently tradable pairs
   * @returns {Array} Scored and sorted tips
   */
  async scoreTips(tips, activePairs) {
    return await this.tipScorer.scoreTips(tips, activePairs);
  }

  /**
   * Detect if a tip is contrarian
   * @param {Object} tip - Tip to analyze
   * @param {Object} tipAnalysis - Aggregated tip analysis (crowd thesis)
   * @returns {Object} Contrarian analysis result
   */
  async detectContrarian(tip, tipAnalysis) {
    const crowdThesis = {
      direction: tipAnalysis.netSentiment > 0 ? 'BULLISH' : tipAnalysis.netSentiment < 0 ? 'BEARISH' : 'NEUTRAL',
      bullishWeight: tipAnalysis.bullishWeight,
      bearishWeight: tipAnalysis.bearishWeight,
      pair: tipAnalysis.themes[0]?.pair || null,
    };

    return await this.tipScorer.detectContrarian(tip, crowdThesis);
  }
}
