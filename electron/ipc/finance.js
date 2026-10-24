const { Transaction, TX_TYPES } = require('../models');
const { handle, AppError, str, oneOf, oid, int, dateStr } = require('./helpers');

const cents = (n) => Math.round(n * 100);
const monthStr = (m) => {
  if (typeof m !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(m)) throw new AppError('Invalid month');
  return m;
};

function pick(p, partial = false) {
  const o = {};
  if (!partial || p.type !== undefined) o.type = oneOf(p.type, TX_TYPES);
  if (!partial || p.amount !== undefined) {
    const a = Number(p.amount);
    if (!Number.isFinite(a) || a <= 0 || a > 1e12) throw new AppError('Amount must be greater than 0');
    o.amount = Math.round(a * 100) / 100;
  }
  if (!partial || p.date !== undefined) { o.date = dateStr(p.date); o.month = o.date.slice(0, 7); }
  if (p.category !== undefined) o.category = str(p.category, { max: 60 });
  if (p.note !== undefined) o.note = str(p.note, { max: 200 });
  if (p.pot !== undefined) o.pot = str(p.pot, { max: 60 });
  if (p.recurring !== undefined) o.recurring = !!p.recurring;
  return o;
}

// money math in integer cents so totals never drift
function totals(list) {
  const t = { income: 0, expense: 0, saving: 0 };
  for (const x of list) t[x.type] += cents(x.amount);
  return { income: t.income / 100, expense: t.expense / 100, saving: t.saving / 100, balance: (t.income - t.expense - t.saving) / 100 };
}
const group = (list, key) => {
  const m = new Map();
  for (const x of list) { const k = key(x); m.set(k, (m.get(k) || 0) + cents(x.amount)); }
  return [...m].sort((a, b) => b[1] - a[1]).map(([name, c]) => ({ name, amount: c / 100 }));
};

function registerFinanceHandlers() {
  handle('finance:month', async ({ userId, payload }) => {
    const month = monthStr(payload.month);
    const txs = await Transaction.find({ user: userId, month }).sort({ date: -1, createdAt: -1 }).lean();
    const saved = await Transaction.find({ user: userId, type: 'saving' }).select('amount pot').lean();
    return {
      month,
      transactions: txs,
      totals: totals(txs),
      expenseByCategory: group(txs.filter((x) => x.type === 'expense'), (x) => x.category || 'Uncategorised'),
      incomeByCategory: group(txs.filter((x) => x.type === 'income'), (x) => x.category || 'Uncategorised'),
      savingsAllTime: saved.reduce((a, x) => a + cents(x.amount), 0) / 100,
      pots: group(saved, (x) => x.pot || 'General'),
    };
  });

  handle('finance:overview', async ({ userId, payload }) => {
    const year = int(payload.year || new Date().getFullYear(), 2000, 2100);
    const txs = await Transaction.find({ user: userId, month: { $gte: `${year}-01`, $lte: `${year}-12` } }).select('type amount month').lean();
    const months = Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, '0')}`)
      .map((m) => ({ month: m, ...totals(txs.filter((x) => x.month === m)) }));
    return { year, months, totals: totals(txs) };
  });

  handle('finance:create', async ({ userId, payload }) => (await Transaction.create({ ...pick(payload), user: userId })).toObject());

  handle('finance:update', async ({ userId, payload }) => {
    const tx = await Transaction.findOne({ _id: oid(payload.id), user: userId });
    if (!tx) throw new AppError('Transaction not found', 'NOT_FOUND');
    Object.assign(tx, pick(payload.changes || {}, true));
    await tx.save();
    return tx.toObject();
  });

  handle('finance:delete', async ({ userId, payload }) => {
    const r = await Transaction.deleteOne({ _id: oid(payload.id), user: userId });
    if (!r.deletedCount) throw new AppError('Transaction not found', 'NOT_FOUND');
    return { id: String(payload.id) };
  });

  // Copy every "repeats monthly" item from one month into another (skips ones already there)
  handle('finance:carryOver', async ({ userId, payload }) => {
    const from = monthStr(payload.from), to = monthStr(payload.to);
    const src = await Transaction.find({ user: userId, month: from, recurring: true }).lean();
    const have = new Set((await Transaction.find({ user: userId, month: to, recurring: true }).lean()).map(keyOf));
    const [y, m] = to.split('-').map(Number);
    const dim = new Date(y, m, 0).getDate();
    const docs = src.filter((x) => !have.has(keyOf(x))).map((x) => ({
      user: userId, type: x.type, amount: x.amount, category: x.category, note: x.note, pot: x.pot, recurring: true,
      month: to, date: `${to}-${String(Math.min(Number(x.date.slice(8)), dim)).padStart(2, '0')}`,
    }));
    if (docs.length) await Transaction.insertMany(docs);
    return { count: docs.length };
  });
}
const keyOf = (x) => [x.type, x.category, x.amount, x.note, x.pot].join('|');

module.exports = { registerFinanceHandlers };
