import { useState, useEffect, useRef } from 'react';
import {
  Bot, Layers, Coins, Crosshair, Shield, DollarSign, Rocket, Zap,
  TrendingUp, TrendingDown, Check, Loader2, Target, Gauge,
  Activity, Clock, Flame, CircuitBoard,
  ArrowDownRight, ArrowUpRight, Power,
  AlertOctagon, Lock, RefreshCw, Sparkles,
  Unlock, Trophy, SlidersHorizontal,
} from 'lucide-react';
import { useApp } from '@/context/AppContext';
import { useAuth } from '@/context/AuthContext';
import { useLivePrices } from '@/hooks/useLivePrices';
import { supabase, type RiskSettings, type Bot as BotRecord, type License, type BotTemplate } from '@/lib/supabase';
import { normalizePlan, PLAN_RULES, isStrategyUnlocked, getPlanStrategySummary, type PlanType } from '@/lib/planRules';
import { STRATEGY_CATALOG, mergeTemplatesWithCatalog, type StrategyEntry } from '@/lib/strategyCatalog';
import BacktestModal from '@/components/BacktestModal';
import type { BotFactoryDraft } from '@/components/admin/BotFactoryModal';

type MarketType = 'futures';
type OrderType = 'market';
type TradeDirection = 'long' | 'short' | 'auto';
type BotType = 'scalper' | 'dca' | 'grid' | 'copier' | 'martingale';
type IndicatorTrigger = 'RSI' | 'MACD' | 'EMA Crossover' | 'SMC Order Blocks' | 'None';
type QuantityMode = 'fixed' | 'quantity';
type TpSlMode = 'percentage' | 'fixed';

const indicatorOptions: IndicatorTrigger[] = ['RSI', 'MACD', 'EMA Crossover', 'SMC Order Blocks', 'None'];

