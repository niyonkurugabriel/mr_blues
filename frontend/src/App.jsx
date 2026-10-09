import { useEffect, useMemo, useState } from 'react';

const sections = [
  { id: 'overview', label: 'Overview' },
  { id: 'account', label: 'Deposits & withdrawals' },
  { id: 'calculator', label: 'Trade calculator' },
  { id: 'plan', label: 'Trading plan' },
  { id: 'journal', label: 'Trade journal' },
  { id: 'analytics', label: 'Analytics' }
];

const defaultPlan = {
  strategy_name: 'Break & Retest Scalper',
  markets: 'EUR/USD, GBP/USD, XAU/USD',
  max_risk_per_trade_pct: '1',
  max_daily_loss_pct: '2',
  max_consecutive_losses: '2',
  confluences: 'Higher timeframe trend alignment\nKey support/resistance level test\n5-minute confirmation candle',
  target_rr: '2:1'
};

const emptyTrade = {
  symbol: 'XAU/USD',
  direction: 'LONG',
  entry_price: '',
  stop_loss: '',
  take_profit: '',
  exit_price: '',
  position_size: '1',
  net_pnl: '',
  setup: '',
  session: 'London',
  emotion: 'Disciplined',
  followed_plan: false,
  checklist: [],
  market_image: '',
  key_notes: [{ text: '', checked: false }],
  note: ''
};

const safeNumber = (value) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
};

function calculateMetrics(trades) {
  const totalPnl = trades.reduce((sum, trade) => sum + trade.pnl, 0);
  const wins = trades.filter((trade) => trade.pnl > 0).length;
  const losses = trades.filter((trade) => trade.pnl < 0).length;
  const netR = trades.reduce((sum, trade) => sum + trade.rMultiple, 0);
  const grossProfit = trades.reduce((sum, trade) => sum + Math.max(trade.pnl, 0), 0);
  const grossLoss = trades.reduce((sum, trade) => sum + Math.abs(Math.min(trade.pnl, 0)), 0);
  const average = (items) => items.length
    ? items.reduce((sum, trade) => sum + Math.abs(trade.pnl), 0) / items.length
    : 0;
  let equity = 0;
  let peak = 0;
  let maxDrawdown = 0;
  trades.slice().reverse().forEach((trade) => {
    equity += trade.pnl;
    peak = Math.max(peak, equity);
    maxDrawdown = Math.max(maxDrawdown, peak - equity);
  });

  return {
    totalPnl,
    wins,
    losses,
    winRate: trades.length ? (wins / trades.length) * 100 : 0,
    profitFactor: grossLoss ? grossProfit / grossLoss : 0,
    expectancy: trades.length ? totalPnl / trades.length : 0,
    avgWin: average(trades.filter((trade) => trade.pnl > 0)),
    avgLoss: average(trades.filter((trade) => trade.pnl < 0)),
    netR,
    maxDrawdown
  };
}

function formatCurrency(value) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 2
  }).format(value);
}

function calculatePosition({ balance, riskPercent, direction, entry, stop, target, contractSize, lotStep, quoteToAccountRate }) {
  const accountBalance = safeNumber(balance);
  const riskRate = safeNumber(riskPercent);
  const entryPrice = safeNumber(entry);
  const stopPrice = safeNumber(stop);
  const targetPrice = safeNumber(target);
  const unitsPerLot = safeNumber(contractSize);
  const minimumLotStep = safeNumber(lotStep);
  const conversionRate = safeNumber(quoteToAccountRate);
  const riskDistance = direction === 'LONG' ? entryPrice - stopPrice : stopPrice - entryPrice;
  const rewardDistance = direction === 'LONG' ? targetPrice - entryPrice : entryPrice - targetPrice;

  if (
    accountBalance <= 0 || riskRate <= 0 || riskRate > 100 ||
    entryPrice <= 0 || riskDistance <= 0 || rewardDistance <= 0 ||
    unitsPerLot <= 0 || minimumLotStep <= 0 || conversionRate <= 0
  ) {
    return null;
  }

  const riskBudget = accountBalance * (riskRate / 100);
  const cashRiskPerLot = riskDistance * unitsPerLot * conversionRate;
  const rawLots = riskBudget / cashRiskPerLot;
  const lotPrecision = Math.min((String(minimumLotStep).split('.')[1] || '').length, 8);
  const lots = Number((Math.floor(rawLots / minimumLotStep + 1e-10) * minimumLotStep).toFixed(lotPrecision));
  const positionUnits = lots * unitsPerLot;
  const rewardRisk = rewardDistance / riskDistance;

  return {
    riskBudget,
    lots,
    cashRisk: lots * cashRiskPerLot,
    cashRiskPerLot,
    positionUnits,
    rewardRisk,
    potentialProfit: lots * rewardDistance * unitsPerLot * conversionRate,
    minimumLotTooLarge: lots === 0
  };
}

