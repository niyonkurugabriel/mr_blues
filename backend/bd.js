import mysql from 'mysql2/promise';
import dotenv from 'dotenv';

dotenv.config();

const databaseName = process.env.DB_NAME || 'mysql:9';
const connectionOptions = {
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || ''
};

export const pool = mysql.createPool({
  ...connectionOptions,
  database: databaseName,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

export async function initializeDatabase() {
  if (!/^[a-zA-Z0-9_:]+$/.test(databaseName)) {
    throw new Error('DB_NAME may contain only letters, numbers, underscores, and colons');
  }

  const connection = await mysql.createConnection(connectionOptions);
  try {
    await connection.query(`CREATE DATABASE IF NOT EXISTS \`${databaseName}\``);
  } finally {
    await connection.end();
  }

  await pool.query(`
    CREATE TABLE IF NOT EXISTS trading_plans (
      id TINYINT UNSIGNED NOT NULL PRIMARY KEY,
      strategy_name VARCHAR(150) NOT NULL,
      markets JSON NOT NULL,
      max_risk_per_trade_pct DECIMAL(6,2) NOT NULL,
      max_daily_loss_pct DECIMAL(6,2) NOT NULL,
      max_consecutive_losses INT UNSIGNED NOT NULL,
      confluences JSON NOT NULL,
      target_rr VARCHAR(30) NOT NULL,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS trade_journal (
      trade_id CHAR(36) NOT NULL PRIMARY KEY,
      symbol VARCHAR(32) NOT NULL,
      direction ENUM('LONG', 'SHORT') NOT NULL,
      entry_price DECIMAL(20,8) NOT NULL,
      stop_loss DECIMAL(20,8) NOT NULL,
      take_profit DECIMAL(20,8) NOT NULL,
      exit_price DECIMAL(20,8) NOT NULL,
      position_size DECIMAL(20,8) NOT NULL,
      net_pnl DECIMAL(20,2) NOT NULL,
      r_multiple DECIMAL(12,4) NOT NULL DEFAULT 0,
      setup VARCHAR(100) NOT NULL,
      session_name VARCHAR(80) NOT NULL,
      emotion VARCHAR(80) NOT NULL,
      followed_plan BOOLEAN NOT NULL DEFAULT FALSE,
      checklist JSON NOT NULL,
      key_notes JSON NOT NULL,
      market_image LONGTEXT NULL,
      note TEXT NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX trade_journal_created_at (created_at)
    ) ENGINE=InnoDB
  `);

  const [journalColumns] = await pool.execute(
    `SELECT COLUMN_NAME FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'trade_journal'`,
    [databaseName]
  );
  const existingJournalColumns = new Set(journalColumns.map((column) => column.COLUMN_NAME));
  if (!existingJournalColumns.has('key_notes')) {
    await pool.query('ALTER TABLE trade_journal ADD COLUMN key_notes JSON NULL');
    await pool.query(`UPDATE trade_journal SET key_notes = JSON_ARRAY() WHERE key_notes IS NULL`);
    await pool.query('ALTER TABLE trade_journal MODIFY COLUMN key_notes JSON NOT NULL');
  }
  if (!existingJournalColumns.has('market_image')) {
    await pool.query('ALTER TABLE trade_journal ADD COLUMN market_image LONGTEXT NULL');
  }

  await pool.query(`
    CREATE TABLE IF NOT EXISTS account_balance (
      id TINYINT UNSIGNED NOT NULL PRIMARY KEY,
      balance DECIMAL(20,2) NOT NULL DEFAULT 0,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS account_transactions (
      transaction_id CHAR(36) NOT NULL PRIMARY KEY,
      transaction_type ENUM('deposit', 'withdrawal') NOT NULL,
      amount DECIMAL(20,2) NOT NULL,
      note VARCHAR(255) NOT NULL DEFAULT '',
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX account_transactions_created_at (created_at)
    ) ENGINE=InnoDB
  `);

  await pool.execute('INSERT IGNORE INTO account_balance (id, balance) VALUES (1, 0)');

  const [plans] = await pool.execute('SELECT id FROM trading_plans WHERE id = 1');
  if (plans.length === 0) {
    await pool.execute(
      `INSERT INTO trading_plans
        (id, strategy_name, markets, max_risk_per_trade_pct, max_daily_loss_pct,
         max_consecutive_losses, confluences, target_rr)
       VALUES (1, ?, ?, ?, ?, ?, ?, ?)`,
      [
        'Break & Retest Scalper',
        JSON.stringify(['EUR/USD', 'GBP/USD', 'XAU/USD']),
        1,
        2,
        2,
        JSON.stringify([
          'Higher timeframe trend alignment',
          'Key support/resistance level test',
          '5-minute confirmation candle'
        ]),
        '2:1'
      ]
    );
  }
}

export async function testDatabaseConnection() {
  const [result] = await pool.query('SELECT 1 AS connected');
  return result[0]?.connected === 1;
}
