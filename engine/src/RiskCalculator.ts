/*
 * RiskCalculator — Mathematical Risk Engine
 *
 * Uses string-based decimal arithmetic to avoid floating-point rounding errors
 * in position sizing, P&L, and fee calculations. All monetary values are
 * represented as strings in the form "123.456789" and manipulated with
 * safe arithmetic helpers.
 */

// ─── Decimal Arithmetic Helpers (string-based, no float) ───

function normalizeDecimal(str: string): string {
  if (!str || str === '0' || str === '0.0' || str === '0.00') return '0';
  const negative = str.startsWith('-');
  let s = negative ? str.slice(1) : str;
  if (!s.includes('.')) s = s + '.0';
  s = s.replace(/0+$/, '');
  s = s.replace(/\.$/, '');
  if (s === '' || s === '0') return '0';
  return (negative ? '-' : '') + s;
}

function getDecimalPlaces(str: string): number {
  const parts = str.split('.');
  return parts.length > 1 ? parts[1].length : 0;
}

function shiftRight(str: string, places: number): string {
  if (str === '0') return '0';
  const negative = str.startsWith('-');
  let s = negative ? str.slice(1) : str;
  const dotIndex = s.indexOf('.');
  if (dotIndex === -1) {
    s = s + '0'.repeat(places);
  } else {
    const intPart = s.slice(0, dotIndex);
    const decPart = s.slice(dotIndex + 1);
    if (decPart.length >= places) {
      s = intPart + decPart.slice(0, places) + '.' + decPart.slice(places);
    } else {
      s = intPart + decPart + '0'.repeat(places - decPart.length);
    }
  }
  return (negative ? '-' : '') + normalizeDecimal(s);
}

function shiftLeft(str: string, places: number): string {
  if (str === '0') return '0';
  const negative = str.startsWith('-');
  let s = negative ? str.slice(1) : str;
  s = s.replace('.', '');
  while (s.length <= places) s = '0' + s;
  const insertPos = s.length - places;
  s = s.slice(0, insertPos) + '.' + s.slice(insertPos);
  return (negative ? '-' : '') + normalizeDecimal(s);
}

export function addDecimals(a: string, b: string): string {
  const maxPlaces = Math.max(getDecimalPlaces(a), getDecimalPlaces(b));
  const ai = shiftRight(a, maxPlaces);
  const bi = shiftRight(b, maxPlaces);
  const result = BigInt(ai) + BigInt(bi);
  return normalizeDecimal(shiftLeft(result.toString(), maxPlaces));
}

export function subtractDecimals(a: string, b: string): string {
  const maxPlaces = Math.max(getDecimalPlaces(a), getDecimalPlaces(b));
  const ai = shiftRight(a, maxPlaces);
  const bi = shiftRight(b, maxPlaces);
  const result = BigInt(ai) - BigInt(bi);
  return normalizeDecimal(shiftLeft(result.toString(), maxPlaces));
}

export function multiplyDecimals(a: string, b: string): string {
  const aPlaces = getDecimalPlaces(a);
  const bPlaces = getDecimalPlaces(b);
  const totalPlaces = aPlaces + bPlaces;
  const ai = a.replace('.', '').replace('-', '');
  const bi = b.replace('.', '').replace('-', '');
  const negative = (a.startsWith('-') || b.startsWith('-')) && !(a.startsWith('-') && b.startsWith('-'));
  const result = BigInt(ai) * BigInt(bi);
  const raw = shiftLeft(result.toString(), totalPlaces);
  return negative ? normalizeDecimal('-' + raw) : normalizeDecimal(raw);
}

export function divideDecimals(a: string, b: string, precision: number = 18): string {
  if (b === '0') throw new Error('Division by zero');
  const aPlaces = getDecimalPlaces(a);
  const bPlaces = getDecimalPlaces(b);
  const shift = bPlaces - aPlaces + precision;
  const ai = a.replace('.', '').replace('-', '');
  const bi = b.replace('.', '').replace('-', '');
  const negative = (a.startsWith('-') || b.startsWith('-')) && !(a.startsWith('-') && b.startsWith('-'));
  let dividend = BigInt(ai);
  if (shift > 0) dividend = dividend * BigInt(10 ** shift);
  else if (shift < 0) {
    const divisor = BigInt(10 ** Math.abs(shift));
    dividend = dividend / divisor;
  }
  const result = dividend / BigInt(bi);
  const raw = shiftLeft(result.toString(), precision);
  return negative ? normalizeDecimal('-' + raw) : normalizeDecimal(raw);
}

export function compareDecimals(a: string, b: string): number {
  const maxPlaces = Math.max(getDecimalPlaces(a), getDecimalPlaces(b));
  const ai = BigInt(shiftRight(a, maxPlaces));
  const bi = BigInt(shiftRight(b, maxPlaces));
  if (ai < bi) return -1;
  if (ai > bi) return 1;
  return 0;
}

export function absDecimal(a: string): string {
  return a.startsWith('-') ? a.slice(1) : a;
}

// ─── Types ───

export interface RiskConfig {
  maxTradesPerDay: number;
  maxDailyLossThreshold: string;
  maxDrawdownPct: string;
  tpPct: string;
  slPct: string;
  maxLeverage: number;
  tradeSizing: 'fixed_quote' | 'percent_balance' | 'risk_based';
  sizingValue: string;
  riskPerTradePct: string;
  maxNotional: string;
  trailingEnabled: boolean;
  trailingDistancePct: string;
}

export interface ValidationContext {
  licenseValid: boolean;
  licenseExpiry: string | null;
  botStatus: 'active' | 'paused';
  isPaperMode: boolean;
  dailyTradeCount: number;
  dailyLoss: string;
  availableBalance: string;
  currentDrawdownPct: string;
}

