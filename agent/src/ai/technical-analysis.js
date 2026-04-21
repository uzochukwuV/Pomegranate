/**
 * Technical Analysis Module
 * Calculates indicators for better trading decisions
 */

export class TechnicalAnalysis {
  /**
   * Calculate RSI (Relative Strength Index)
   * @param {Array} prices - Array of price objects {timestamp, price}
   * @param {number} period - RSI period (default 14)
   * @returns {number} RSI value (0-100)
   */
  static calculateRSI(prices, period = 14) {
    if (prices.length < period + 1) return 50; // Neutral if not enough data

    const changes = [];
    for (let i = 1; i < prices.length; i++) {
      changes.push(prices[i].price - prices[i - 1].price);
    }

    let avgGain = 0;
    let avgLoss = 0;

    // Initial average
    for (let i = 0; i < period; i++) {
      if (changes[i] > 0) {
        avgGain += changes[i];
      } else {
        avgLoss += Math.abs(changes[i]);
      }
    }
    avgGain /= period;
    avgLoss /= period;

    // Smooth with exponential moving average
    for (let i = period; i < changes.length; i++) {
      const change = changes[i];
      if (change > 0) {
        avgGain = (avgGain * (period - 1) + change) / period;
        avgLoss = (avgLoss * (period - 1)) / period;
      } else {
        avgGain = (avgGain * (period - 1)) / period;
        avgLoss = (avgLoss * (period - 1) + Math.abs(change)) / period;
      }
    }

    if (avgLoss === 0) return 100;
    const rs = avgGain / avgLoss;
    const rsi = 100 - 100 / (1 + rs);

    return rsi;
  }

  /**
   * Calculate EMA (Exponential Moving Average)
   * @param {Array} prices - Array of price values
   * @param {number} period - EMA period
   * @returns {number} Current EMA value
   */
  static calculateEMA(prices, period) {
    if (prices.length < period) return prices[prices.length - 1];

    const k = 2 / (period + 1);
    let ema = prices.slice(0, period).reduce((a, b) => a + b, 0) / period;

    for (let i = period; i < prices.length; i++) {
      ema = prices[i] * k + ema * (1 - k);
    }

    return ema;
  }

  /**
   * Analyze market with technical indicators
   * @param {Object} marketData - {pair, price, change24h, priceHistory}
   * @returns {Object} Technical analysis results
   */
  static analyze(marketData) {
    const { price, change24h, priceHistory = [] } = marketData;

    // If no price history, use simple analysis
    if (priceHistory.length < 20) {
      return {
        rsi: 50,
        trend: change24h > 0 ? 'BULLISH' : 'BEARISH',
        trendStrength: Math.abs(change24h) / 2, // Rough estimate
        emaFast: price,
        emaSlow: price,
        emaCross: 'NEUTRAL',
        signal: 'NEUTRAL',
      };
    }

    const prices = priceHistory.map((p) => p.price);
    const rsi = this.calculateRSI(priceHistory);
    const emaFast = this.calculateEMA(prices, 12);
    const emaSlow = this.calculateEMA(prices, 26);

    // Determine trend from EMAs
    const emaCross = emaFast > emaSlow ? 'BULLISH' : emaFast < emaSlow ? 'BEARISH' : 'NEUTRAL';
    const emaDiff = Math.abs((emaFast - emaSlow) / emaSlow) * 100;

    // Trend strength (0-100)
    const trendStrength = Math.min(100, Math.abs(change24h) * 10 + emaDiff * 5);

    // Trading signal
    let signal = 'NEUTRAL';
    if (rsi < 30 && emaCross === 'BULLISH') {
      signal = 'STRONG_BUY'; // Oversold + bullish trend
    } else if (rsi > 70 && emaCross === 'BEARISH') {
      signal = 'STRONG_SELL'; // Overbought + bearish trend
    } else if (rsi < 40 && change24h > 0) {
      signal = 'BUY'; // Recovering from oversold
    } else if (rsi > 60 && change24h < 0) {
      signal = 'SELL'; // Declining from overbought
    }

    return {
      rsi: Math.round(rsi),
      trend: emaCross,
      trendStrength: Math.round(trendStrength),
      emaFast: emaFast.toFixed(2),
      emaSlow: emaSlow.toFixed(2),
      emaCross,
      signal,
    };
  }

  /**
   * Calculate volatility-adjusted position size
   * @param {number} baseSize - Base position size in USDC
   * @param {number} volatility - 24h price change percentage
   * @param {number} maxSize - Maximum allowed position size
   * @returns {number} Adjusted position size
   */
  static adjustPositionSize(baseSize, volatility, maxSize) {
    const absVolatility = Math.abs(volatility);

    // Reduce size in high volatility
    if (absVolatility > 10) {
      return Math.round(baseSize * 0.3); // 30% of base in extreme volatility
    } else if (absVolatility > 5) {
      return Math.round(baseSize * 0.5); // 50% in high volatility
    } else if (absVolatility > 2) {
      return Math.round(baseSize * 0.75); // 75% in medium volatility
    }

    // Full size in low volatility
    return Math.min(baseSize, maxSize);
  }

  /**
   * Calculate take profit and stop loss levels
   * @param {string} side - 'LONG' or 'SHORT'
   * @param {number} entryPrice - Entry price
   * @param {number} leverage - Position leverage
   * @returns {Object} {takeProfit, stopLoss}
   */
  static calculateExitLevels(side, entryPrice, leverage = 2) {
    // With 2x leverage:
    // - Take profit at +20% (40% profit on capital)
    // - Stop loss at -8% (-16% loss on capital, well before liquidation)

    const tpPercent = 20 / leverage; // 10% for 2x leverage
    const slPercent = 8 / leverage; // 4% for 2x leverage

    if (side === 'LONG') {
      return {
        takeProfit: entryPrice * (1 + tpPercent / 100),
        stopLoss: entryPrice * (1 - slPercent / 100),
      };
    } else {
      return {
        takeProfit: entryPrice * (1 - tpPercent / 100),
        stopLoss: entryPrice * (1 + slPercent / 100),
      };
    }
  }
}
