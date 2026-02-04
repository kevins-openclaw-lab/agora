/**
 * Automated Market Maker (AMM) Engine
 * Uses Constant Product formula: x * y = k
 * 
 * How it works:
 * - Market has YES and NO share pools
 * - Buying YES removes from YES pool, adds to NO pool (and vice versa)
 * - Price = opposite_pool / (yes_pool + no_pool)
 * - k remains constant, ensuring prices move with trades
 */

const FEE_RATE = 0.02; // 2% fee on trades
const MIN_SHARES = 0.001; // Prevent division by zero

/**
 * Calculate current probability (price of YES outcome)
 * Price = no_shares / (yes_shares + no_shares)
 */
function getPrice(yesShares, noShares) {
  const total = yesShares + noShares;
  if (total === 0) return 0.5;
  return noShares / total;
}

/**
 * Calculate how many shares you get for a given AGP amount
 * Using constant product: x * y = k
 * 
 * When buying YES:
 * - New yes_shares = yes_shares - shares_out
 * - New no_shares = no_shares + (amount - fee)
 * - k = yes_shares * no_shares = (yes_shares - shares_out) * (no_shares + net_amount)
 * 
 * Solving for shares_out:
 * shares_out = yes_shares - (k / (no_shares + net_amount))
 */
function calculateBuy(yesShares, noShares, amount, outcome) {
  const fee = Math.floor(amount * FEE_RATE);
  const netAmount = amount - fee;
  
  if (netAmount <= 0) {
    return { shares: 0, fee, avgPrice: 0, newYes: yesShares, newNo: noShares };
  }
  
  const k = yesShares * noShares;
  let sharesOut, newYes, newNo;
  
  if (outcome === 'yes') {
    // Buying YES: add to NO pool, remove from YES pool
    newNo = noShares + netAmount;
    newYes = k / newNo;
    sharesOut = yesShares - newYes;
  } else {
    // Buying NO: add to YES pool, remove from NO pool
    newYes = yesShares + netAmount;
    newNo = k / newYes;
    sharesOut = noShares - newNo;
  }
  
  // Ensure we don't drain pools completely
  if (newYes < MIN_SHARES) newYes = MIN_SHARES;
  if (newNo < MIN_SHARES) newNo = MIN_SHARES;
  
  const avgPrice = sharesOut > 0 ? netAmount / sharesOut : 0;
  
  return {
    shares: Math.max(0, sharesOut),
    fee,
    avgPrice,
    newYes: Math.max(MIN_SHARES, newYes),
    newNo: Math.max(MIN_SHARES, newNo)
  };
}

/**
 * Calculate how much AGP you get for selling shares
 * Inverse of buying: shares go back to pool, AGP comes out
 */
function calculateSell(yesShares, noShares, shares, outcome) {
  if (shares <= 0) {
    return { amount: 0, fee: 0, avgPrice: 0, newYes: yesShares, newNo: noShares };
  }
  
  const k = yesShares * noShares;
  let grossAmount, newYes, newNo;
  
  if (outcome === 'yes') {
    // Selling YES: add to YES pool, remove from NO pool
    newYes = yesShares + shares;
    newNo = k / newYes;
    grossAmount = noShares - newNo;
  } else {
    // Selling NO: add to NO pool, remove from YES pool
    newNo = noShares + shares;
    newYes = k / newNo;
    grossAmount = yesShares - newYes;
  }
  
  // Ensure we don't drain pools completely
  if (newYes < MIN_SHARES) newYes = MIN_SHARES;
  if (newNo < MIN_SHARES) newNo = MIN_SHARES;
  
  const fee = Math.floor(grossAmount * FEE_RATE);
  const netAmount = Math.max(0, Math.floor(grossAmount - fee));
  const avgPrice = shares > 0 ? netAmount / shares : 0;
  
  return {
    amount: netAmount,
    fee,
    avgPrice,
    newYes: Math.max(MIN_SHARES, newYes),
    newNo: Math.max(MIN_SHARES, newNo)
  };
}

/**
 * Initialize a new market with given liquidity
 * Equal YES/NO shares = 50% starting probability
 */
function initializeMarket(liquidity) {
  const shares = liquidity / 2;
  return {
    yesShares: shares,
    noShares: shares,
    k: shares * shares
  };
}

/**
 * Calculate payout when market resolves
 * Winners get 1 AGP per share, losers get 0
 */
function calculatePayout(position, resolution) {
  if (resolution === 'yes') {
    return Math.floor(position.yes_shares);
  } else if (resolution === 'no') {
    return Math.floor(position.no_shares);
  }
  // Cancelled or invalid - return proportional refund
  return 0;
}

/**
 * Calculate Brier score for a prediction
 * Brier = (forecast - outcome)^2
 * Lower is better (0 = perfect, 1 = worst)
 */
function calculateBrier(probability, actualOutcome) {
  const outcome = actualOutcome === 'yes' ? 1 : 0;
  return Math.pow(probability - outcome, 2);
}

module.exports = {
  FEE_RATE,
  getPrice,
  calculateBuy,
  calculateSell,
  initializeMarket,
  calculatePayout,
  calculateBrier
};
