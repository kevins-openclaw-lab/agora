/**
 * Automated Market Maker Engine
 * Uses constant product formula: x * y = k
 */

const FEE_RATE = 0.02; // 2% fee

/**
 * Calculate the price of YES shares
 * Price = NO / (YES + NO)
 */
function getYesPrice(yesShares, noShares) {
  return noShares / (yesShares + noShares);
}

/**
 * Calculate the price of NO shares
 * Price = YES / (YES + NO)
 */
function getNoPrice(yesShares, noShares) {
  return yesShares / (yesShares + noShares);
}

/**
 * Calculate shares received for a given amount of AGP
 * 
 * @param {Object} market - Market with yesShares, noShares, k
 * @param {string} outcome - 'yes' or 'no'
 * @param {number} amount - AGP to spend
 * @returns {Object} Trade details
 */
function calculateTrade(market, outcome, amount) {
  const fee = Math.floor(amount * FEE_RATE);
  const netAmount = amount - fee;
  
  let { yes_shares: yesShares, no_shares: noShares, k } = market;
  let shares, newYesShares, newNoShares;
  
  if (outcome === 'yes') {
    // Buying YES: add AGP worth of "value" to NO side, remove YES
    // New state: (yesShares - shares) * (noShares + netAmount) = k
    // But we need to think of it differently...
    // 
    // Actually, the AMM holds shares. When you buy YES:
    // - You give AGP (converted to pool value)
    // - Pool gives you YES shares
    // 
    // Simpler model: treat AGP as adding to the opposite side
    newNoShares = noShares + netAmount;
    newYesShares = k / newNoShares;
    shares = yesShares - newYesShares;
  } else {
    // Buying NO: add to YES side, remove NO
    newYesShares = yesShares + netAmount;
    newNoShares = k / newYesShares;
    shares = noShares - newNoShares;
  }
  
  if (shares <= 0) {
    throw new Error('Trade too large for available liquidity');
  }
  
  const avgPrice = netAmount / shares;
  
  return {
    shares: Math.round(shares * 1000) / 1000, // Round to 3 decimals
    fee,
    netAmount,
    avgPrice: Math.round(avgPrice * 1000) / 1000,
    newYesShares: Math.round(newYesShares * 1000) / 1000,
    newNoShares: Math.round(newNoShares * 1000) / 1000,
    newYesPrice: getYesPrice(newYesShares, newNoShares),
    newNoPrice: getNoPrice(newYesShares, newNoShares)
  };
}

/**
 * Create initial pool for a market
 * 
 * @param {number} liquidity - Initial AGP to seed
 * @returns {Object} Initial pool state
 */
function createPool(liquidity) {
  // Start with 50/50 odds
  // Split liquidity equally between YES and NO sides
  const shares = liquidity / 2;
  return {
    yesShares: shares,
    noShares: shares,
    k: shares * shares
  };
}

/**
 * Calculate payout for shares when market resolves
 * 
 * @param {Object} market - Resolved market
 * @param {Object} position - Agent's position
 * @returns {number} Payout in AGP
 */
function calculatePayout(market, position) {
  if (market.status !== 'resolved') {
    throw new Error('Market not resolved');
  }
  
  const winningShares = market.resolution === 'yes' 
    ? position.yes_shares 
    : position.no_shares;
  
  // Payout = winning shares (they convert 1:1 to AGP on resolution)
  return Math.floor(winningShares);
}

module.exports = {
  FEE_RATE,
  getYesPrice,
  getNoPrice,
  calculateTrade,
  createPool,
  calculatePayout
};