export default function AISmartBotView() {
  const { formatInr } = useApp();
  const { coins } = useLivePrices();

  // Market & Asset
  const [marketType] = useState<MarketType>('futures');
  const [leverage, setLeverage] = useState(10);
  const [selectedCoin, setSelectedCoin] = useState('BTC');
  const [coinSearch, setCoinSearch] = useState('');
  const [botType, setBotType] = useState<BotType>('scalper');
  const [tradeDirection, setTradeDirection] = useState<TradeDirection>('long');
  const [capital, setCapital] = useState(100);
  const [launched, setLaunched] = useState(false);
  const [launching, setLaunching] = useState(false);

  // Entry Logic
  const [orderType] = useState<OrderType>('market');
  const [indicatorsEnabled, setIndicatorsEnabled] = useState(false);
  const [indicator, setIndicator] = useState<IndicatorTrigger>('RSI');

  // Position & Execution
  const [quantityMode, setQuantityMode] = useState<QuantityMode>('fixed');
  const [quantityValue, setQuantityValue] = useState(100);
  const [tradeQuantity, setTradeQuantity] = useState(0.1);
  const [maxTradesPerDay, setMaxTradesPerDay] = useState(20);


  // Advanced Exit & SL/TP
  const [tpSlMode, setTpSlMode] = useState<TpSlMode>('percentage');
  const [takeProfit, setTakeProfit] = useState(5);
  const [stopLoss, setStopLoss] = useState(2);
  const [tpFixed, setTpFixed] = useState(100);
  const [slFixed, setSlFixed] = useState(50);
  const [trailingEnabled, setTrailingEnabled] = useState(false);
  const [trailingDistance, setTrailingDistance] = useState(1.5);

  // Daily Safety Limits
  const [maxDailyLoss, setMaxDailyLoss] = useState(500);
  const [maxDailyProfit, setMaxDailyProfit] = useState(1000);
  const [cooldownMinutes, setCooldownMinutes] = useState(15);

  // Martingale Strategy Parameters
  const [martingaleMultiplier, setMartingaleMultiplier] = useState(2.0);
  const [martingaleSteps, setMartingaleSteps] = useState(3);
  const [martingaleTemplate, setMartingaleTemplate] = useState<{ multiplier: number; steps: number } | null>(null);

  // Backtest modal
  const [showBacktest, setShowBacktest] = useState(false);
  const [killSwitch, setKillSwitch] = useState(false);
  const [license, setLicense] = useState<License | null>(null);
  const [planType, setPlanType] = useState<PlanType>('starter');
  const [activeBotCount, setActiveBotCount] = useState(0);
  const [gateMessage, setGateMessage] = useState<string | null>(null);
  const [assignedCustomBots, setAssignedCustomBots] = useState<BotTemplate[]>([]);

  const [exchangeBalance, setExchangeBalance] = useState(0);
  const [hasConnectedBroker, setHasConnectedBroker] = useState(false);
  const { session } = useAuth();

  // Strategy carousel
  const [selectedStrategyId, setSelectedStrategyId] = useState<string | null>(null);
  const [instantTrade, setInstantTrade] = useState(true);
  const [strategyToast, setStrategyToast] = useState<{ type: 'success' | 'locked'; text: string } | null>(null);
  const [mergedStrategies, setMergedStrategies] = useState<StrategyEntry[]>(STRATEGY_CATALOG);
  const [showConfigForm, setShowConfigForm] = useState(false);
  const configFormRef = useRef<HTMLDivElement>(null);

  const handleSelectStrategy = (strategy: StrategyEntry) => {
    if (!isStrategyUnlocked(planType, strategy.id, mergedStrategies)) {
      const tier = strategy.tier === 'enterprise' ? 'Enterprise (all 10 strategies)' : 'Pro (4 strategies)';
      setStrategyToast({ type: 'locked', text: `${strategy.name} requires ${tier}. Upgrade to unlock this strategy.` });
      setTimeout(() => setStrategyToast(null), 6000);
      return;
    }
    setSelectedStrategyId(strategy.id);
    setBotType(strategy.engine);
    setTakeProfit(strategy.takeProfit);
    setStopLoss(strategy.stopLoss);
    if (strategy.indicator !== 'None') {
      setIndicatorsEnabled(true);
      setIndicator(strategy.indicator as IndicatorTrigger);
    } else {
      setIndicatorsEnabled(false);
    }
    setStrategyToast({ type: 'success', text: `${strategy.name} loaded — ${strategy.winRate} win rate, ${strategy.engine} engine. Adjust settings and launch!` });
    setTimeout(() => setStrategyToast(null), 4000);
    setShowConfigForm(true);
    setTimeout(() => {
      configFormRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 100);
  };

  const isLicenseExpired = (lic: License | null): boolean => {
    if (!lic) return true;
    if (!lic.is_active) return true;
    if (lic.valid_until && new Date(lic.valid_until) < new Date()) return true;
    return false;
  };

  const licenseActive = !isLicenseExpired(license);

  const allowedBotTypes: string[] = license?.allowed_bots ?? [];
  const isBotTypeAllowed = (bt: string) => allowedBotTypes.length === 0 || allowedBotTypes.includes(bt);

  useEffect(() => {
    supabase
      .from('risk_settings')
      .select('*')
      .limit(1)
      .maybeSingle()
      .then(({ data }) => {
        setKillSwitch((data as RiskSettings | null)?.global_kill_switch ?? false);
      });

    if (session?.user?.id) {
      Promise.all([
        supabase
          .from('licenses')
          .select('*')
          .eq('user_id', session.user.id)
          .eq('is_active', true)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle(),
        supabase
          .from('bots')
          .select('id', { count: 'exact', head: true })
          .in('status', ['running']),
        supabase
          .from('broker_keys')
          .select('id, exchange_name')
          .eq('user_id', session.user.id)
          .eq('is_connected', true)
          .limit(1),
        supabase
          .from('user_funds')
          .select('balance')
          .eq('user_id', session.user.id)
          .order('created_at', { ascending: false }),
      ]).then(([licenseResult, botsResult, brokerResult, fundsResult]) => {
        const activeLicense = licenseResult.data as License | null;
        const nextPlan = normalizePlan(activeLicense?.plan_name);
        setLicense(activeLicense);
        setPlanType(nextPlan);
        setActiveBotCount(botsResult.count ?? 0);
        setLeverage(current => Math.min(current, PLAN_RULES[nextPlan].maxLeverage));

        const hasBroker = (brokerResult.data?.length ?? 0) > 0;
        setHasConnectedBroker(hasBroker);
        const funds = (fundsResult.data as { balance: number }[]) ?? [];
        setExchangeBalance(funds.reduce((s, f) => s + f.balance, 0));
      });
    }

    // Load most recently created bot to restore its config
    supabase
      .from('bots')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
      .then(({ data }) => {
        const bot = data as BotRecord | null;
        if (!bot) return;
        if (bot.bot_type) setBotType(bot.bot_type);
        if (bot.trade_direction) setTradeDirection(bot.trade_direction);

        if (bot.coin) setSelectedCoin(bot.coin);
        if (bot.leverage != null) setLeverage(bot.leverage);
        if (bot.capital != null) setCapital(Number(bot.capital));

        if (bot.indicators_enabled != null) setIndicatorsEnabled(bot.indicators_enabled);
        if (bot.indicator) setIndicator(bot.indicator as IndicatorTrigger);
        if (bot.quantity_mode) setQuantityMode(bot.quantity_mode === 'percent' ? 'quantity' : bot.quantity_mode as QuantityMode);
        if (bot.quantity_value != null) setQuantityValue(Number(bot.quantity_value));
        if (bot.percent_value != null) setTradeQuantity(Number(bot.percent_value));
        if (bot.max_trades_per_day != null) setMaxTradesPerDay(bot.max_trades_per_day);
        if (bot.tp_sl_mode) setTpSlMode(bot.tp_sl_mode);
        if (bot.take_profit != null) setTakeProfit(Number(bot.take_profit));
        if (bot.stop_loss != null) setStopLoss(Number(bot.stop_loss));
        if (bot.tp_fixed != null) setTpFixed(Number(bot.tp_fixed));
        if (bot.sl_fixed != null) setSlFixed(Number(bot.sl_fixed));
        if (bot.trailing_enabled != null) setTrailingEnabled(bot.trailing_enabled);
        if (bot.trailing_distance != null) setTrailingDistance(Number(bot.trailing_distance));
        if (bot.max_daily_loss != null) setMaxDailyLoss(Number(bot.max_daily_loss));
        if (bot.max_daily_profit != null) setMaxDailyProfit(Number(bot.max_daily_profit));
        if (bot.cooldown_minutes != null) setCooldownMinutes(bot.cooldown_minutes);
        if (bot.martingale_multiplier != null) setMartingaleMultiplier(Number(bot.martingale_multiplier));
        if (bot.max_martingale_steps != null) setMartingaleSteps(bot.max_martingale_steps);
      });

    // Fetch martingale bot template to get admin-defined ceilings
    supabase
      .from('bot_templates')
      .select('martingale_multiplier, max_martingale_steps')
      .eq('bot_type', 'martingale')
      .eq('is_public', true)
      .neq('status', 'paused')
      .limit(1)
      .maybeSingle()
      .then(({ data }) => {
        if (data) setMartingaleTemplate({ multiplier: Number(data.martingale_multiplier), steps: data.max_martingale_steps });
      });

    // Fetch admin-assigned custom bot templates (read-only for customer)
    supabase
      .from('bot_templates')
      .select('*')
      .eq('bot_type', 'custom')
      .eq('is_public', true)
      .neq('status', 'paused')
      .order('created_at', { ascending: false })
      .then(({ data }) => {
        if (data) setAssignedCustomBots(data as BotTemplate[]);
      });

    // Fetch all active bot_templates and merge with catalog — admin controls which strategies appear in the UI
    const fetchStrategies = () => {
      supabase
        .from('bot_templates')
        .select('*')
        .neq('status', 'paused')
        .order('created_at', { ascending: true })
        .then(({ data }) => {
          const templates = (data as BotTemplate[]) ?? [];
          const merged = mergeTemplatesWithCatalog(templates);
          if (merged.length > 0) setMergedStrategies(merged);
        });
    };
    fetchStrategies();

    // Realtime: bot_templates table (admin creates/pauses/deletes bots)
    supabase
      .channel('ai_bot_templates_realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'bot_templates' }, fetchStrategies)
      .subscribe();
  }, [session]);

  const planRule = PLAN_RULES[planType];
  const selectedCoinData = coins.find(c => c.symbol === selectedCoin) || coins[0] || { symbol: 'BTC', name: 'Bitcoin', price: 67000, change24h: 0, volume24h: 0, quoteVolume24h: 0, high24h: 0, low24h: 0, sparkline: [] };
  const filteredCoins = coins.filter(c =>
    c.symbol.toLowerCase().includes(coinSearch.toLowerCase()) ||
    c.name.toLowerCase().includes(coinSearch.toLowerCase())
  );

  const PNL_USD_INR = 102;
  const effectiveCapital = quantityMode === 'fixed' ? quantityValue : (tradeQuantity * selectedCoinData.price);
  const positionSize = effectiveCapital * leverage;
  // CEO DIRECTIVE: positionSize is in INR. The live asset price is in USD.
  // Convert INR → USD before dividing by price so the quantity is in base-asset
  // units (e.g. ETH), not a meaningless INR/USD hybrid.
  const coinAmount = quantityMode === 'quantity' ? tradeQuantity : (positionSize / PNL_USD_INR) / selectedCoinData.price;

  const tpDisplay = tpSlMode === 'percentage' ? `+${takeProfit}%` : `+${formatInr(tpFixed)}`;
  const slDisplay = tpSlMode === 'percentage' ? `-${stopLoss}%` : `-${formatInr(slFixed)}`;

  // CEO DIRECTIVE: Show the exact live market price needed to hit the user's
  // fixed fiat TP/SL goal. Formula (LONG):
  //   TargetPrice = EntryPrice + (Target_INR / (quantity * 102))
  //   SLPrice     = EntryPrice - (SL_INR / (quantity * 102))
  // For SHORT, +/- reversed. EntryPrice = current live price (pre-launch).
  const liveEntry = selectedCoinData.price > 0 ? selectedCoinData.price : 0;
  const previewQty = coinAmount > 0 ? coinAmount : 0;
  let previewTargetPrice: number | null = null;
  let previewSlPrice: number | null = null;
  if (tpSlMode === 'fixed' && previewQty > 0 && liveEntry > 0) {
    const tpMove = tpFixed / (previewQty * PNL_USD_INR);
    const slMove = slFixed / (previewQty * PNL_USD_INR);
    if (tradeDirection === 'long') {
      previewTargetPrice = liveEntry + tpMove;
      previewSlPrice = liveEntry - slMove;
    } else if (tradeDirection === 'short') {
      previewTargetPrice = liveEntry - tpMove;
      previewSlPrice = liveEntry + slMove;
    } else {
      // auto — show long scenario as default
      previewTargetPrice = liveEntry + tpMove;
      previewSlPrice = liveEntry - slMove;
    }
    if (previewTargetPrice <= 0) previewTargetPrice = null;
    if (previewSlPrice <= 0) previewSlPrice = null;
  } else if (tpSlMode === 'percentage' && liveEntry > 0) {
    // Percentage mode — derive price from ROE-on-margin percentage
    const tpPriceMovePct = takeProfit / (leverage * 100);
    const slPriceMovePct = stopLoss / (leverage * 100);
    if (tradeDirection !== 'short') {
      previewTargetPrice = liveEntry * (1 + tpPriceMovePct);
      previewSlPrice = liveEntry * (1 - slPriceMovePct);
    } else {
      previewTargetPrice = liveEntry * (1 - tpPriceMovePct);
      previewSlPrice = liveEntry * (1 + slPriceMovePct);
    }
  }
  const fmtPreviewPrice = (v: number) => v >= 1000 ? v.toLocaleString(undefined, { maximumFractionDigits: 2 }) : v.toFixed(4);

  const [launchToast, setLaunchToast] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [autoTuneToast, setAutoTuneToast] = useState<{ type: 'success' | 'locked'; text: string } | null>(null);

  const aiAutoTuneEnabled = planRule.aiAutoTune;

  const handleAutoTune = () => {
    if (!aiAutoTuneEnabled) {
      setAutoTuneToast({ type: 'locked', text: 'AI Auto-Tune is a Pro feature. Upgrade to unlock dynamic risk management and boost your win rate.' });
      setTimeout(() => setAutoTuneToast(null), 6000);
      return;
    }
    setTakeProfit(1.5);
    setStopLoss(0.5);
    setTrailingDistance(0.2);
    setTrailingEnabled(true);
    setAutoTuneToast({ type: 'success', text: 'AI applied optimal Pro-Trader risk settings (1:3 R:R).' });
    setTimeout(() => setAutoTuneToast(null), 5000);
  };

  const handleLaunch = async () => {
    if (!license || !license.is_active) {
      setGateMessage('No active subscription. Please upgrade your plan to deploy bots.');
      return;
    }
    if (license.valid_until && new Date(license.valid_until) < new Date()) {
      setGateMessage('Your subscription has expired. Please upgrade/renew.');
      return;
    }
    if (!hasConnectedBroker) {
      setGateMessage('No connected exchange. Please connect your broker API before deploying a live bot.');
      return;
    }
    if (effectiveCapital > exchangeBalance) {
      setGateMessage(`Insufficient Exchange Funds: Your entered capital (${formatInr(effectiveCapital)}) exceeds your connected broker balance (${formatInr(exchangeBalance)}).`);
      return;
    }
    if (activeBotCount >= (planRule.botLimit ?? Number.MAX_SAFE_INTEGER)) {
      setGateMessage('Plan Limit Reached: your active bot allowance is full. Please upgrade your subscription to access this.');
      return;
    }
    if (leverage > planRule.maxLeverage) {
      setGateMessage(`Plan Limit Reached: ${planRule.label} allows up to ${planRule.maxLeverage}x leverage.`);
      return;
    }
    if (selectedStrategyId && !isStrategyUnlocked(planType, selectedStrategyId, mergedStrategies)) {
      setGateMessage('Strategy locked for your plan. Please upgrade to deploy this strategy.');
      return;
    }
    setGateMessage(null);
    setLaunching(true);
    const strategyName = selectedStrategyId ? mergedStrategies.find(s => s.id === selectedStrategyId)?.name : null;
    const botName = strategyName
      ? `${strategyName} — ${selectedCoin}`
      : `Custom Cortex Bot — ${selectedCoin} ${botType.charAt(0).toUpperCase() + botType.slice(1)}`;
    try {
      const { data: botData, error } = await supabase.from('bots').insert({
        name: botName,
        market_type: 'futures',
        coin: selectedCoin,
        strategy: botType,
        status: 'running',
        profit_loss: 0,
        trade_direction: tradeDirection,
        bot_type: botType,
        order_type: 'market',
        leverage: leverage,
        capital,
        indicators_enabled: indicatorsEnabled,
        indicator: indicatorsEnabled ? indicator : null,
        quantity_mode: quantityMode,
        quantity_value: quantityValue,
        percent_value: tradeQuantity,
        max_trades_per_day: maxTradesPerDay,
        rr_ratio: null,
        tp_sl_mode: tpSlMode,
        take_profit: takeProfit,
        stop_loss: stopLoss,
        tp_fixed: tpFixed,
        sl_fixed: slFixed,
        trailing_enabled: trailingEnabled,
        trailing_distance: trailingEnabled ? trailingDistance : null,
        max_daily_loss: maxDailyLoss,
        max_daily_profit: maxDailyProfit,
        cooldown_minutes: cooldownMinutes,
        martingale_multiplier: botType === 'martingale' ? martingaleMultiplier : null,
        max_martingale_steps: botType === 'martingale' ? martingaleSteps : null,
        is_paper_mode: false,
        strategy_id: selectedStrategyId ?? null,
      });
      if (error) {
        const msg = error.message;
        setGateMessage(msg);
        setLaunchToast({ type: 'error', text: msg });
        setTimeout(() => setLaunchToast(null), 6000);
        return;
      }
      setActiveBotCount(count => count + 1);
      setLaunched(true);
      setLaunchToast({ type: 'success', text: 'Bot launched successfully! View it in Trading Status.' });

      // Instant first trade execution via execute-trade edge function
      if (instantTrade && botData) {
        try {
          const { data: { session: currentSession } } = await supabase.auth.getSession();
          const tradeResp = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/execute-trade`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${currentSession?.access_token ?? ''}`,
              'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
            },
            body: JSON.stringify({
              botId: (botData as { id: string }).id,
              action: 'open',
            }),
          });
          if (!tradeResp.ok) {
            const tradeErr = await tradeResp.json().catch(() => ({})) as { error?: string; detail?: string; attemptedPayload?: unknown; debug?: unknown; exchangeResponse?: unknown };
            console.log('[EXECUTE-TRADE ERROR] Full response:', tradeErr);
            if (tradeErr.attemptedPayload) console.log('[EXECUTE-TRADE ERROR] Attempted payload:', tradeErr.attemptedPayload);
            if (tradeErr.debug) console.log('[EXECUTE-TRADE ERROR] Debug info:', tradeErr.debug);
            if (tradeErr.exchangeResponse) console.log('[EXECUTE-TRADE ERROR] CoinDCX raw response:', tradeErr.exchangeResponse);
            const rawErr = tradeErr.error ?? tradeErr.detail ?? `Trade failed (HTTP ${tradeResp.status})`;
            setLaunchToast({ type: 'error', text: rawErr });
            setTimeout(() => setLaunchToast(null), 8000);
          }
        } catch (tradeErr) {
          const msg = (tradeErr as Error).message || 'Instant trade failed — bot still runs, cron will pick up next cycle.';
          setLaunchToast({ type: 'error', text: msg });
          setTimeout(() => setLaunchToast(null), 8000);
        }
      }

      setTimeout(() => {
        setLaunched(false);
        setLaunchToast(null);
      }, 4000);
    } catch (err) {
      const msg = (err as Error).message || 'The bot could not be launched. Please try again.';
      setGateMessage(msg);
      setLaunchToast({ type: 'error', text: msg });
      setTimeout(() => setLaunchToast(null), 6000);
    } finally {
      setLaunching(false);
    }
  };

  return (
    <div className="space-y-5 animate-slide-up max-w-5xl">
      {/* Header */}
      <div className="flex items-center gap-4">
        <div className="w-12 h-12 rounded-2xl bg-neon-cyan/10 border border-neon-cyan/30 flex items-center justify-center neon-glow-cyan">
          <Bot className="w-6 h-6 text-neon-cyan" />
        </div>
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-xl font-bold text-white">AI Smart Bot Builder</h2>
            <span className="px-2 py-0.5 rounded-md bg-neon-green/15 text-neon-green text-[10px] font-bold neon-glow-green">ULTIMATE</span>
          </div>
          <p className="text-sm text-slate-400">Design and launch your custom AI-powered algorithmic trading bot</p>
        </div>
      </div>

      {/* Kill Switch Banner */}
      {killSwitch && (
        <div className="rounded-2xl bg-neon-red/10 border border-neon-red/30 p-4 flex items-center gap-3 animate-slide-up">
          <div className="w-10 h-10 rounded-xl bg-neon-red/15 border border-neon-red/30 flex items-center justify-center flex-shrink-0">
            <AlertOctagon className="w-5 h-5 text-neon-red" />
          </div>
          <div>
            <p className="text-sm font-bold text-neon-red">Platform Execution Paused by Master Admin</p>
            <p className="text-xs text-slate-400 mt-0.5">Bot deployment is temporarily disabled. You can still configure your strategy and run backtests.</p>
          </div>
        </div>
      )}

      {/* Live Mode Indicator */}
      <div className="rounded-2xl border p-3 flex items-center gap-3 bg-neon-green/5 border-neon-green/20">
        <div className="w-8 h-8 rounded-lg border flex items-center justify-center flex-shrink-0 bg-neon-green/10 border-neon-green/30">
          <Zap className="w-4 h-4 text-neon-green" />
        </div>
        <div className="flex-1">
          <p className="text-xs font-bold text-neon-green">Live Trading Mode Active</p>
          <p className="text-[10px] text-slate-500">Bots execute live trades via connected broker APIs. Use with caution.</p>
        </div>
      </div>

      {/* 10 Institutional AI Strategies Grid */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-base font-bold text-white flex items-center gap-2">
            <Trophy className="w-5 h-5 text-neon-cyan" />
            {mergedStrategies.length} Institutional AI Strategies
          </h3>
          <span className={`px-3 py-1.5 rounded-lg text-xs font-bold ${
            planType === 'enterprise' ? 'bg-neon-amber/15 text-neon-amber border border-neon-amber/30'
            : planType === 'pro' ? 'bg-neon-green/15 text-neon-green border border-neon-green/30'
            : 'bg-neon-cyan/15 text-neon-cyan border border-neon-cyan/30'
          }`}>
            Your Plan: {PLAN_RULES[planType].label} — {getPlanStrategySummary(planType)}
          </span>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {mergedStrategies.map((strategy) => {
            const unlocked = isStrategyUnlocked(planType, strategy.id, mergedStrategies);
            const selected = selectedStrategyId === strategy.id;
            const tierColor = strategy.tier === 'starter' ? 'cyan' : strategy.tier === 'pro' ? 'green' : 'amber';
            const a = tierColor === 'cyan' ? { text: 'text-neon-cyan', bg: 'bg-neon-cyan/10', border: 'border-neon-cyan/30' }
              : tierColor === 'green' ? { text: 'text-neon-green', bg: 'bg-neon-green/10', border: 'border-neon-green/30' }
              : { text: 'text-neon-amber', bg: 'bg-neon-amber/10', border: 'border-neon-amber/30' };
            const engineIcons: Record<string, typeof Trophy> = { scalper: Zap, dca: Activity, grid: Crosshair, martingale: RefreshCw, copier: Bot };
            const Icon = engineIcons[strategy.engine] || Trophy;
            return (
              <div key={strategy.id} className={`glass-card p-5 relative overflow-hidden group hover:border-white/[0.12] transition-all duration-300 ${!unlocked ? 'opacity-70' : ''} ${selected ? 'border-neon-cyan/40 neon-glow-cyan' : ''}`}>
                <div className={`absolute -top-12 -right-12 w-32 h-32 ${a.bg} rounded-full blur-3xl opacity-30 group-hover:opacity-60 transition-opacity`} />
                {!unlocked && (
                  <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-base-900/60 backdrop-blur-sm rounded-2xl">
                    <div className="w-12 h-12 rounded-xl bg-neon-amber/10 border border-neon-amber/30 flex items-center justify-center mb-3">
                      <Lock className="w-6 h-6 text-neon-amber" />
                    </div>
                    <p className="text-sm font-bold text-white mb-1">LOCKED</p>
                    <p className="text-xs text-slate-400 text-center px-4 mb-1">Requires {strategy.tier === 'enterprise' ? 'Enterprise' : 'Pro'} plan</p>
                    <button onClick={() => { const event = new CustomEvent('navigate', { detail: 'my-subscription' }); window.dispatchEvent(event); }} className="px-4 py-2 rounded-xl bg-neon-amber/15 text-neon-amber border border-neon-amber/30 hover:bg-neon-amber/25 text-xs font-bold transition-all">Upgrade to Unlock</button>
                  </div>
                )}
                <div className="relative">
                  <div className="flex items-start justify-between mb-3">
                    <div className={`w-11 h-11 rounded-xl ${a.bg} ${a.border} border flex items-center justify-center`}>
                      <Icon className={`w-6 h-6 ${a.text}`} />
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      <span className={`px-2 py-1 rounded-md text-[9px] font-bold uppercase tracking-wide ${a.bg} ${a.text}`}>{strategy.tier}</span>
                      {selected && <span className="px-2 py-1 rounded-md text-[9px] font-bold uppercase bg-neon-green/10 text-neon-green flex items-center gap-1"><Check className="w-3 h-3" /> LOADED</span>}
                    </div>
                  </div>
                  <h4 className="text-base font-bold text-white mb-1">{strategy.name}</h4>
                  <p className="text-xs text-slate-400 leading-relaxed mb-3 line-clamp-2">{strategy.description}</p>
                  <div className="grid grid-cols-4 gap-2 mb-4">
                    <div className="text-center py-2 rounded-lg bg-white/[0.03]"><p className="text-[9px] text-slate-500 uppercase mb-0.5">TP</p><p className="text-xs font-bold text-neon-green">{strategy.takeProfit}%</p></div>
                    <div className="text-center py-2 rounded-lg bg-white/[0.03]"><p className="text-[9px] text-slate-500 uppercase mb-0.5">SL</p><p className="text-xs font-bold text-neon-red">{strategy.stopLoss}%</p></div>
                    <div className="text-center py-2 rounded-lg bg-white/[0.03]"><p className="text-[9px] text-slate-500 uppercase mb-0.5">Win</p><p className="text-xs font-bold text-neon-cyan">{strategy.winRate}</p></div>
                    <div className="text-center py-2 rounded-lg bg-white/[0.03]"><p className="text-[9px] text-slate-500 uppercase mb-0.5">Engine</p><p className="text-xs font-bold text-slate-300 capitalize">{strategy.engine}</p></div>
                  </div>
                  <div className="flex flex-wrap gap-1.5 mb-4">
                    <span className="px-2 py-1 rounded-md bg-white/[0.04] text-[10px] text-slate-400">Indicator: {strategy.indicator}</span>
                    <span className="px-2 py-1 rounded-md bg-white/[0.04] text-[10px] text-slate-400">Risk: {strategy.riskLevel}</span>
                  </div>
                  {unlocked && (
                    <button onClick={() => handleSelectStrategy(strategy)} className="w-full flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl font-semibold text-sm transition-all duration-300 btn-neon-cyan hover:scale-[1.02]">
                      <SlidersHorizontal className="w-4 h-4" /> Customize Strategy
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Instant Trade Toggle */}
      <div className="rounded-2xl border p-3 flex items-center gap-3 transition-all duration-300 bg-neon-green/5 border-neon-green/20">
        <div className="w-8 h-8 rounded-lg border flex items-center justify-center flex-shrink-0 bg-neon-green/10 border-neon-green/30">
          <Zap className="w-4 h-4 text-neon-green" />
        </div>
        <div className="flex-1">
          <p className="text-xs font-bold text-neon-green">Instant First Trade Execution</p>
          <p className="text-[10px] text-slate-500">Fires the first market order immediately via execute-trade — no waiting for the 1-minute cron cycle.</p>
        </div>
        <button
          onClick={() => setInstantTrade(!instantTrade)}
          className={`relative w-12 h-6 rounded-full transition-all duration-200 ${instantTrade ? 'bg-neon-green/30' : 'bg-white/[0.08]'}`}
        >
          <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full transition-all duration-200 ${instantTrade ? 'translate-x-6 bg-neon-green' : 'bg-slate-500'}`} />
        </button>
      </div>

      {/* Assigned Custom Bots (Read-Only) */}
      {assignedCustomBots.length > 0 && (
        <Section icon={CircuitBoard} title="Admin-Assigned Custom Bots" badge="READ-ONLY">
          <p className="text-[11px] text-slate-500 mb-3">These custom bots were built by your admin. You can launch them but cannot modify their risk parameters.</p>
          <div className="space-y-2">
            {assignedCustomBots.map(bot => (
              <div key={bot.id} className="flex items-center justify-between p-3 rounded-xl bg-white/[0.03] border border-white/[0.06]">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-neon-cyan/10 flex items-center justify-center">
                    <Lock className="w-4 h-4 text-neon-cyan" />
                  </div>
                  <div>
                    <p className="text-sm font-bold text-white">{bot.name}</p>
                    <p className="text-[10px] text-slate-500">
                      {bot.strategy_settings?.exchange ?? 'CoinDCX'} · {(bot.strategy_settings?.trading_pairs ?? []).join(', ')} · TP {bot.default_tp_pct}% / SL {bot.default_sl_pct}% · Max {bot.risk_settings?.max_trades_per_day ?? 10} trades/day
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`px-2 py-0.5 rounded-md text-[9px] font-bold ${bot.risk_level === 'High' ? 'bg-neon-red/15 text-neon-red' : bot.risk_level === 'Medium' ? 'bg-neon-amber/15 text-neon-amber' : 'bg-neon-green/15 text-neon-green'}`}>
                    {bot.risk_level} Risk
                  </span>
                  <button
                    onClick={() => {
                      setBotType('scalper');
                      setSelectedCoin((bot.strategy_settings?.trading_pairs ?? ['BTCUSDT'])[0].replace('USDT', ''));
                      if (bot.default_tp_pct) setTakeProfit(bot.default_tp_pct);
                      if (bot.default_sl_pct) setStopLoss(bot.default_sl_pct);
                      if (bot.max_leverage) setLeverage(bot.max_leverage);
                      if (bot.risk_settings?.max_trades_per_day) setMaxTradesPerDay(bot.risk_settings.max_trades_per_day);
                      if (bot.risk_settings?.max_daily_loss_threshold) setMaxDailyLoss(bot.risk_settings.max_daily_loss_threshold);
                      if (bot.strategy_settings?.trailing_enabled !== undefined) setTrailingEnabled(bot.strategy_settings.trailing_enabled);
                      if (bot.strategy_settings?.trailing_distance_pct) setTrailingDistance(bot.strategy_settings.trailing_distance_pct);
                      setShowConfigForm(true);
                      setTimeout(() => configFormRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100);
                    }}
                    className="px-3 py-1.5 rounded-lg bg-neon-cyan/10 text-neon-cyan text-xs font-semibold border border-neon-cyan/30 hover:neon-glow-cyan transition-all"
                  >
                    Load Config
                  </button>
                </div>
              </div>
            ))}
          </div>
        </Section>
      )}

      {showConfigForm && (
        <div ref={configFormRef} className="animate-slide-up space-y-4">
          {selectedStrategyId && (
            <div className="flex items-center justify-between glass-card p-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-neon-cyan/10 border border-neon-cyan/30 flex items-center justify-center">
                  <SlidersHorizontal className="w-5 h-5 text-neon-cyan" />
                </div>
                <div>
                  <p className="text-sm font-bold text-white">Customizing: {mergedStrategies.find(s => s.id === selectedStrategyId)?.name}</p>
                  <p className="text-[10px] text-slate-500">Adjust the parameters below, then launch your bot.</p>
                </div>
              </div>
              <button onClick={() => setShowConfigForm(false)} className="px-3 py-1.5 rounded-lg bg-white/[0.04] text-slate-400 text-xs font-semibold border border-white/[0.08] hover:text-white hover:border-white/[0.16] transition-all">Collapse</button>
            </div>
          )}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Form - 2 cols */}
        <div className="lg:col-span-2 space-y-4">

          {/* Martingale Recovery Config */}
          {botType === 'martingale' && (
            <Section icon={RefreshCw} title="Martingale Recovery Config" badge="MG">
              <div className="p-4 rounded-xl bg-neon-amber/5 border border-neon-amber/15">
                <p className="text-[11px] text-slate-400 mb-4">
                  After a losing trade, the bot multiplies its position size to recover losses. Configure your parameters below — they cannot exceed the admin-defined limits.
                </p>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs text-slate-400 font-semibold">Recovery Multiplier</span>
                      <span className="text-sm font-mono font-bold text-neon-amber">{martingaleMultiplier.toFixed(1)}x</span>
                    </div>
                    <input
                      type="range"
                      min="1"
                      max={martingaleTemplate?.multiplier ?? 5}
                      step="0.5"
                      value={martingaleMultiplier}
                      onChange={e => setMartingaleMultiplier(Math.min(Number(e.target.value), martingaleTemplate?.multiplier ?? 5))}
                      className="w-full h-2 rounded-full appearance-none bg-white/[0.06] cursor-pointer"
                      style={{ accentColor: '#ffb020' }}
                    />
                    <div className="flex justify-between text-[10px] text-slate-600 mt-1">
                      <span>1.0x</span>
                      <span className="text-neon-amber">Max: {martingaleTemplate?.multiplier?.toFixed(1) ?? '5.0'}x</span>
                    </div>
                  </div>
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs text-slate-400 font-semibold">Max Recovery Steps</span>
                      <span className="text-sm font-mono font-bold text-neon-amber">{martingaleSteps}</span>
                    </div>
                    <input
                      type="range"
                      min="1"
                      max={martingaleTemplate?.steps ?? 7}
                      step="1"
                      value={martingaleSteps}
                      onChange={e => setMartingaleSteps(Math.min(Number(e.target.value), martingaleTemplate?.steps ?? 7))}
                      className="w-full h-2 rounded-full appearance-none bg-white/[0.06] cursor-pointer"
                      style={{ accentColor: '#ffb020' }}
                    />
                    <div className="flex justify-between text-[10px] text-slate-600 mt-1">
                      <span>1</span>
                      <span className="text-neon-amber">Max: {martingaleTemplate?.steps ?? 7}</span>
                    </div>
                  </div>
                </div>
                <div className="mt-3 p-3 rounded-lg bg-neon-red/5 border border-neon-red/15">
                  <p className="text-[10px] text-neon-red/80 flex items-center gap-1.5">
                    <AlertOctagon className="w-3 h-3" />
                    At {martingaleMultiplier.toFixed(1)}x over {martingaleSteps} steps, max position size reaches {Math.pow(martingaleMultiplier, martingaleSteps).toFixed(1)}x the base size. The bot will auto-halt if the step limit or max drawdown is reached.
                  </p>
                </div>
              </div>
            </Section>
          )}

          {/* 2. Trade Direction & Market */}
          <Section icon={Layers} title="Trade Direction & Market" badge="02">
            {/* Trade Direction Toggle */}
            <div className="mb-5">
              <label className="text-xs text-slate-400 mb-2 block font-semibold">Trade Direction</label>
              <div className="flex gap-2 p-1 rounded-xl bg-base-800/50">
                <button
                  onClick={() => setTradeDirection('long')}
                  className={`flex-1 flex items-center justify-center gap-2 px-3 py-3 rounded-lg text-xs sm:text-sm font-bold transition-all ${
                    tradeDirection === 'long'
                      ? 'bg-neon-green/15 text-neon-green border border-neon-green/30 shadow-[0_0_12px_rgba(0,255,157,0.2)]'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <ArrowUpRight className="w-4 h-4" /> Long
                </button>
                <button
                  onClick={() => setTradeDirection('short')}
                  className={`flex-1 flex items-center justify-center gap-2 px-3 py-3 rounded-lg text-xs sm:text-sm font-bold transition-all ${
                    tradeDirection === 'short'
                      ? 'bg-neon-red/15 text-neon-red border border-neon-red/30 shadow-[0_0_12px_rgba(255,68,68,0.2)]'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <ArrowDownRight className="w-4 h-4" /> Short
                </button>
                <button
                  onClick={() => setTradeDirection('auto')}
                  className={`flex-1 flex items-center justify-center gap-2 px-3 py-3 rounded-lg text-xs sm:text-sm font-bold transition-all ${
                    tradeDirection === 'auto'
                      ? 'bg-neon-cyan/15 text-neon-cyan border border-neon-cyan/30 shadow-[0_0_12px_rgba(0,229,255,0.2)]'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <Sparkles className="w-4 h-4" /> Auto (AI)
                </button>
              </div>
            </div>

            {/* Leverage Slider — Futures-only engine */}
            <div className="mb-4 animate-slide-up">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs text-slate-400 font-semibold">Futures Leverage</span>
                <span className="text-sm font-bold text-neon-amber font-mono">{leverage}x</span>
              </div>
              <input
                type="range" min="1" max={planRule.maxLeverage} value={Math.min(leverage, planRule.maxLeverage)}
                onChange={(e) => setLeverage(Number(e.target.value))}
                className="w-full h-2 rounded-full appearance-none cursor-pointer slider-neon"
                style={{ background: `linear-gradient(to right, #00ff9d 0%, #00e5ff ${leverage}%, #1a1f33 ${leverage}%)` }}
              />
              <div className="flex justify-between mt-1.5 text-[9px] text-slate-600">
                <span>1x</span><span>25x</span><span>50x</span><span>75x</span>
                <span className="text-neon-amber font-bold">{planRule.maxLeverage}x MAX</span>
              </div>
              {gateMessage && (
                <p className="mt-2 text-[11px] text-neon-amber flex items-center gap-1">
                  <Lock className="w-3 h-3" /> {gateMessage}
                </p>
              )}
              {leverage >= 50 && (
                <p className="mt-2 text-[11px] text-neon-red/80 flex items-center gap-1">
                  <Shield className="w-3 h-3" />
                  High leverage significantly increases liquidation risk.
                </p>
              )}
            </div>

            {/* Coin Selector */}
            <div>
              <label className="text-xs text-slate-400 mb-2 block font-semibold">Select Cryptocurrency</label>
              <div className="relative mb-2">
                <input
                  type="text"
                  value={coinSearch}
                  onChange={(e) => setCoinSearch(e.target.value)}
                  placeholder="Search coins..."
                  className="w-full px-3 py-2 rounded-lg glass text-sm text-white placeholder-slate-500 focus:outline-none focus:border-neon-cyan/40 transition-colors"
                />
              </div>
              <div className="grid grid-cols-3 sm:grid-cols-5 gap-2 max-h-[180px] overflow-y-auto scrollbar-thin pb-1">
                {filteredCoins.map((c) => (
                  <button
                    key={c.symbol}
                    onClick={() => { setSelectedCoin(c.symbol); setCoinSearch(''); }}
                    className={`px-3 py-2.5 rounded-xl text-sm font-semibold transition-all duration-200 ${
                      selectedCoin === c.symbol
                        ? 'bg-neon-green/15 text-neon-green border border-neon-green/40'
                        : 'glass text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {c.symbol}
                  </button>
                ))}
                {filteredCoins.length === 0 && (
                  <div className="col-span-full text-center text-xs text-slate-500 py-4">No coins found</div>
                )}
              </div>
              <div className="mt-3 flex items-center justify-between text-xs">
                <span className="text-slate-400">{selectedCoinData.name}</span>
                <span className="font-mono text-slate-200">{formatInr(selectedCoinData.price)}</span>
              </div>
            </div>
          </Section>

          {/* 3. Entry Logic */}
          <Section icon={Crosshair} title="Entry Logic" badge="03">
            {/* Order Type — Market-only execution */}
            <div className="mb-5">
              <label className="text-xs text-slate-400 mb-2 block font-semibold">Order Type</label>
              <div className="flex items-center gap-2 px-4 py-3 rounded-xl bg-neon-cyan/10 border border-neon-cyan/30">
                <Zap className="w-4 h-4 text-neon-cyan" />
                <span className="text-sm font-bold text-neon-cyan">Market Execution</span>
                <span className="ml-auto text-[10px] text-slate-500">Fills at best available price</span>
              </div>
            </div>

            {/* Technical Indicators Toggle */}
            <div className="p-4 rounded-xl bg-white/[0.02] border border-white/[0.05]">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <CircuitBoard className="w-4 h-4 text-neon-cyan" />
                  <div>
                    <p className="text-sm font-semibold text-white">Use Technical Indicators</p>
                    <p className="text-[10px] text-slate-500">Trigger entries based on TA signals</p>
                  </div>
                </div>
                <button
                  onClick={() => setIndicatorsEnabled(!indicatorsEnabled)}
                  className={`relative w-12 h-6 rounded-full transition-all duration-200 ${indicatorsEnabled ? 'bg-neon-cyan/30' : 'bg-white/[0.08]'}`}
                >
                  <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full transition-all duration-200 ${indicatorsEnabled ? 'translate-x-6 bg-neon-cyan neon-glow-cyan' : 'bg-slate-500'}`} />
                </button>
              </div>

              {indicatorsEnabled ? (
                <div className="animate-slide-up">
                  <label className="text-xs text-slate-400 mb-2 block font-semibold">Select Indicator Trigger</label>
                  <div className="flex flex-wrap gap-2">
                    {indicatorOptions.map((ind) => (
                      <button
                        key={ind}
                        onClick={() => setIndicator(ind)}
                        className={`px-3.5 py-2 rounded-lg text-xs font-semibold transition-all duration-200 ${
                          indicator === ind
                            ? 'bg-neon-cyan/15 text-neon-cyan border border-neon-cyan/40 shadow-[0_0_12px_rgba(0,229,255,0.2)]'
                            : 'bg-white/[0.03] text-slate-400 border border-white/[0.06] hover:border-white/[0.14] hover:text-slate-200'
                        }`}
                      >
                        <span className="flex items-center gap-1.5">
                          <div className={`w-2 h-2 rounded-full transition-all ${indicator === ind ? 'bg-neon-cyan shadow-[0_0_6px_rgba(0,229,255,0.8)]' : 'bg-slate-600'}`} />
                          {ind}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="animate-fade-in flex items-center gap-2 py-2">
                  <Power className="w-3.5 h-3.5 text-slate-600 flex-shrink-0" />
                  <p className="text-xs text-slate-500 italic">
                    Bot will execute based on selected strategy, pure price action, or manual triggers.
                  </p>
                </div>
              )}
            </div>
          </Section>

          {/* 4. Position & Execution */}
          <Section icon={Gauge} title="Position & Execution" badge="04">
            {/* Quantity Mode Toggle */}
            <div className="mb-4">
              <label className="text-xs text-slate-400 mb-2 block font-semibold">Trade Quantity</label>
              <div className="flex gap-2 p-1 rounded-xl bg-base-800/50 mb-3">
                <button
                  onClick={() => setQuantityMode('fixed')}
                  className={`flex-1 flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all ${
                    quantityMode === 'fixed' ? 'bg-neon-green/15 text-neon-green border border-neon-green/30' : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <Coins className="w-3.5 h-3.5" /> Fixed Amount (INR)
                </button>
                <button
                  onClick={() => setQuantityMode('quantity')}
                  className={`flex-1 flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all ${
                    quantityMode === 'quantity' ? 'bg-neon-cyan/15 text-neon-cyan border border-neon-cyan/30' : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <Activity className="w-3.5 h-3.5" /> Trade Quantity
                </button>
              </div>
              <div className="relative">
                <input
                  type="number"
                  value={quantityMode === 'fixed' ? quantityValue : tradeQuantity}
                  onChange={(e) => quantityMode === 'fixed' ? setQuantityValue(Math.min(100000, Math.max(100, Number(e.target.value)))) : setTradeQuantity(Math.max(0, Number(e.target.value)))}
                  className="w-full px-4 py-3 rounded-xl glass text-lg text-white font-mono focus:outline-none focus:border-neon-green/40 transition-colors"
                  step={quantityMode === 'fixed' ? '100' : '0.01'}
                  min={quantityMode === 'fixed' ? '100' : '0'}
                  max={quantityMode === 'fixed' ? '100000' : undefined}
                />
                <span className="absolute right-4 top-1/2 -translate-y-1/2 text-sm font-bold" style={{ color: quantityMode === 'fixed' ? '#00ff9d' : '#00e5ff' }}>
                  {quantityMode === 'fixed' ? '₹' : selectedCoin}
                </span>
              </div>
              <p className="text-[10px] text-slate-500 mt-1.5">
                {quantityMode === 'fixed'
                  ? `Each trade uses ₹${quantityValue.toLocaleString('en-IN')} (INR deposit sizing)`
                  : `Each trade uses ${tradeQuantity} ${selectedCoin} coins`}
              </p>
            </div>

            {/* Max Trades Per Day */}
            <div>
              <label className="text-xs text-slate-400 mb-2 block font-semibold flex items-center gap-1.5">
                <Activity className="w-3 h-3" /> Max Trades / Day
              </label>
              <input
                type="number"
                value={maxTradesPerDay}
                onChange={(e) => setMaxTradesPerDay(Math.max(0, Number(e.target.value)))}
                className="w-full px-4 py-2.5 rounded-xl glass text-sm text-white font-mono focus:outline-none focus:border-neon-cyan/40 transition-colors"
                min="0"
              />
            </div>
          </Section>

          {/* 5. Advanced Exit & SL/TP */}
          <Section icon={Shield} title="Advanced Exit & Stop Loss" badge="05">
            {/* AI Auto-Tune Button */}
            <div className="mb-4">
              <button
                onClick={handleAutoTune}
                className={`w-full flex items-center justify-center gap-2 px-5 py-3 rounded-xl font-bold text-sm transition-all duration-300 relative overflow-hidden group ${
                  aiAutoTuneEnabled
                    ? 'bg-gradient-to-r from-neon-cyan/20 via-neon-green/15 to-neon-cyan/20 text-white border border-neon-cyan/40 hover:from-neon-cyan/30 hover:to-neon-cyan/30 hover:scale-[1.01] neon-glow-cyan'
                    : 'bg-gradient-to-r from-slate-800/50 to-slate-800/50 text-slate-400 border border-white/[0.06] hover:border-neon-amber/30 cursor-pointer'
                }`}
              >
                {aiAutoTuneEnabled ? (
                  <Sparkles className="w-4 h-4 text-neon-cyan" />
                ) : (
                  <Lock className="w-4 h-4 text-neon-amber" />
                )}
                {aiAutoTuneEnabled ? 'AI Auto-Tune (Optimal SL/TP)' : 'AI Auto-Tune — Pro Feature'}
                {aiAutoTuneEnabled && (
                  <span className="text-[10px] font-normal text-neon-green/70 ml-1">1:3 R:R</span>
                )}
              </button>
              {!aiAutoTuneEnabled && (
                <p className="text-[10px] text-slate-500 mt-1.5 text-center">
                  Upgrade to Pro to auto-optimize Stop Loss, Take Profit & Trailing with AI-driven risk ratios.
                </p>
              )}
            </div>
            {/* TP/SL Mode Toggle */}
            <div className="mb-4">
              <label className="text-xs text-slate-400 mb-2 block font-semibold">TP / SL Definition Mode</label>
              <div className="flex gap-2 p-1 rounded-xl bg-base-800/50">
                <button
                  onClick={() => setTpSlMode('percentage')}
                  className={`flex-1 px-4 py-2 rounded-lg text-sm font-semibold transition-all ${
                    tpSlMode === 'percentage' ? 'bg-neon-cyan/15 text-neon-cyan border border-neon-cyan/30' : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  Percentage (%)
                </button>
                <button
                  onClick={() => setTpSlMode('fixed')}
                  className={`flex-1 px-4 py-2 rounded-lg text-sm font-semibold transition-all ${
                    tpSlMode === 'fixed' ? 'bg-neon-amber/15 text-neon-amber border border-neon-amber/30' : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  Fixed PnL Amount
                </button>
              </div>
            </div>

            {/* TP & SL Inputs */}
            <div className="grid grid-cols-2 gap-4 mb-4">
              <div>
                <label className="text-xs text-slate-400 mb-2 block font-semibold flex items-center gap-1.5">
                  <TrendingUp className="w-3 h-3 text-neon-green" /> Take Profit
                </label>
                <div className="relative">
                  <input
                    type="number"
                    value={tpSlMode === 'percentage' ? takeProfit : tpFixed}
                    onChange={(e) => tpSlMode === 'percentage' ? setTakeProfit(Math.max(0, Number(e.target.value))) : setTpFixed(Math.max(0, Number(e.target.value)))}
                    className="w-full px-4 py-2.5 rounded-xl glass text-sm text-white font-mono focus:outline-none focus:border-neon-green/40 transition-colors"
                    step={tpSlMode === 'percentage' ? '0.5' : '10'}
                    min="0"
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-neon-green text-sm font-bold">
                    {tpSlMode === 'percentage' ? '%' : '₹'}
                  </span>
                </div>
                <p className="text-[10px] text-slate-500 mt-1">Auto-sell at profit target</p>
              </div>
              <div>
                <label className="text-xs text-slate-400 mb-2 block font-semibold flex items-center gap-1.5">
                  <TrendingDown className="w-3 h-3 text-neon-red" /> Stop Loss
                </label>
                <div className="relative">
                  <input
                    type="number"
                    value={tpSlMode === 'percentage' ? stopLoss : slFixed}
                    onChange={(e) => tpSlMode === 'percentage' ? setStopLoss(Math.max(0, Number(e.target.value))) : setSlFixed(Math.max(0, Number(e.target.value)))}
                    className="w-full px-4 py-2.5 rounded-xl glass text-sm text-white font-mono focus:outline-none focus:border-neon-red/40 transition-colors"
                    step={tpSlMode === 'percentage' ? '0.5' : '10'}
                    min="0"
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-neon-red text-sm font-bold">
                    {tpSlMode === 'percentage' ? '%' : '₹'}
                  </span>
                </div>
                <p className="text-[10px] text-slate-500 mt-1">Auto-sell at loss limit</p>
              </div>
            </div>

            {/* Trailing Stop Loss */}
            <div className="p-4 rounded-xl bg-white/[0.02] border border-white/[0.05]">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <TrendingUp className="w-4 h-4 text-neon-cyan" />
                  <div>
                    <p className="text-sm font-semibold text-white">Trailing Stop Loss</p>
                    <p className="text-[10px] text-slate-500">Dynamically follows price upward</p>
                  </div>
                </div>
                <button
                  onClick={() => setTrailingEnabled(!trailingEnabled)}
                  className={`relative w-12 h-6 rounded-full transition-all duration-200 ${trailingEnabled ? 'bg-neon-cyan/30' : 'bg-white/[0.08]'}`}
                >
                  <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full transition-all duration-200 ${trailingEnabled ? 'translate-x-6 bg-neon-cyan neon-glow-cyan' : 'bg-slate-500'}`} />
                </button>
              </div>
              {trailingEnabled && (
                <div className="animate-slide-up">
                  <label className="text-xs text-slate-400 mb-1.5 block font-semibold">Trailing Distance (%)</label>
                  <div className="relative">
                    <input
                      type="number"
                      value={trailingDistance}
                      onChange={(e) => setTrailingDistance(Math.max(0, Number(e.target.value)))}
                      className="w-full px-4 py-2.5 rounded-xl glass text-sm text-white font-mono focus:outline-none focus:border-neon-cyan/40 transition-colors"
                      step="0.1"
                      min="0"
                    />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-neon-cyan text-sm font-bold">%</span>
                  </div>
                  <p className="text-[10px] text-slate-500 mt-1.5">Stop loss trails price by {trailingDistance}% — locks in profit while limiting downside.</p>
                </div>
              )}
            </div>
          </Section>

          {/* 6. Daily Safety Limits */}
          <Section icon={Shield} title="Daily Safety Limits" badge="06">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
              <div>
                <label className="text-xs text-slate-400 mb-2 block font-semibold flex items-center gap-1.5">
                  <Flame className="w-3 h-3 text-neon-red" /> Max Daily Loss
                </label>
                <div className="relative">
                  <input
                    type="number"
                    value={maxDailyLoss}
                    onChange={(e) => setMaxDailyLoss(Math.max(0, Number(e.target.value)))}
                    className="w-full px-4 py-2.5 rounded-xl glass text-sm text-white font-mono focus:outline-none focus:border-neon-red/40 transition-colors"
                    step="50"
                    min="0"
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-neon-red text-sm font-bold">₹</span>
                </div>
                <p className="text-[10px] text-slate-500 mt-1">Bot auto-pauses if daily loss hits this</p>
              </div>
              <div>
                <label className="text-xs text-slate-400 mb-2 block font-semibold flex items-center gap-1.5">
                  <Target className="w-3 h-3 text-neon-green" /> Max Daily Profit
                </label>
                <div className="relative">
                  <input
                    type="number"
                    value={maxDailyProfit}
                    onChange={(e) => setMaxDailyProfit(Math.max(0, Number(e.target.value)))}
                    className="w-full px-4 py-2.5 rounded-xl glass text-sm text-white font-mono focus:outline-none focus:border-neon-green/40 transition-colors"
                    step="50"
                    min="0"
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-neon-green text-sm font-bold">₹</span>
                </div>
                <p className="text-[10px] text-slate-500 mt-1">Bot auto-pauses if daily profit hits this</p>
              </div>
            </div>

            {/* Cooldown Timer */}
            <div>
              <label className="text-xs text-slate-400 mb-2 block font-semibold flex items-center gap-1.5">
                <Clock className="w-3 h-3 text-neon-amber" /> Cooldown Timer (after trade)
              </label>
              <div className="relative max-w-[200px]">
                <input
                  type="number"
                  value={cooldownMinutes}
                  onChange={(e) => setCooldownMinutes(Math.max(0, Number(e.target.value)))}
                  className="w-full px-4 py-2.5 rounded-xl glass text-sm text-white font-mono focus:outline-none focus:border-neon-amber/40 transition-colors"
                  min="0"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-neon-amber text-sm font-bold">min</span>
              </div>
              <p className="text-[10px] text-slate-500 mt-1.5">Bot pauses for {cooldownMinutes} minute{cooldownMinutes !== 1 ? 's' : ''} after any trade closes before resuming.</p>
            </div>
          </Section>
        </div>

        {/* Summary Panel - 1 col */}
        <div className="lg:col-span-1">
          <div className="glass-card p-5 sticky top-20">
            <h3 className="text-sm font-bold text-white mb-4 flex items-center gap-2">
              <Rocket className="w-4 h-4 text-neon-green" />
              Bot Summary
            </h3>

            <div className="space-y-3 text-sm">
              <SummaryGroup label="Bot Type" />
              <SummaryRow label="Strategy" value={botType.charAt(0).toUpperCase() + botType.slice(1)} accent="cyan" />

              <SummaryGroup label="Direction & Market" />
              <SummaryRow label="Direction" value={tradeDirection === 'auto' ? 'Auto (AI Sensing)' : tradeDirection === 'long' ? 'Long (Buy)' : 'Short (Sell)'} accent={tradeDirection === 'auto' ? 'cyan' : tradeDirection === 'long' ? 'green' : 'red'} />
              <SummaryRow label="Market" value="FUTURES" accent="amber" />
              <SummaryRow label="Leverage" value={`${leverage}x`} accent="amber" />
              <SummaryRow label="Coin" value={selectedCoin} />

              <SummaryGroup label="Entry Logic" />
              <SummaryRow label="Order Type" value="Market" accent="cyan" />
              <SummaryRow label="Indicators" value={indicatorsEnabled ? indicator : 'Price Action'} accent={indicatorsEnabled ? 'cyan' : undefined} />

              <SummaryGroup label="Position & Execution" />
              <SummaryRow label="Quantity" value={quantityMode === 'fixed' ? `₹${quantityValue.toLocaleString('en-IN')}` : `${tradeQuantity} ${selectedCoin}`} />
              <SummaryRow label="Max Trades/Day" value={`${maxTradesPerDay}`} />

              <SummaryGroup label="Exit & SL/TP" />
              <SummaryRow label="Take Profit" value={tpDisplay} accent="green" />
              <SummaryRow label="Stop Loss" value={slDisplay} accent="red" />
              {previewTargetPrice !== null && (
                <SummaryRow label="Target Price" value={`${fmtPreviewPrice(previewTargetPrice)}`} accent="green" />
              )}
              {previewSlPrice !== null && (
                <SummaryRow label="SL Price" value={`${fmtPreviewPrice(previewSlPrice)}`} accent="red" />
              )}
              <SummaryRow label="Trailing SL" value={trailingEnabled ? `ON · ${trailingDistance}%` : 'OFF'} accent={trailingEnabled ? 'cyan' : undefined} />

              <SummaryGroup label="Daily Safety" />
              <SummaryRow label="Max Daily Loss" value={formatInr(maxDailyLoss)} accent="red" />
              <SummaryRow label="Max Daily Profit" value={formatInr(maxDailyProfit)} accent="green" />
              <SummaryRow label="Cooldown" value={`${cooldownMinutes}m`} accent="amber" />

              <div className="h-px bg-white/[0.06] my-3" />
              <SummaryRow label="Trade Capital" value={formatInr(effectiveCapital)} />
              <SummaryRow label="Position Size" value={formatInr(positionSize)} accent="cyan" bold />
              <SummaryRow label="Coin Amount" value={quantityMode === 'quantity' ? `${tradeQuantity} ${selectedCoin}` : `${coinAmount.toFixed(6)} ${selectedCoin}`} />
            </div>

            {/* Backtest + Launch buttons */}
            <button
              onClick={() => setShowBacktest(true)}
              disabled={effectiveCapital <= 0}
              className={`mt-5 w-full flex items-center justify-center gap-2 px-5 py-3 rounded-xl font-bold text-sm transition-all duration-300 ${
                effectiveCapital <= 0
                  ? 'bg-white/[0.03] text-slate-500 border border-white/[0.06] cursor-not-allowed'
                  : 'bg-neon-amber/15 text-neon-amber border border-neon-amber/40 hover:bg-neon-amber/25 neon-glow-amber hover:scale-[1.02]'
              }`}
            >
              <Activity className="w-4 h-4" /> Test Strategy (AI Backtest)
            </button>

            <button
              onClick={handleLaunch}
              disabled={effectiveCapital <= 0 || launching || killSwitch || !isBotTypeAllowed(botType) || activeBotCount >= (planRule.botLimit ?? Number.MAX_SAFE_INTEGER) || !licenseActive || !hasConnectedBroker || effectiveCapital > exchangeBalance}
              className={`mt-3 w-full flex items-center justify-center gap-2 px-5 py-3 rounded-xl font-bold text-sm transition-all duration-300 ${
                launched
                  ? 'bg-neon-green/20 text-neon-green border border-neon-green/50 neon-glow-green'
                  : effectiveCapital <= 0 || launching || killSwitch || activeBotCount >= (planRule.botLimit ?? Number.MAX_SAFE_INTEGER) || !licenseActive || !hasConnectedBroker || effectiveCapital > exchangeBalance
                  ? 'bg-white/[0.03] text-slate-500 border border-white/[0.06] cursor-not-allowed'
                  : 'bg-gradient-to-r from-neon-cyan/20 to-neon-green/20 text-white border border-neon-cyan/40 hover:from-neon-cyan/30 hover:to-neon-green/30 neon-glow-cyan hover:scale-[1.02]'
              }`}
            >
              {launching ? (
                <><Loader2 className="w-4 h-4 animate-spin" /> Launching...</>
              ) : launched ? (
                <><Check className="w-4 h-4" /> Bot Launched!</>
              ) : killSwitch ? (
                <><AlertOctagon className="w-4 h-4" /> Deploy Disabled (Kill Switch)</>
              ) : !licenseActive ? (
                <><Lock className="w-4 h-4" /> Subscription Expired</>
              ) : !hasConnectedBroker ? (
                <><Lock className="w-4 h-4" /> No Broker Connected</>
              ) : effectiveCapital > exchangeBalance ? (
                <><Lock className="w-4 h-4" /> Insufficient Funds</>
              ) : activeBotCount >= (planRule.botLimit ?? Number.MAX_SAFE_INTEGER) ? (
                <><Lock className="w-4 h-4" /> Plan Limit Reached</>
              ) : (
                <><Rocket className="w-4 h-4" /> Launch Custom Cortex Bot</>
              )}
            </button>

            <div className="mt-2 space-y-1">
              <p className="text-center text-[10px] text-slate-500">{planRule.label} plan: {activeBotCount}/{planRule.botLimit ?? 'unlimited'} active bots</p>
              {hasConnectedBroker && (
                <p className="text-center text-[10px] text-slate-500">Exchange balance: {formatInr(exchangeBalance)} · Capital: {formatInr(effectiveCapital)}</p>
              )}
            </div>

            {launched && (
              <p className="mt-3 text-center text-[11px] text-neon-green animate-fade-in">
                Your bot is now live and scanning the market...
              </p>
            )}
          </div>
        </div>
          </div>
        </div>
      )}

      {showBacktest && (
        <BacktestModal
          draft={{
            name: `Custom Cortex Bot — ${selectedCoin} ${botType.charAt(0).toUpperCase() + botType.slice(1)}`,
            description: '',
            bot_type: 'custom',
            execution_mode: 'auto',
            market_type: 'futures',
            required_tier: 'enterprise',
            strategies: [],
            indicators: indicatorsEnabled ? [indicator] : [],
            max_drawdown_pct: (maxDailyLoss / effectiveCapital) * 100,
            default_tp_pct: tpSlMode === 'percentage' ? takeProfit : 5,
            default_sl_pct: tpSlMode === 'percentage' ? stopLoss : 2,
            tp_sl_ratio: 0,
            max_leverage: leverage,
            risk_level: leverage > 30 ? 'High' : leverage > 10 ? 'Medium' : 'Low',
            source_exchanges: [],
            win_rate: 0,
            expected_return: '',
            martingale_multiplier: botType === 'martingale' ? martingaleMultiplier : 0,
            max_martingale_steps: botType === 'martingale' ? martingaleSteps : 0,
            strategy_settings: {
              strategy_mode: 'rule_based',
              trade_sizing: quantityMode === 'fixed' ? 'fixed_quote' : 'fixed_quantity',
              sizing_value: quantityMode === 'fixed' ? quantityValue : tradeQuantity,
              risk_per_trade_pct: 1,
              max_notional: 10000,
              trailing_enabled: trailingEnabled,
              trailing_distance_pct: trailingDistance,
              exchange: 'CoinDCX',
              trading_pairs: [`${selectedCoin}USDT`],
            },
            risk_settings: {
              max_trades_per_day: maxTradesPerDay,
              max_daily_loss_threshold: maxDailyLoss,
            },
            backtest_config: {
              strategy: botType,
              trade_direction: tradeDirection,
              capital: effectiveCapital,
              tp_sl_mode: tpSlMode,
              take_profit: takeProfit,
              stop_loss: stopLoss,
              tp_fixed: tpFixed,
              sl_fixed: slFixed,
              leverage: leverage,
              max_trades_per_day: maxTradesPerDay,
              cooldown_minutes: cooldownMinutes,
              martingale_multiplier: botType === 'martingale' ? martingaleMultiplier : 0,
              martingale_steps: botType === 'martingale' ? martingaleSteps : 0,
              trailing_enabled: trailingEnabled,
              trailing_distance: trailingDistance,
            },
          } as BotFactoryDraft}
          onClose={() => setShowBacktest(false)}
        />
      )}

      {/* Launch Toast */}
      {launchToast && (
        <div className="fixed bottom-6 right-6 z-[200] animate-slide-up">
          <div className={`glass-strong px-5 py-3 rounded-xl flex items-center gap-2.5 ${launchToast.type === 'success' ? 'neon-glow-green' : 'neon-glow-red'}`}>
            {launchToast.type === 'success'
              ? <Check className="w-5 h-5 text-neon-green" />
              : <AlertOctagon className="w-5 h-5 text-neon-red" />}
            <span className={`text-sm font-semibold ${launchToast.type === 'success' ? 'text-white' : 'text-neon-red'}`}>{launchToast.text}</span>
          </div>
        </div>
      )}

      {/* Auto-Tune Toast */}
      {autoTuneToast && (
        <div className="fixed bottom-6 right-6 z-[200] animate-slide-up">
          <div className={`glass-strong px-5 py-4 rounded-xl flex items-center gap-3 ${autoTuneToast.type === 'success' ? 'neon-glow-cyan border border-neon-cyan/30' : 'neon-glow-amber border border-neon-amber/30'}`}>
            {autoTuneToast.type === 'success'
              ? <Sparkles className="w-5 h-5 text-neon-cyan flex-shrink-0" />
              : <Lock className="w-5 h-5 text-neon-amber flex-shrink-0" />}
            <div>
              <p className={`text-sm font-bold ${autoTuneToast.type === 'success' ? 'text-white' : 'text-neon-amber'}`}>
                {autoTuneToast.type === 'success' ? 'AI Auto-Tune Applied' : 'Premium Feature Locked'}
              </p>
              <p className="text-xs text-slate-400 mt-0.5">{autoTuneToast.text}</p>
              {autoTuneToast.type === 'locked' && (
                <button
                  onClick={() => { const event = new CustomEvent('navigate', { detail: 'my-subscription' }); window.dispatchEvent(event); }}
                  className="mt-2 flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-neon-amber/15 text-neon-amber border border-neon-amber/30 hover:bg-neon-amber/25 text-xs font-bold transition-all"
                >
                  <Sparkles className="w-3.5 h-3.5" /> Upgrade Now
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Strategy Selector Toast */}
      {strategyToast && (
        <div className="fixed bottom-6 right-6 z-[200] animate-slide-up">
          <div className={`glass-strong px-5 py-4 rounded-xl flex items-center gap-3 ${strategyToast.type === 'success' ? 'neon-glow-green border border-neon-green/30' : 'neon-glow-amber border border-neon-amber/30'}`}>
            {strategyToast.type === 'success'
              ? <Trophy className="w-5 h-5 text-neon-green flex-shrink-0" />
              : <Lock className="w-5 h-5 text-neon-amber flex-shrink-0" />}
            <div>
              <p className={`text-sm font-bold ${strategyToast.type === 'success' ? 'text-white' : 'text-neon-amber'}`}>
                {strategyToast.type === 'success' ? 'Strategy Loaded' : 'Strategy Locked'}
              </p>
              <p className="text-xs text-slate-400 mt-0.5">{strategyToast.text}</p>
              {strategyToast.type === 'locked' && (
                <button
                  onClick={() => { const event = new CustomEvent('navigate', { detail: 'my-subscription' }); window.dispatchEvent(event); }}
                  className="mt-2 flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-neon-amber/15 text-neon-amber border border-neon-amber/30 hover:bg-neon-amber/25 text-xs font-bold transition-all"
                >
                  <Sparkles className="w-3.5 h-3.5" /> Upgrade Now
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Section({ icon: Icon, title, children, badge }: { icon: typeof Layers; title: string; children: React.ReactNode; badge?: string }) {
  return (
    <div className="glass-card p-5 relative">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-bold text-white flex items-center gap-2">
          <Icon className="w-4 h-4 text-neon-cyan" />
          {title}
        </h3>
        {badge && (
          <span className="px-2 py-0.5 rounded-md bg-neon-cyan/10 text-neon-cyan text-[9px] font-bold border border-neon-cyan/20">
            {badge}
          </span>
        )}
      </div>
      {children}
    </div>
  );
}

function SummaryGroup({ label }: { label: string }) {
  return (
    <div className="pt-2">
      <p className="text-[9px] font-bold uppercase tracking-wider text-slate-600">{label}</p>
    </div>
  );
}

function SummaryRow({ label, value, accent, bold }: { label: string; value: string; accent?: string; bold?: boolean }) {
  const color = accent === 'green' ? 'text-neon-green' : accent === 'red' ? 'text-neon-red' : accent === 'amber' ? 'text-neon-amber' : accent === 'cyan' ? 'text-neon-cyan' : 'text-slate-200';
  return (
    <div className="flex items-center justify-between">
      <span className="text-slate-400 text-xs">{label}</span>
      <span className={`${color} ${bold ? 'font-bold' : 'font-medium'} font-mono text-xs`}>{value}</span>
    </div>
  );
}