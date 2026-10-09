import { randomUUID } from 'node:crypto';
import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { initializeDatabase, pool, testDatabaseConnection } from './bd.js';

dotenv.config();

const app = express();
const port = Number(process.env.PORT || 3001);

app.use(cors({ origin: true }));
app.use(express.json({ limit: '5mb' }));

const parseJson = (value) => typeof value === 'string' ? JSON.parse(value) : value;

function serializePlan(row) {
  return {
    strategy_name: row.strategy_name,
    markets: parseJson(row.markets),
    max_risk_per_trade_pct: Number(row.max_risk_per_trade_pct),
    max_daily_loss_pct: Number(row.max_daily_loss_pct),
    max_consecutive_losses: Number(row.max_consecutive_losses),
    confluences: parseJson(row.confluences),
    target_rr: row.target_rr
  };
}

function serializeTrade(row) {
  return {
    id: row.trade_id,
    symbol: row.symbol,
    direction: row.direction,
    entry: Number(row.entry_price),
    stop: Number(row.stop_loss),
    target: Number(row.take_profit),
    exit: Number(row.exit_price),
    position_size: Number(row.position_size),
    pnl: Number(row.net_pnl),
    rMultiple: Number(row.r_multiple),
    date: new Date(row.created_at).toISOString().slice(0, 10),
    setup: row.setup,
    session: row.session_name,
    emotion: row.emotion,
    plan: Boolean(row.followed_plan),
    checklist: parseJson(row.checklist),
    key_notes: parseJson(row.key_notes || '[]'),
    market_image: row.market_image,
    note: row.note
  };
}

function toList(value) {
  if (Array.isArray(value)) return value.map(String).map((item) => item.trim()).filter(Boolean);
  if (typeof value === 'string') return value.split(/\r?\n|,/).map((item) => item.trim()).filter(Boolean);
  return [];
}

app.get('/api/health', async (request, response, next) => {
  try {
    const databaseConnected = await testDatabaseConnection();
    response.json({
      ok: databaseConnected,
      service: 'fx-trading-app',
      database: databaseConnected ? 'connected' : 'disconnected'
    });
  } catch (error) {
    next(error);
  }
});

app.get('/api/plans', async (request, response, next) => {
  try {
    const [rows] = await pool.execute('SELECT * FROM trading_plans WHERE id = 1');
    if (rows.length === 0) {
      response.status(404).json({ message: 'Trading plan not found' });
      return;
    }
    response.json({ plan: serializePlan(rows[0]) });
  } catch (error) {
    next(error);
  }
});

app.post('/api/plans', async (request, response, next) => {
  const body = request.body || {};
  const strategyName = typeof body.strategy_name === 'string' ? body.strategy_name.trim() : '';
  const markets = toList(body.markets);
  const confluences = toList(body.confluences);
  const maxRisk = Number(body.max_risk_per_trade_pct);
  const maxDailyLoss = Number(body.max_daily_loss_pct);
  const maxLosses = Number(body.max_consecutive_losses);
  const targetRr = typeof body.target_rr === 'string' ? body.target_rr.trim() : '';

  if (
    !strategyName || !markets.length || !confluences.length || !targetRr ||
    !Number.isFinite(maxRisk) || maxRisk <= 0 ||
    !Number.isFinite(maxDailyLoss) || maxDailyLoss <= 0 ||
    !Number.isInteger(maxLosses) || maxLosses < 1
  ) {
    response.status(400).json({ message: 'Complete every plan field with valid values before saving.' });
    return;
  }

  try {
    await pool.execute(
      `INSERT INTO trading_plans
        (id, strategy_name, markets, max_risk_per_trade_pct, max_daily_loss_pct,
         max_consecutive_losses, confluences, target_rr)
       VALUES (1, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE strategy_name = VALUES(strategy_name),
         markets = VALUES(markets), max_risk_per_trade_pct = VALUES(max_risk_per_trade_pct),
         max_daily_loss_pct = VALUES(max_daily_loss_pct),
         max_consecutive_losses = VALUES(max_consecutive_losses),
         confluences = VALUES(confluences), target_rr = VALUES(target_rr)`,
      [strategyName, JSON.stringify(markets), maxRisk, maxDailyLoss, maxLosses, JSON.stringify(confluences), targetRr]
    );
    const [rows] = await pool.execute('SELECT * FROM trading_plans WHERE id = 1');
    response.status(200).json({ message: 'Trading plan saved', plan: serializePlan(rows[0]) });
  } catch (error) {
    next(error);
  }
});