function App() {
  const [activeSection, setActiveSection] = useState('overview');
  const [plan, setPlan] = useState(defaultPlan);
  const [trades, setTrades] = useState([]);
  const [account, setAccount] = useState({ balance: 0, transactions: [] });
  const [checklistChecks, setChecklistChecks] = useState([]);
  const [showJournalForm, setShowJournalForm] = useState(false);
  const [showAccountForm, setShowAccountForm] = useState(false);
  const [accountForm, setAccountForm] = useState({ type: 'deposit', amount: '', note: '' });
  const [journalForm, setJournalForm] = useState(emptyTrade);
  const [calculator, setCalculator] = useState({
    direction: 'LONG',
    riskPercent: '1',
    entry: '',
    stop: '',
    target: '',
    contractSize: '100000',
    lotStep: '0.01',
    quoteToAccountRate: '1'
  });
  const [loading, setLoading] = useState(true);
  const [savingPlan, setSavingPlan] = useState(false);
  const [savingTrade, setSavingTrade] = useState(false);
  const [savingTransaction, setSavingTransaction] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const checklistItems = useMemo(
    () => plan.confluences.split(/\r?\n/).map((item) => item.trim()).filter(Boolean),
    [plan.confluences]
  );
  const checkedCount = checklistChecks.filter(Boolean).length;
  const checklistComplete = checklistItems.length > 0 && checkedCount === checklistItems.length;
  const metrics = useMemo(() => calculateMetrics(trades), [trades]);
  const positionEstimate = useMemo(
    () => calculatePosition({ balance: account.balance, ...calculator }),
    [account.balance, calculator]
  );
  const tradeCalculations = useMemo(() => {
    const entry = safeNumber(journalForm.entry_price);
    const stop = safeNumber(journalForm.stop_loss);
    const target = safeNumber(journalForm.take_profit);
    const exit = safeNumber(journalForm.exit_price);
    const riskPerUnit = Math.abs(entry - stop);

    return {
      risk: riskPerUnit * safeNumber(journalForm.position_size),
      rr: riskPerUnit ? Math.abs(target - entry) / riskPerUnit : 0,
      rMultiple: riskPerUnit
        ? ((exit - entry) / (journalForm.direction === 'LONG' ? 1 : -1)) / riskPerUnit
        : 0
    };
  }, [journalForm]);
  const sessions = useMemo(() => {
    const results = new Map();
    trades.forEach((trade) => results.set(trade.session, (results.get(trade.session) || 0) + trade.pnl));
    return [...results.entries()];
  }, [trades]);

  useEffect(() => {
    let cancelled = false;
    Promise.all([fetch('/api/plans'), fetch('/api/trades'), fetch('/api/account')])
      .then(async ([planResponse, tradesResponse, accountResponse]) => {
        if (!planResponse.ok || !tradesResponse.ok || !accountResponse.ok) {
          throw new Error('Could not load your saved plan, journal, and account.');
        }
        const [{ plan: savedPlan }, { trades: savedTrades }, savedAccount] = await Promise.all([
          planResponse.json(),
          tradesResponse.json(),
          accountResponse.json()
        ]);
        if (cancelled) return;
        setPlan({
          ...savedPlan,
          markets: savedPlan.markets.join(', '),
          confluences: savedPlan.confluences.join('\n'),
          max_risk_per_trade_pct: String(savedPlan.max_risk_per_trade_pct),
          max_daily_loss_pct: String(savedPlan.max_daily_loss_pct),
          max_consecutive_losses: String(savedPlan.max_consecutive_losses)
        });
        setTrades(savedTrades);
        setAccount(savedAccount);
        setError('');
      })
      .catch((loadError) => {
        if (!cancelled) setError(`${loadError.message} Make sure the backend and database are running.`);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    setChecklistChecks(new Array(checklistItems.length).fill(false));
  }, [checklistItems]);

  const updatePlan = (key, value) => {
    setNotice('');
    setPlan((current) => ({ ...current, [key]: value }));
  };

  const updateTradeForm = (key, value) => {
    setJournalForm((current) => ({ ...current, [key]: value }));
  };

  const handleMarketImage = (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
      setError('Choose a PNG, JPEG, or WebP market image.');
      event.target.value = '';
      return;
    }
    if (file.size > 3 * 1024 * 1024) {
      setError('Market images must be 3 MB or smaller.');
      event.target.value = '';
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      updateTradeForm('market_image', reader.result);
      setError('');
    };
    reader.onerror = () => setError('Could not read the selected market image.');
    reader.readAsDataURL(file);
  };

  const updateKeyNote = (index, key, value) => {
    setJournalForm((current) => ({
      ...current,
      key_notes: current.key_notes.map((item, itemIndex) => itemIndex === index ? { ...item, [key]: value } : item)
    }));
  };

  const savePlan = async () => {
    setSavingPlan(true);
    setError('');
    setNotice('');
    try {
      const response = await fetch('/api/plans', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...plan,
          markets: plan.markets.split(',').map((item) => item.trim()).filter(Boolean),
          confluences: checklistItems
        })
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || 'Could not save the trading plan.');
      setPlan({
        ...result.plan,
        markets: result.plan.markets.join(', '),
        confluences: result.plan.confluences.join('\n'),
        max_risk_per_trade_pct: String(result.plan.max_risk_per_trade_pct),
        max_daily_loss_pct: String(result.plan.max_daily_loss_pct),
        max_consecutive_losses: String(result.plan.max_consecutive_losses)
      });
      setNotice('Your trading plan is saved.');
    } catch (saveError) {
      setError(saveError.message);
    } finally {
      setSavingPlan(false);
    }
  };

  const startPlannedTrade = () => {
    if (!checklistComplete) return;
    const firstMarket = plan.markets.split(',').map((item) => item.trim()).find(Boolean) || '';
    setJournalForm({
      ...emptyTrade,
      symbol: firstMarket,
      setup: plan.strategy_name,
      followed_plan: true,
      checklist: checklistItems
    });
    setShowJournalForm(true);
    setActiveSection('journal');
  };

  const addTrade = async (event) => {
    event.preventDefault();
    setSavingTrade(true);
    setError('');
    try {
      const response = await fetch('/api/trades', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...journalForm,
          entry_price: safeNumber(journalForm.entry_price),
          stop_loss: safeNumber(journalForm.stop_loss),
          take_profit: safeNumber(journalForm.take_profit),
          exit_price: safeNumber(journalForm.exit_price),
          position_size: safeNumber(journalForm.position_size),
          net_pnl: safeNumber(journalForm.net_pnl)
        })
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || 'Could not save this journal entry.');
      setTrades((current) => [result.trade, ...current]);
      setJournalForm(emptyTrade);
      setShowJournalForm(false);
      setNotice('Trade added to your journal.');
    } catch (saveError) {
      setError(saveError.message);
    } finally {
      setSavingTrade(false);
    }
  };

  const saveAccountTransaction = async (event) => {
    event.preventDefault();
    setSavingTransaction(true);
    setError('');
    setNotice('');
    try {
      const response = await fetch('/api/account/transactions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...accountForm,
          amount: Number(accountForm.amount)
        })
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || 'Could not record this transaction.');
      setAccount((current) => ({
        balance: result.balance,
        transactions: [result.transaction, ...current.transactions].slice(0, 100)
      }));
      setNotice(`${result.transaction.type === 'deposit' ? 'Deposit' : 'Withdrawal'} recorded in your balance tracker.`);
      setAccountForm({ type: 'deposit', amount: '', note: '' });
      setShowAccountForm(false);
    } catch (transactionError) {
      setError(transactionError.message);
    } finally {
      setSavingTransaction(false);
    }
  };

  const closeForm = () => {
    setShowJournalForm(false);
    setJournalForm(emptyTrade);
  };

  const planSummary = `${plan.max_risk_per_trade_pct}% max risk · ${plan.max_daily_loss_pct}% daily stop · ${plan.max_consecutive_losses} loss limit`;

  return (
    <div className="app-shell min-h-screen text-slate-100">
      <header className="sticky top-0 z-30 border-b border-white/10 bg-slate-950/65 backdrop-blur-2xl">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <a className="flex min-w-0 items-center gap-3" href="#overview" onClick={() => setActiveSection('overview')}>
            <img className="h-12 w-12 object-contain sm:h-14 sm:w-14" src="/mr-blue-journal-logo.png" alt="MR BLUE JOURNAL logo" />
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.24em] text-cyan-300">MR BLUE JOURNAL</p>
              <h1 className="text-sm font-semibold text-white sm:text-base">Trading plan & journal</h1>
            </div>
          </a>
          <div className="flex items-center gap-2 text-xs text-slate-400">
            <span className={`h-2 w-2 rounded-full ${loading ? 'animate-pulse bg-amber-300' : error ? 'bg-red-400' : 'bg-emerald-300'}`} />
            <span className="hidden sm:inline">{loading ? 'Loading data' : error ? 'Connection issue' : 'Journal synced'}</span>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-8">
        {error && <div className="mb-4 rounded-2xl border border-red-300/20 bg-red-400/10 px-4 py-3 text-sm text-red-100" role="alert">{error}</div>}
        {notice && !error && <div className="mb-4 rounded-2xl border border-emerald-300/20 bg-emerald-400/10 px-4 py-3 text-sm text-emerald-100" role="status">{notice}</div>}

        <nav className="glass-panel mb-6 flex flex-wrap gap-2 rounded-2xl p-2" aria-label="Main navigation">
          {sections.map((section) => (
            <button
              key={section.id}
              onClick={() => setActiveSection(section.id)}
              className={`rounded-xl px-4 py-2 text-sm font-medium transition-all duration-300 ${activeSection === section.id ? 'bg-gradient-to-r from-cyan-300 to-sky-400 text-slate-950 shadow-lg shadow-cyan-400/20' : 'text-slate-300 hover:bg-white/10 hover:text-white'}`}
            >
              {section.label}
            </button>
          ))}
        </nav>

        <section className={`space-y-6 ${activeSection === 'overview' ? 'block' : 'hidden'}`}>
          <div className="glass-panel relative overflow-hidden rounded-3xl px-5 py-7 text-center sm:px-8 sm:py-9">
            <div className="pointer-events-none absolute left-1/2 top-0 h-48 w-80 -translate-x-1/2 rounded-full bg-cyan-400/10 blur-3xl" />
            <div className="relative">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-cyan-200">Current account balance</p>
              <button
                onClick={() => setActiveSection('account')}
                className="mt-2 rounded-xl px-3 py-1 text-4xl font-bold tracking-tight text-white transition hover:text-cyan-100 focus-visible:outline-cyan-200 sm:text-5xl"
                aria-label="Open deposits and withdrawals"
              >
                {formatCurrency(account.balance)}
              </button>
              <p className="mt-1 text-xs text-slate-400">Tracked balance · click to manage deposits and withdrawals</p>
              <div className="mx-auto mt-6 grid max-w-xl grid-cols-2 divide-x divide-white/10 border-t border-white/10 pt-5">
                <div className="px-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-emerald-200">Winning trades</p>
                  <p className="mt-1 text-2xl font-bold text-white">{metrics.wins}</p>
                </div>
                <div className="px-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-rose-200">Losing trades</p>
                  <p className="mt-1 text-2xl font-bold text-white">{metrics.losses}</p>
                </div>
              </div>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <MetricCard label="Net P&L" value={formatCurrency(metrics.totalPnl)} tone={metrics.totalPnl >= 0 ? 'gain' : 'loss'} />
            <MetricCard label="Win rate" value={`${metrics.winRate.toFixed(1)}%`} tone="neutral" />
            <MetricCard label="Profit factor" value={metrics.profitFactor.toFixed(2)} tone="neutral" />
            <MetricCard label="Expectancy" value={formatCurrency(metrics.expectancy)} tone={metrics.expectancy >= 0 ? 'gain' : 'loss'} />
          </div>

          <div className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
            <div className="glass-panel relative overflow-hidden rounded-3xl p-6 sm:p-8">
              <div className="pointer-events-none absolute -right-12 -top-20 h-64 w-64 rounded-full bg-cyan-400/10 blur-3xl" />
              <div className="relative z-10 max-w-xl">
                <span className="rounded-full border border-cyan-300/20 bg-cyan-300/10 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.2em] text-cyan-200">Plan first. Trade with purpose.</span>
                <h2 className="mt-5 text-3xl font-bold leading-tight text-white sm:text-4xl">Your next trade starts with a clear plan.</h2>
                <p className="mt-3 max-w-lg text-sm leading-6 text-slate-300">Review your checklist, confirm every setup rule, then record the trade in your journal. Keep the process simple and repeatable.</p>
                <button onClick={() => setActiveSection('plan')} className="mt-6 rounded-xl bg-gradient-to-r from-cyan-300 to-sky-400 px-5 py-3 text-sm font-bold text-slate-950 shadow-lg shadow-cyan-400/20 transition hover:-translate-y-0.5 hover:shadow-cyan-300/30">Review today’s trade plan <span aria-hidden="true">→</span></button>
              </div>
              <div
                className="glass-float relative mt-8 w-full max-w-xl rounded-3xl border border-white/20 bg-white/[0.07] p-5 shadow-2xl shadow-cyan-950/40"
                onMouseMove={(event) => {
                  const bounds = event.currentTarget.getBoundingClientRect();
                  const x = (event.clientX - bounds.left) / bounds.width;
                  const y = (event.clientY - bounds.top) / bounds.height;
                  event.currentTarget.style.setProperty('--tilt-x', `${(x - 0.5) * 9}deg`);
                  event.currentTarget.style.setProperty('--tilt-y', `${(0.5 - y) * 9}deg`);
                  event.currentTarget.style.setProperty('--glow-x', `${x * 100}%`);
                  event.currentTarget.style.setProperty('--glow-y', `${y * 100}%`);
                }}
                onMouseLeave={(event) => {
                  event.currentTarget.style.setProperty('--tilt-x', '0deg');
                  event.currentTarget.style.setProperty('--tilt-y', '0deg');
                }}
              >
                <div className="pointer-events-none absolute inset-0 rounded-3xl opacity-0 transition-opacity duration-300 hover:opacity-100" />
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-slate-300">ACTIVE STRATEGY</span>
                  <span className="rounded-full bg-emerald-300/10 px-2 py-1 text-[10px] font-semibold text-emerald-200">READY</span>
                </div>
                <p className="mt-5 text-xl font-semibold text-white">{plan.strategy_name}</p>
                <p className="mt-1 text-sm text-slate-400">{plan.markets}</p>
                <div className="mt-5 border-t border-white/10 pt-4 text-xs text-slate-300">{planSummary}</div>
              </div>
            </div>

            <div className="glass-panel rounded-3xl p-6">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-cyan-200">Keep your process simple</p>
              <h2 className="mt-2 text-xl font-semibold text-white">Your trading routine</h2>
              <div className="mt-5 space-y-4">
                <RoutineStep number="01" title="Open your plan" description="Check the setup and risk limits before entering." />
                <RoutineStep number="02" title="Approve each rule" description="Tick every checklist item that is true for this trade." />
                <RoutineStep number="03" title="Journal the result" description="Record execution, outcome, and how you felt." />
              </div>
              <button onClick={() => { setActiveSection('journal'); setShowJournalForm(true); setJournalForm(emptyTrade); }} className="mt-6 w-full rounded-xl border border-white/15 bg-white/[0.06] px-4 py-3 text-sm font-semibold text-white transition hover:bg-white/10">Add a journal entry</button>
            </div>
          </div>
        </section>

        <section className={`space-y-6 ${activeSection === 'account' ? 'block' : 'hidden'}`}>
          <div className="glass-panel overflow-hidden rounded-3xl p-6 sm:p-8">
            <div className="flex flex-wrap items-end justify-between gap-5">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-cyan-200">Manual balance tracker · USD</p>
                <h2 className="mt-2 text-3xl font-bold text-white sm:text-4xl">{formatCurrency(account.balance)}</h2>
                <p className="mt-2 text-sm text-slate-400">Available tracked balance</p>
              </div>
              <div className="flex flex-wrap gap-3">
                <button onClick={() => { setAccountForm({ type: 'deposit', amount: '', note: '' }); setShowAccountForm(true); }} className="rounded-xl bg-gradient-to-r from-cyan-300 to-sky-400 px-5 py-3 text-sm font-bold text-slate-950 transition hover:-translate-y-0.5">＋ Record deposit</button>
                <button onClick={() => { setAccountForm({ type: 'withdrawal', amount: '', note: '' }); setShowAccountForm(true); }} disabled={account.balance <= 0} className="rounded-xl border border-white/15 bg-white/[0.06] px-5 py-3 text-sm font-semibold text-white transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40">− Record withdrawal</button>
              </div>
            </div>
            <p className="mt-6 rounded-xl border border-amber-200/15 bg-amber-200/[0.06] px-4 py-3 text-xs leading-5 text-amber-100/80">This tracker records amounts you enter manually. It does not move money or connect to a bank, broker, or payment service.</p>
          </div>

          <div className="glass-panel overflow-hidden rounded-3xl">
            <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
              <div><p className="text-sm text-slate-400">Your account activity</p><h3 className="text-lg font-semibold text-white">Deposits & withdrawals</h3></div>
              <span className="text-xs text-slate-500">{account.transactions.length} recorded</span>
            </div>
            <div className="overflow-x-auto">
              <div className="min-w-[560px]">
                <div className="grid grid-cols-[1fr_1fr_1.3fr_1fr] border-b border-white/10 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                  <div className="px-5 py-3">Type</div><div className="px-5 py-3">Amount</div><div className="px-5 py-3">Note</div><div className="px-5 py-3">Date</div>
                </div>
                {account.transactions.map((transaction) => (
                  <div key={transaction.id} className="grid grid-cols-[1fr_1fr_1.3fr_1fr] border-b border-white/5 text-sm last:border-0">
                    <div className="px-5 py-4"><span className={`rounded-full px-2.5 py-1 text-xs font-medium ${transaction.type === 'deposit' ? 'bg-emerald-300/10 text-emerald-200' : 'bg-amber-300/10 text-amber-100'}`}>{transaction.type === 'deposit' ? 'Deposit' : 'Withdrawal'}</span></div>
                    <div className={`px-5 py-4 font-semibold ${transaction.type === 'deposit' ? 'text-emerald-200' : 'text-amber-100'}`}>{transaction.type === 'deposit' ? '+' : '−'}{formatCurrency(transaction.amount)}</div>
                    <div className="px-5 py-4 text-slate-300">{transaction.note || '—'}</div>
                    <div className="px-5 py-4 text-slate-400">{new Date(transaction.date).toLocaleDateString()}</div>
                  </div>
                ))}
                {!account.transactions.length && <p className="px-5 py-12 text-center text-sm text-slate-400">No transactions yet. Record a deposit or withdrawal to start tracking your balance.</p>}
              </div>
            </div>
          </div>
        </section>

        <section className={`space-y-6 ${activeSection === 'calculator' ? 'block' : 'hidden'}`}>
          <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
            <div className="glass-panel rounded-3xl p-5 sm:p-7">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-cyan-200">Before you enter</p>
              <h2 className="mt-2 text-2xl font-bold text-white">Position size calculator</h2>
              <p className="mt-2 text-sm leading-6 text-slate-400">Estimate position size from your tracked balance and the price distance to your stop.</p>
              <div className="mt-6 grid gap-4 sm:grid-cols-2">
                <Field label="Trade direction">
                  <select value={calculator.direction} onChange={(event) => setCalculator((current) => ({ ...current, direction: event.target.value }))} className="input">
                    <option value="LONG">Long</option>
                    <option value="SHORT">Short</option>
                  </select>
                </Field>
                <Field label="Risk per trade (%)">
                  <input type="number" min="0.01" max="100" step="0.01" value={calculator.riskPercent} onChange={(event) => setCalculator((current) => ({ ...current, riskPercent: event.target.value }))} className="input" />
                </Field>
                <Field label="Entry price">
                  <input type="number" min="0.00000001" step="any" value={calculator.entry} onChange={(event) => setCalculator((current) => ({ ...current, entry: event.target.value }))} className="input" placeholder="e.g. 1.08500" />
                </Field>
                <Field label="Stop-loss price">
                  <input type="number" min="0.00000001" step="any" value={calculator.stop} onChange={(event) => setCalculator((current) => ({ ...current, stop: event.target.value }))} className="input" placeholder={calculator.direction === 'LONG' ? 'Below entry' : 'Above entry'} />
                </Field>
                <Field label="Take-profit price">
                  <input type="number" min="0.00000001" step="any" value={calculator.target} onChange={(event) => setCalculator((current) => ({ ...current, target: event.target.value }))} className="input" placeholder={calculator.direction === 'LONG' ? 'Above entry' : 'Below entry'} />
                </Field>
                <Field label="Contract units per lot">
                  <input type="number" min="0.00000001" step="any" value={calculator.contractSize} onChange={(event) => setCalculator((current) => ({ ...current, contractSize: event.target.value }))} className="input" />
                </Field>
                <Field label="Broker lot step">
                  <input type="number" min="0.00000001" step="any" value={calculator.lotStep} onChange={(event) => setCalculator((current) => ({ ...current, lotStep: event.target.value }))} className="input" />
                </Field>
                <Field label="Quote-to-account conversion">
                  <input type="number" min="0.00000001" step="any" value={calculator.quoteToAccountRate} onChange={(event) => setCalculator((current) => ({ ...current, quoteToAccountRate: event.target.value }))} className="input" />
                </Field>
                <div className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3">
                  <p className="text-xs text-slate-400">Using current balance</p>
                  <p className="mt-1 font-semibold text-white">{formatCurrency(account.balance)}</p>
                </div>
              </div>
            </div>

            <aside className="glass-panel flex flex-col rounded-3xl p-5 sm:p-7">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-cyan-200">Estimated trade figures</p>
              {positionEstimate ? (
                <>
                  <div className="mt-5 rounded-2xl border border-cyan-200/15 bg-cyan-200/[0.06] p-5">
                    <p className="text-sm text-slate-300">Suggested lot size</p>
                    <p className="mt-2 break-words text-3xl font-bold text-white">{new Intl.NumberFormat('en-US', { maximumFractionDigits: 8 }).format(positionEstimate.lots)} <span className="text-base font-medium text-slate-400">lots</span></p>
                    <p className="mt-1 text-xs text-slate-400">{new Intl.NumberFormat('en-US', { maximumFractionDigits: 4 }).format(positionEstimate.positionUnits)} units</p>
                  </div>
                  <div className="mt-4 space-y-4">
                    <RuleRow label="Risk limit" value={formatCurrency(positionEstimate.riskBudget)} />
                    <RuleRow label="Cash risk at stop" value={formatCurrency(positionEstimate.cashRisk)} />
                    <RuleRow label="Risk per 1.00 lot" value={formatCurrency(positionEstimate.cashRiskPerLot)} />
                    <RuleRow label="Potential target profit" value={formatCurrency(positionEstimate.potentialProfit)} />
                    <RuleRow label="Reward to risk" value={`${positionEstimate.rewardRisk.toFixed(2)} : 1`} />
                  </div>
                  {positionEstimate.minimumLotTooLarge && <p className="mt-4 rounded-xl border border-amber-200/15 bg-amber-200/[0.06] px-4 py-3 text-xs leading-5 text-amber-100/80">The smallest lot step risks more than your selected risk limit. Increase the balance or risk limit, or use a smaller broker lot step.</p>}
                </>
              ) : (
                <div className="mt-5 flex flex-1 items-center justify-center rounded-2xl border border-dashed border-white/15 p-6 text-center text-sm leading-6 text-slate-400">
                  Enter valid entry, stop-loss, and take-profit prices to see your estimates. The stop and target must be on the correct side of entry for the selected direction.
                </div>
              )}
              <p className="mt-5 rounded-xl border border-amber-200/15 bg-amber-200/[0.06] px-4 py-3 text-xs leading-5 text-amber-100/80">Lot size is rounded down to the broker’s lot step to keep risk within your limit. Set the contract units to your broker’s specification. Conversion means account-currency units per 1 quote-currency unit (use 1 when both currencies match). Estimates exclude spread, commission, slippage, and margin; verify with your broker.</p>
            </aside>
          </div>
        </section>

        <section className={`space-y-6 ${activeSection === 'plan' ? 'block' : 'hidden'}`}>
          <div className="grid gap-6 lg:grid-cols-[1.15fr_0.85fr]">
            <div className="glass-panel rounded-3xl p-5 sm:p-6">
              <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-sm text-slate-400">Make it yours</p>
                  <h2 className="text-xl font-semibold text-white">{plan.strategy_name}</h2>
                </div>
                <button onClick={savePlan} disabled={savingPlan} className="rounded-xl bg-gradient-to-r from-cyan-300 to-sky-400 px-4 py-2.5 text-sm font-bold text-slate-950 transition hover:brightness-110 disabled:cursor-wait disabled:opacity-60">{savingPlan ? 'Saving…' : 'Save plan'}</button>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Strategy name"><input value={plan.strategy_name} onChange={(event) => updatePlan('strategy_name', event.target.value)} className="input" /></Field>
                <Field label="Markets (comma separated)"><input value={plan.markets} onChange={(event) => updatePlan('markets', event.target.value)} className="input" /></Field>
                <Field label="Max risk per trade (%)"><input type="number" min="0.1" step="0.1" value={plan.max_risk_per_trade_pct} onChange={(event) => updatePlan('max_risk_per_trade_pct', event.target.value)} className="input" /></Field>
                <Field label="Max daily loss (%)"><input type="number" min="0.1" step="0.1" value={plan.max_daily_loss_pct} onChange={(event) => updatePlan('max_daily_loss_pct', event.target.value)} className="input" /></Field>
                <Field label="Stop after losses"><input type="number" min="1" step="1" value={plan.max_consecutive_losses} onChange={(event) => updatePlan('max_consecutive_losses', event.target.value)} className="input" /></Field>
                <Field label="Target risk / reward"><input value={plan.target_rr} onChange={(event) => updatePlan('target_rr', event.target.value)} className="input" /></Field>
              </div>
              <Field label="Checklist (one rule per line)" className="mt-4"><textarea value={plan.confluences} onChange={(event) => updatePlan('confluences', event.target.value)} className="input min-h-36" /></Field>
            </div>

            <aside className="glass-panel rounded-3xl p-5 sm:p-6">
              <p className="text-sm text-slate-400">Your pre-trade approval</p>
              <h2 className="mt-1 text-xl font-semibold text-white">Follow your plan</h2>
              <p className="mt-2 text-sm leading-6 text-slate-400">Confirm each rule before trading. Your checklist will be saved with the journal entry.</p>
              <div className="mt-5 space-y-3">
                {checklistItems.map((item, index) => (
                  <label key={`${index}-${item}`} className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3 text-sm transition ${checklistChecks[index] ? 'border-cyan-300/30 bg-cyan-300/10 text-white' : 'border-white/10 bg-white/[0.03] text-slate-300 hover:bg-white/[0.06]'}`}>
                    <input
                      type="checkbox"
                      checked={Boolean(checklistChecks[index])}
                      onChange={(event) => setChecklistChecks((current) => current.map((checked, itemIndex) => itemIndex === index ? event.target.checked : checked))}
                      className="mt-0.5 accent-cyan-300"
                    />
                    <span>{item}</span>
                  </label>
                ))}
                {checklistItems.length === 0 && <p className="rounded-xl border border-amber-300/20 bg-amber-300/10 p-3 text-sm text-amber-100">Add at least one checklist rule before approving a trade.</p>}
              </div>
              <div className="mt-5 flex items-center justify-between text-xs text-slate-400">
                <span>{checkedCount} of {checklistItems.length} rules confirmed</span>
                <span>{checklistComplete ? 'Ready to journal' : 'Complete all rules'}</span>
              </div>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/10">
                <div className="h-full rounded-full bg-gradient-to-r from-cyan-300 to-sky-400 transition-all duration-500" style={{ width: `${checklistItems.length ? (checkedCount / checklistItems.length) * 100 : 0}%` }} />
              </div>
              <button onClick={startPlannedTrade} disabled={!checklistComplete} className="mt-5 w-full rounded-xl bg-gradient-to-r from-cyan-300 to-sky-400 px-4 py-3 font-bold text-slate-950 transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40">Approve plan & journal trade</button>
              <div className="mt-5 space-y-3 border-t border-white/10 pt-4 text-sm">
                <RuleRow label="Risk per trade" value={`${plan.max_risk_per_trade_pct}%`} />
                <RuleRow label="Daily loss cap" value={`${plan.max_daily_loss_pct}%`} />
                <RuleRow label="Target R:R" value={`${plan.target_rr}`} />
              </div>
            </aside>
          </div>
        </section>

        <section className={`space-y-6 ${activeSection === 'journal' ? 'block' : 'hidden'}`}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm text-slate-400">Every trade, one place</p>
              <h2 className="text-2xl font-semibold text-white">Trade journal</h2>
            </div>
            <button onClick={() => { setJournalForm(emptyTrade); setShowJournalForm(true); }} className="rounded-xl bg-gradient-to-r from-cyan-300 to-sky-400 px-4 py-2.5 font-bold text-slate-950 shadow-lg shadow-cyan-400/15 transition hover:-translate-y-0.5">Add trade</button>
          </div>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <MetricCard label="Total trades" value={String(trades.length)} tone="neutral" />
            <MetricCard label="Average win" value={formatCurrency(metrics.avgWin)} tone="gain" />
            <MetricCard label="Average loss" value={formatCurrency(metrics.avgLoss)} tone="loss" />
            <MetricCard label="Net R" value={`${metrics.netR.toFixed(1)}R`} tone={metrics.netR >= 0 ? 'gain' : 'loss'} />
          </div>
          <div className="glass-panel overflow-hidden rounded-3xl">
            <div className="overflow-x-auto">
              <div className="min-w-[720px]">
                <div className="grid grid-cols-[1.2fr_0.9fr_0.8fr_0.9fr_0.6fr] border-b border-white/10 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                  <div className="px-4 py-3">Trade</div><div className="px-4 py-3">Entry / exit</div><div className="px-4 py-3">P&L</div><div className="px-4 py-3">Setup</div><div className="px-4 py-3">Plan</div>
                </div>
                <div className="max-h-[460px] overflow-auto">
                  {trades.map((trade) => (
                    <div key={trade.id} className="border-b border-white/5 last:border-0">
                      <div className="grid grid-cols-[1.2fr_0.9fr_0.8fr_0.9fr_0.6fr] text-sm">
                        <div className="px-4 py-3"><p className="font-semibold text-white">{trade.symbol}<span className="ml-2 text-xs text-slate-500">{trade.date}</span></p><p className="mt-1 text-xs text-slate-400">{trade.direction} · {trade.session}</p></div>
                        <div className="px-4 py-3 text-slate-300">{trade.entry} / {trade.exit}</div>
                        <div className={`px-4 py-3 font-semibold ${trade.pnl >= 0 ? 'text-emerald-200' : 'text-rose-200'}`}>{formatCurrency(trade.pnl)}</div>
                        <div className="px-4 py-3 text-slate-300">{trade.setup}</div>
                        <div className="px-4 py-3"><span className={`rounded-full px-2 py-1 text-xs ${trade.plan ? 'bg-emerald-300/10 text-emerald-200' : 'bg-rose-300/10 text-rose-200'}`}>{trade.plan ? 'Followed' : 'Breach'}</span></div>
                      </div>
                      {(trade.market_image || trade.key_notes?.length > 0) && (
                        <details className="px-4 pb-3">
                          <summary className="cursor-pointer text-xs font-medium text-cyan-200 hover:text-cyan-100">View market image & key notes</summary>
                          <div className="mt-3 grid gap-4 rounded-2xl border border-white/10 bg-slate-950/40 p-4 sm:grid-cols-2">
                            {trade.market_image && <img src={trade.market_image} alt={`Market chart for ${trade.symbol}`} className="max-h-72 w-full rounded-xl border border-white/10 object-contain" />}
                            {trade.key_notes?.length > 0 && <ol className="space-y-2">
                              {trade.key_notes.map((item, index) => <li key={`${index}-${item.text}`} className="flex items-start gap-2 text-sm text-slate-300"><span className="font-mono text-cyan-200">{index + 1}.</span><span className={item.checked ? 'text-slate-300' : 'text-slate-500'}>{item.checked ? '☑' : '☐'} {item.text}</span></li>)}
                            </ol>}
                          </div>
                        </details>
                      )}
                    </div>
                  ))}
                  {!trades.length && <p className="px-4 py-12 text-center text-sm text-slate-400">No trades yet. Follow your plan or add a journal entry to get started.</p>}
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className={`space-y-6 ${activeSection === 'analytics' ? 'block' : 'hidden'}`}>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <MetricCard label="Profit factor" value={metrics.profitFactor.toFixed(2)} tone="neutral" />
            <MetricCard label="Max drawdown" value={formatCurrency(metrics.maxDrawdown)} tone="loss" />
            <MetricCard label="Average win" value={formatCurrency(metrics.avgWin)} tone="gain" />
            <MetricCard label="Average loss" value={formatCurrency(metrics.avgLoss)} tone="loss" />
          </div>
          <div className="grid gap-6 lg:grid-cols-2">
            <div className="glass-panel rounded-3xl p-5">
              <p className="text-sm text-slate-400">Journal breakdown</p>
              <h2 className="mt-1 text-lg font-semibold text-white">Results by session</h2>
              {sessions.length ? <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3">
                {sessions.map(([session, result]) => <div key={session} className={`rounded-2xl border border-white/5 p-4 text-center ${result >= 0 ? 'bg-emerald-300/10' : 'bg-rose-300/10'}`}><p className="text-xs uppercase tracking-wider text-slate-300">{session}</p><p className={`mt-2 font-semibold ${result >= 0 ? 'text-emerald-200' : 'text-rose-200'}`}>{formatCurrency(result)}</p></div>)}
              </div> : <p className="mt-5 text-sm text-slate-400">Session results will appear after you log trades.</p>}
            </div>
            <div className="glass-panel rounded-3xl p-5">
              <p className="text-sm text-slate-400">Recent reflection</p>
              <h2 className="mt-1 text-lg font-semibold text-white">Latest journal notes</h2>
              <div className="mt-5 space-y-3">
                {trades.slice(0, 3).map((trade) => <ReviewItem key={trade.id} title={`${trade.date} · ${trade.symbol}`} text={trade.note || 'No reflection added.'} result={trade.plan ? 'Plan followed' : 'Plan not followed'} />)}
                {!trades.length && <p className="text-sm text-slate-400">Add a journal entry to start reflecting on your trading.</p>}
              </div>
            </div>
          </div>
        </section>
      </main>

      {showAccountForm && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/75 p-4 backdrop-blur-md">
          <form onSubmit={saveAccountTransaction} className="glass-panel w-full max-w-md rounded-3xl p-5 shadow-2xl sm:p-6">
            <div className="mb-5 flex items-start justify-between gap-3">
              <div>
                <p className="text-sm text-slate-400">Manual balance entry</p>
                <h2 className="text-xl font-semibold text-white">{accountForm.type === 'deposit' ? 'Record a deposit' : 'Record a withdrawal'}</h2>
              </div>
              <button type="button" onClick={() => setShowAccountForm(false)} className="rounded-lg bg-white/10 px-3 py-2 text-sm text-slate-300 transition hover:bg-white/15">Close</button>
            </div>
            <Field label="Transaction type">
              <select value={accountForm.type} onChange={(event) => setAccountForm((current) => ({ ...current, type: event.target.value }))} className="input">
                <option value="deposit">Deposit</option>
                <option value="withdrawal">Withdrawal</option>
              </select>
            </Field>
            <Field label="Amount (USD)" className="mt-4">
              <input required type="number" min="0.01" max={accountForm.type === 'withdrawal' ? account.balance : undefined} step="0.01" value={accountForm.amount} onChange={(event) => setAccountForm((current) => ({ ...current, amount: event.target.value }))} className="input" placeholder="0.00" />
            </Field>
            <Field label="Note (optional)" className="mt-4">
              <input maxLength="255" value={accountForm.note} onChange={(event) => setAccountForm((current) => ({ ...current, note: event.target.value }))} className="input" placeholder="e.g. Monthly account funding" />
            </Field>
            {accountForm.type === 'withdrawal' && <p className="mt-3 text-xs text-slate-400">Available tracked balance: {formatCurrency(account.balance)}</p>}
            <div className="mt-6 flex justify-end gap-3">
              <button type="button" onClick={() => setShowAccountForm(false)} className="rounded-xl border border-white/15 px-4 py-2.5 text-sm font-medium text-slate-300">Cancel</button>
              <button type="submit" disabled={savingTransaction} className="rounded-xl bg-gradient-to-r from-cyan-300 to-sky-400 px-5 py-2.5 font-bold text-slate-950 disabled:opacity-60">{savingTransaction ? 'Saving…' : 'Save transaction'}</button>
            </div>
          </form>
        </div>
      )}

      {showJournalForm && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/75 p-4 backdrop-blur-md">
          <form onSubmit={addTrade} className="glass-panel max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-3xl p-5 shadow-2xl sm:p-6">
            <div className="mb-5 flex items-center justify-between gap-3">
              <div><p className="text-sm text-slate-400">{journalForm.followed_plan ? 'Plan approved' : 'Add a journal entry'}</p><h2 className="text-xl font-semibold text-white">Trade details</h2></div>
              <button type="button" onClick={closeForm} className="rounded-lg bg-white/10 px-3 py-2 text-sm text-slate-300 transition hover:bg-white/15">Close</button>
            </div>
            {journalForm.followed_plan && <p className="mb-4 rounded-xl border border-emerald-300/20 bg-emerald-300/10 p-3 text-sm text-emerald-100">Your approved checklist will be saved with this trade.</p>}
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Market"><input required value={journalForm.symbol} onChange={(event) => updateTradeForm('symbol', event.target.value)} className="input" /></Field>
              <Field label="Direction"><select value={journalForm.direction} onChange={(event) => updateTradeForm('direction', event.target.value)} className="input"><option>LONG</option><option>SHORT</option></select></Field>
              <Field label="Entry price"><input required type="number" min="0.00000001" step="any" value={journalForm.entry_price} onChange={(event) => updateTradeForm('entry_price', event.target.value)} className="input" /></Field>
              <Field label="Exit price"><input required type="number" min="0.00000001" step="any" value={journalForm.exit_price} onChange={(event) => updateTradeForm('exit_price', event.target.value)} className="input" /></Field>
              <Field label="Stop-loss"><input required type="number" min="0.00000001" step="any" value={journalForm.stop_loss} onChange={(event) => updateTradeForm('stop_loss', event.target.value)} className="input" /></Field>
              <Field label="Take-profit"><input required type="number" min="0.00000001" step="any" value={journalForm.take_profit} onChange={(event) => updateTradeForm('take_profit', event.target.value)} className="input" /></Field>
              <Field label="Position size"><input required type="number" min="0.00000001" step="any" value={journalForm.position_size} onChange={(event) => updateTradeForm('position_size', event.target.value)} className="input" /></Field>
              <Field label="Net P&L ($)"><input required type="number" step="any" value={journalForm.net_pnl} onChange={(event) => updateTradeForm('net_pnl', event.target.value)} className="input" /></Field>
              <Field label="Setup"><input required value={journalForm.setup} onChange={(event) => updateTradeForm('setup', event.target.value)} className="input" /></Field>
              <Field label="Session"><select value={journalForm.session} onChange={(event) => updateTradeForm('session', event.target.value)} className="input"><option>London</option><option>New York</option><option>New York Open</option><option>Asia</option><option>Other</option></select></Field>
              <Field label="How did you feel?"><select value={journalForm.emotion} onChange={(event) => updateTradeForm('emotion', event.target.value)} className="input"><option>Disciplined</option><option>Calm</option><option>FOMO</option><option>Revenge Trade</option><option>Unsure</option></select></Field>
              <Field label="Did you follow your plan?"><select value={journalForm.followed_plan ? 'true' : 'false'} onChange={(event) => updateTradeForm('followed_plan', event.target.value === 'true')} className="input"><option value="true">Yes</option><option value="false">No</option></select></Field>
            </div>
            <section className="mt-5 rounded-2xl border border-white/10 bg-slate-950/30 p-4">
              <div className="mb-3">
                <p className="text-sm font-semibold text-white">Market screenshot</p>
                <p className="mt-1 text-xs text-slate-400">Attach the chart or market image you used for this setup (PNG, JPEG, or WebP; up to 3 MB).</p>
              </div>
              <input type="file" accept="image/png,image/jpeg,image/webp" onChange={handleMarketImage} className="block w-full text-sm text-slate-300 file:mr-3 file:rounded-lg file:border-0 file:bg-white/10 file:px-3 file:py-2 file:text-xs file:font-medium file:text-white hover:file:bg-white/15" />
              {journalForm.market_image && <div className="relative mt-4 inline-block">
                <img src={journalForm.market_image} alt="Selected market chart preview" className="max-h-56 max-w-full rounded-xl border border-white/10 object-contain" />
                <button type="button" onClick={() => updateTradeForm('market_image', '')} className="mt-2 rounded-lg border border-white/15 px-3 py-1.5 text-xs text-slate-300 hover:bg-white/10">Remove image</button>
              </div>}
            </section>
            <section className="mt-4 rounded-2xl border border-white/10 bg-slate-950/30 p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-white">Key notes & confirmations</p>
                  <p className="mt-1 text-xs text-slate-400">Add observations in order, then tick the notes that your execution confirmed.</p>
                </div>
                <button type="button" onClick={() => setJournalForm((current) => current.key_notes.length < 30 ? { ...current, key_notes: [...current.key_notes, { text: '', checked: false }] } : current)} disabled={journalForm.key_notes.length >= 30} className="rounded-lg border border-cyan-200/20 bg-cyan-200/10 px-3 py-2 text-xs font-semibold text-cyan-100 transition hover:bg-cyan-200/15 disabled:opacity-40">＋ Add note</button>
              </div>
              <ol className="mt-4 space-y-3">
                {journalForm.key_notes.map((item, index) => (
                  <li key={index} className="flex items-start gap-3 rounded-xl border border-white/10 bg-white/[0.03] p-3">
                    <span className="mt-2 min-w-6 font-mono text-xs text-cyan-200">{String(index + 1).padStart(2, '0')}</span>
                    <textarea aria-label={`Key market note ${index + 1}`} maxLength="1000" rows="2" value={item.text} onChange={(event) => updateKeyNote(index, 'text', event.target.value)} className="input min-h-12 flex-1 resize-y" placeholder="e.g. Price reclaimed the 15-minute support zone" />
                    <label className="mt-2 flex shrink-0 cursor-pointer items-center gap-2 text-xs text-slate-300">
                      <input type="checkbox" checked={item.checked} onChange={(event) => updateKeyNote(index, 'checked', event.target.checked)} className="accent-cyan-300" />
                      Confirmed
                    </label>
                    {journalForm.key_notes.length > 1 && <button type="button" aria-label={`Remove key note ${index + 1}`} onClick={() => setJournalForm((current) => ({ ...current, key_notes: current.key_notes.filter((_, itemIndex) => itemIndex !== index) }))} className="mt-2 text-xs text-slate-500 hover:text-rose-200">Remove</button>}
                  </li>
                ))}
              </ol>
            </section>
            <Field label="Trade reflection" className="mt-4"><textarea value={journalForm.note} onChange={(event) => updateTradeForm('note', event.target.value)} className="input min-h-24" placeholder="What went well? What will you improve next time?" /></Field>
            <div className="mt-5 rounded-2xl border border-white/10 bg-slate-950/50 p-4">
              <p className="text-xs uppercase tracking-wider text-slate-400">Quick risk check</p>
              <div className="mt-3 flex flex-wrap gap-2 text-sm">
                <span className="rounded-full bg-white/10 px-3 py-1.5">Risk: <strong>{tradeCalculations.risk ? formatCurrency(tradeCalculations.risk) : '—'}</strong></span>
                <span className="rounded-full bg-white/10 px-3 py-1.5">R:R <strong>{tradeCalculations.rr.toFixed(2)}:1</strong></span>
                <span className="rounded-full bg-white/10 px-3 py-1.5">Result <strong>{tradeCalculations.rMultiple.toFixed(2)}R</strong></span>
              </div>
            </div>
            <div className="mt-5 flex justify-end gap-3">
              <button type="button" onClick={closeForm} className="rounded-xl border border-white/15 px-4 py-2.5 text-sm font-medium text-slate-300">Cancel</button>
              <button type="submit" disabled={savingTrade} className="rounded-xl bg-gradient-to-r from-cyan-300 to-sky-400 px-5 py-2.5 font-bold text-slate-950 disabled:opacity-60">{savingTrade ? 'Saving…' : 'Save journal entry'}</button>
            </div>
          </form>
        </div>
      )}
      <footer className="pb-8 pt-2 text-center text-xs text-slate-500">Plan your setup. Respect your risk. Review every trade.</footer>
    </div>
  );
}

function MetricCard({ label, value, tone }) {
  const tones = {
    gain: 'border-emerald-300/15 bg-emerald-300/[0.07]',
    loss: 'border-rose-300/15 bg-rose-300/[0.07]',
    neutral: 'border-white/10 bg-white/[0.04]'
  };
  return <div className={`glass-panel rounded-2xl border p-4 transition duration-300 hover:-translate-y-1 ${tones[tone]}`}><p className="text-xs uppercase tracking-wider text-slate-400">{label}</p><p className="mt-2 text-2xl font-bold text-white">{value}</p></div>;
}

function Field({ label, children, className = '' }) {
  return <label className={`block ${className}`}><span className="mb-2 block text-sm font-medium text-slate-300">{label}</span>{children}</label>;
}

function RuleRow({ label, value }) {
  return <div className="flex items-center justify-between border-b border-white/10 pb-2 last:border-0 last:pb-0"><span className="text-slate-400">{label}</span><span className="font-medium text-white">{value}</span></div>;
}

function RoutineStep({ number, title, description }) {
  return <div className="flex gap-3"><span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-cyan-200/15 bg-cyan-200/10 text-xs font-bold text-cyan-100">{number}</span><div><p className="text-sm font-semibold text-white">{title}</p><p className="mt-1 text-xs leading-5 text-slate-400">{description}</p></div></div>;
}

function ReviewItem({ title, text, result }) {
  return <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-3"><div className="flex items-center justify-between gap-3"><p className="text-sm font-medium text-white">{title}</p><span className={`rounded-full px-2 py-1 text-xs ${result === 'Plan followed' ? 'bg-emerald-300/10 text-emerald-100' : 'bg-rose-300/10 text-rose-100'}`}>{result}</span></div><p className="mt-2 text-sm leading-6 text-slate-400">{text}</p></div>;
}

export default App;