export type ValidationRejection =
  | 'LICENSE_INVALID'
  | 'LICENSE_EXPIRED'
  | 'BOT_PAUSED'
  | 'DAILY_TRADE_LIMIT_REACHED'
  | 'DAILY_LOSS_BREACHED'
  | 'INSUFFICIENT_BALANCE'
  | 'MAX_DRAWDOWN_BREACHED'
  | 'MAX_NOTIONAL_EXCEEDED';

export interface ValidationResult {
  approved: boolean;
  rejections: ValidationRejection[];
  isProtectiveExitAllowed: boolean;
  computedSize: string | null;
}

// ─── Position Sizing ───

export function calculatePositionSize(
  config: RiskConfig,
  balance: string,
  entryPrice: string,
): string {
  switch (config.tradeSizing) {
    case 'fixed_quote':
      return config.sizingValue;

    case 'percent_balance': {
      const pct = divideDecimals(config.sizingValue, '100', 18);
      return multiplyDecimals(balance, pct);
    }

    case 'risk_based': {
      const riskPct = divideDecimals(config.riskPerTradePct, '100', 18);
      const riskAmount = multiplyDecimals(balance, riskPct);
      const slPct = divideDecimals(config.slPct, '100', 18);
      if (slPct === '0') return '0';
      const slDistance = multiplyDecimals(entryPrice, slPct);
      if (slDistance === '0') return '0';
      const rawSize = divideDecimals(riskAmount, slDistance, 18);
      if (compareDecimals(rawSize, '0') <= 0) return '0';
      return rawSize;
    }

    default:
      return '0';
  }
}

export function clampNotional(positionSize: string, maxNotional: string): string {
  if (compareDecimals(positionSize, maxNotional) > 0) {
    return maxNotional;
  }
  return positionSize;
}

// ─── Validation Layer ───

export function validateOrder(
  config: RiskConfig,
  ctx: ValidationContext,
  entryPrice: string,
  isProtectiveExit: boolean = false,
): ValidationResult {
  const rejections: ValidationRejection[] = [];

  if (!ctx.licenseValid) {
    rejections.push('LICENSE_INVALID');
  }

  if (ctx.licenseExpiry) {
    const now = new Date();
    const expiry = new Date(ctx.licenseExpiry);
    if (expiry < now) {
      rejections.push('LICENSE_EXPIRED');
    }
  }

  if (ctx.botStatus !== 'active') {
    rejections.push('BOT_PAUSED');
  }

  const dailyLossBreached = compareDecimals(
    absDecimal(ctx.dailyLoss),
    config.maxDailyLossThreshold,
  ) >= 0 && ctx.dailyLoss.startsWith('-');

  if (dailyLossBreached && !isProtectiveExit) {
    rejections.push('DAILY_LOSS_BREACHED');
  }

  if (ctx.dailyTradeCount >= config.maxTradesPerDay && !isProtectiveExit) {
    rejections.push('DAILY_TRADE_LIMIT_REACHED');
  }

  if (compareDecimals(ctx.currentDrawdownPct, config.maxDrawdownPct) >= 0 && !isProtectiveExit) {
    rejections.push('MAX_DRAWDOWN_BREACHED');
  }

  const computedSize = calculatePositionSize(config, ctx.availableBalance, entryPrice);
  const clampedSize = clampNotional(computedSize, config.maxNotional);

  if (!isProtectiveExit) {
    if (compareDecimals(clampedSize, '0') <= 0) {
      rejections.push('INSUFFICIENT_BALANCE');
    }

    if (compareDecimals(clampedSize, ctx.availableBalance) > 0) {
      rejections.push('INSUFFICIENT_BALANCE');
    }

    if (compareDecimals(clampedSize, config.maxNotional) > 0) {
      rejections.push('MAX_NOTIONAL_EXCEEDED');
    }
  }

  const isProtectiveExitAllowed =
    (rejections.includes('DAILY_LOSS_BREACHED') ||
     rejections.includes('DAILY_TRADE_LIMIT_REACHED') ||
     rejections.includes('MAX_DRAWDOWN_BREACHED')) &&
    isProtectiveExit;

  const hardBlocks: ValidationRejection[] = ['LICENSE_INVALID', 'LICENSE_EXPIRED', 'BOT_PAUSED'];
  const hasHardBlock = rejections.some(r => hardBlocks.includes(r));

  const approved = rejections.length === 0 || (isProtectiveExitAllowed && !hasHardBlock);

  return {
    approved,
    rejections,
    isProtectiveExitAllowed,
    computedSize: approved ? clampedSize : null,
  };
}

// ─── P&L Calculation ───

export function calculatePnl(
  entryPrice: string,
  exitPrice: string,
  quantity: string,
  direction: 'long' | 'short',
  leverage: number = 1,
): string {
  const priceDiff = direction === 'long'
    ? subtractDecimals(exitPrice, entryPrice)
    : subtractDecimals(entryPrice, exitPrice);

  const grossPnl = multiplyDecimals(priceDiff, quantity);
  const leverageStr = leverage.toString();
  const leveragedPnl = multiplyDecimals(grossPnl, leverageStr);
  return leveragedPnl;
}

export function calculateDrawdownPct(currentEquity: string, peakEquity: string): string {
  if (compareDecimals(peakEquity, '0') <= 0) return '0';
  const diff = subtractDecimals(peakEquity, currentEquity);
  if (compareDecimals(diff, '0') <= 0) return '0';
  const pct = divideDecimals(diff, peakEquity, 18);
  return multiplyDecimals(pct, '100');
}