app.get('/api/trades', async (request, response, next) => {
  try {
    const [rows] = await pool.execute('SELECT * FROM trade_journal ORDER BY created_at DESC');
    response.json({ trades: rows.map(serializeTrade) });
  } catch (error) {
    next(error);
  }
});

app.post('/api/trades', async (request, response, next) => {
  const body = request.body || {};
  const numericFields = [
    body.entry_price, body.stop_loss, body.take_profit, body.exit_price,
    body.position_size, body.net_pnl
  ].map(Number);
  const [entry, stop, target, exit, positionSize, netPnl] = numericFields;
  const symbol = typeof body.symbol === 'string' ? body.symbol.trim() : '';
  const direction = body.direction;
  const setup = typeof body.setup === 'string' ? body.setup.trim() : '';
  const session = typeof body.session === 'string' ? body.session.trim() : '';
  const emotion = typeof body.emotion === 'string' ? body.emotion.trim() : '';
  const checklist = toList(body.checklist);
  const keyNotes = Array.isArray(body.key_notes)
    ? body.key_notes
      .filter((item) => item && typeof item.text === 'string' && item.text.trim())
      .map((item) => ({ text: item.text.trim().slice(0, 1000), checked: item.checked === true }))
    : [];
  const marketImage = typeof body.market_image === 'string' && body.market_image
    ? body.market_image
    : null;

  if (
    !symbol || !['LONG', 'SHORT'].includes(direction) || !setup || !session || !emotion ||
    numericFields.some((value) => !Number.isFinite(value)) || positionSize <= 0 ||
    entry <= 0 || stop <= 0 || target <= 0 || exit <= 0 ||
    typeof body.followed_plan !== 'boolean'
  ) {
    response.status(400).json({ message: 'Provide valid trade details before saving the journal entry.' });
    return;
  }

  if (
    (body.key_notes !== undefined && !Array.isArray(body.key_notes)) ||
    keyNotes.length > 30 ||
    (marketImage && (
      marketImage.length > 4 * 1024 * 1024 ||
      !/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(marketImage)
    ))
  ) {
    response.status(400).json({ message: 'Use a PNG, JPEG, or WebP market image under 3 MB and no more than 30 key notes.' });
    return;
  }

  const riskPerUnit = Math.abs(entry - stop);
  const rMultiple = riskPerUnit
    ? ((exit - entry) / (direction === 'LONG' ? 1 : -1)) / riskPerUnit
    : 0;
  const note = typeof body.note === 'string' ? body.note.trim() : '';
  const tradeId = randomUUID();

  try {
    if (body.followed_plan) {
      const [plans] = await pool.execute('SELECT confluences FROM trading_plans WHERE id = 1');
      const requiredChecklist = plans.length ? parseJson(plans[0].confluences) : [];
      const checklistApproved = checklist.length === requiredChecklist.length &&
        requiredChecklist.every((item, index) => checklist[index] === item);
      if (!checklistApproved) {
        response.status(400).json({ message: 'Approve every current trading-plan checklist rule before saving this trade.' });
        return;
      }
    }

    await pool.execute(
      `INSERT INTO trade_journal
        (trade_id, symbol, direction, entry_price, stop_loss, take_profit, exit_price,
         position_size, net_pnl, r_multiple, setup, session_name, emotion, followed_plan,
         checklist, key_notes, market_image, note)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        tradeId, symbol, direction, entry, stop, target, exit, positionSize, netPnl,
        rMultiple, setup, session, emotion, body.followed_plan, JSON.stringify(checklist),
        JSON.stringify(keyNotes), marketImage, note
      ]
    );
    const [rows] = await pool.execute('SELECT * FROM trade_journal WHERE trade_id = ?', [tradeId]);
    response.status(201).json({ message: 'Trade saved', trade: serializeTrade(rows[0]) });
  } catch (error) {
    next(error);
  }
});

app.get('/api/account', async (request, response, next) => {
  try {
    const [[account], [rows]] = await Promise.all([
      pool.execute('SELECT balance FROM account_balance WHERE id = 1'),
      pool.execute('SELECT * FROM account_transactions ORDER BY created_at DESC LIMIT 100')
    ]);
    response.json({
      balance: Number(account?.balance || 0),
      transactions: rows.map((row) => ({
        id: row.transaction_id,
        type: row.transaction_type,
        amount: Number(row.amount),
        note: row.note,
        date: new Date(row.created_at).toISOString()
      }))
    });
  } catch (error) {
    next(error);
  }
});

app.post('/api/account/transactions', async (request, response, next) => {
  const body = request.body || {};
  const type = body.type;
  const amount = Number(body.amount);
  const note = typeof body.note === 'string' ? body.note.trim().slice(0, 255) : '';

  if (!['deposit', 'withdrawal'].includes(type) || !Number.isFinite(amount) || amount <= 0 || Math.round(amount * 100) !== amount * 100) {
    response.status(400).json({ message: 'Choose a deposit or withdrawal and enter an amount greater than zero with up to two decimal places.' });
    return;
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.execute('SELECT balance FROM account_balance WHERE id = 1 FOR UPDATE');
    if (!rows.length) {
      throw new Error('Account balance has not been initialized');
    }

    const balance = Number(rows[0].balance);
    if (type === 'withdrawal' && amount > balance) {
      await connection.rollback();
      response.status(400).json({ message: 'Withdrawal exceeds the available account balance.' });
      return;
    }

    const transactionId = randomUUID();
    const adjustment = type === 'deposit' ? amount : -amount;
    await connection.execute('UPDATE account_balance SET balance = balance + ? WHERE id = 1', [adjustment]);
    await connection.execute(
      'INSERT INTO account_transactions (transaction_id, transaction_type, amount, note) VALUES (?, ?, ?, ?)',
      [transactionId, type, amount, note]
    );
    const [[updatedAccount]] = await connection.execute('SELECT balance FROM account_balance WHERE id = 1');
    const [[transaction]] = await connection.execute('SELECT * FROM account_transactions WHERE transaction_id = ?', [transactionId]);
    await connection.commit();

    response.status(201).json({
      message: `${type === 'deposit' ? 'Deposit' : 'Withdrawal'} recorded`,
      balance: Number(updatedAccount.balance),
      transaction: {
        id: transaction.transaction_id,
        type: transaction.transaction_type,
        amount: Number(transaction.amount),
        note: transaction.note,
        date: new Date(transaction.created_at).toISOString()
      }
    });
  } catch (error) {
    await connection.rollback();
    next(error);
  } finally {
    connection.release();
  }
});

app.get('/api/analytics', async (request, response, next) => {
  try {
    const [trades] = await pool.execute('SELECT net_pnl FROM trade_journal');
    const totals = trades.reduce((summary, trade) => {
      const pnl = Number(trade.net_pnl);
      summary.total_pnl += pnl;
      summary.wins += pnl > 0 ? 1 : 0;
      summary.losses += pnl < 0 ? 1 : 0;
      summary.total_trades += 1;
      return summary;
    }, { total_pnl: 0, wins: 0, losses: 0, total_trades: 0 });

    const grossProfit = trades.reduce((sum, trade) => sum + Math.max(Number(trade.net_pnl), 0), 0);
    const grossLoss = trades.reduce((sum, trade) => sum + Math.abs(Math.min(Number(trade.net_pnl), 0)), 0);
    const winRate = totals.total_trades ? (totals.wins / totals.total_trades) * 100 : 0;

    response.json({
      totals,
      metrics: {
        win_rate: winRate,
        profit_factor: grossLoss ? grossProfit / grossLoss : 0,
        expectancy: totals.total_trades ? totals.total_pnl / totals.total_trades : 0,
        net_pnl: totals.total_pnl
      }
    });
  } catch (error) {
    next(error);
  }
});

app.use((error, request, response, next) => {
  console.error(error);
  if (response.headersSent) {
    next(error);
    return;
  }
  response.status(500).json({ message: 'Internal server error' });
});

async function startServer() {
  try {
    await initializeDatabase();
    app.listen(port, () => {
      console.log(`FX trading backend running on http://localhost:${port}`);
    });
  } catch (error) {
    console.error('Failed to initialize the trading database:', error);
    await pool.end();
    process.exitCode = 1;
  }
}

startServer();
