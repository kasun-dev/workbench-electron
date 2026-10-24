import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Copy, Download, ImagePlus, Pencil, Plus, Repeat, SlidersHorizontal, Sparkles, Trash2 } from 'lucide-react';
import { api } from '../api.js';
import { useStore } from '../store.jsx';
import { Modal, Segmented, Topbar } from '../components/ui.jsx';
import { curMonth, money, monthLabel, shiftMonth, shortDate, tagStyle, todayStr } from '../lib.js';

const TYPES = [{ id: 'income', label: 'Income' }, { id: 'expense', label: 'Expense' }, { id: 'saving', label: 'Saving' }];
const FILTERS = [{ id: 'all', label: 'All' }, ...TYPES.map((t) => ({ ...t, label: t.id === 'income' ? 'Income' : t.id === 'expense' ? 'Expenses' : 'Savings' }))];
const SUGGEST = {
  income: ['Salary', 'Freelance', 'Business', 'Gift', 'Other'],
  expense: ['Rent', 'Food', 'Transport', 'Fuel', 'Bills', 'Health', 'Shopping', 'Entertainment', 'Other'],
  saving: ['Savings'],
};
const POTS = ['Emergency fund', 'General'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const SIGN = { income: '+', expense: '−', saving: '→' };

function BudgetModal({ budgets, categories, cur, onClose, onSave }) {
  const allCats = [...new Set([...SUGGEST.expense, ...categories])];
  const [draft, setDraft] = useState(() => ({ ...budgets }));
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try { await onSave(draft); onClose(); } finally { setBusy(false); }
  };

  return (
    <Modal small onClose={onClose}>
      <form onSubmit={submit} style={{ padding: 22, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <h3 style={{ fontSize: 16 }}>Monthly Category Budgets ({cur})</h3>
        <p className="meta">Set monthly caps per category. Bars turn amber at 80% and red above 100%.</p>
        <div className="grid2" style={{ maxHeight: 320, overflowY: 'auto', paddingRight: 4 }}>
          {allCats.map((c) => (
            <label key={c} className="fl">
              <span>{c}</span>
              <input className="field mono" type="number" min="0" step="100" placeholder="No cap"
                value={draft[c] || ''} onChange={(e) => setDraft({ ...draft, [c]: e.target.value })} />
            </label>
          ))}
        </div>
        <button className="btn primary block" disabled={busy} type="submit">Save budgets</button>
      </form>
    </Modal>
  );
}

function TxForm({ tx, month, categories, pots, onClose, onSaved }) {
  const [f, setF] = useState(() => (tx
    ? { type: tx.type || 'expense', amount: String(tx.amount || ''), date: tx.date || todayStr(), category: tx.category || '', note: tx.note || '', pot: tx.pot || '', recurring: !!tx.recurring }
    : { type: 'expense', amount: '', date: month === curMonth() ? todayStr() : `${month}-01`, category: '', note: '', pot: '', recurring: false }));
  const [err, setErr] = useState('');
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const cats = [...new Set([...SUGGEST[f.type], ...categories[f.type]])];

  const submit = async (e) => {
    e.preventDefault(); setErr('');
    try {
      if (tx?._id) await api.finance.update(tx._id, f); else await api.finance.create(f);
      onSaved(f.date.slice(0, 7));
    } catch (ex) { setErr(ex.message); }
  };

  return (
    <Modal small onClose={onClose}>
      <form onSubmit={submit} style={{ padding: 22, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <Segmented value={f.type} onChange={(type) => setF({ ...f, type, category: '' })} options={TYPES} />
        <div className="grid2">
          <label className="fl"><span>Amount</span>
            <input className="field mono" autoFocus type="number" step="0.01" min="0" placeholder="0.00" value={f.amount} onChange={set('amount')} /></label>
          <label className="fl"><span>Date</span><input className="field" type="date" value={f.date} onChange={set('date')} /></label>
        </div>
        <label className="fl"><span>{f.type === 'saving' ? 'Category (optional)' : 'Category'}</span>
          <input className="field" list="fin-cats" value={f.category} onChange={set('category')} placeholder={f.type === 'income' ? 'e.g. Salary' : f.type === 'expense' ? 'e.g. Rent' : 'e.g. Monthly saving'} />
          <datalist id="fin-cats">{cats.map((c) => <option key={c} value={c} />)}</datalist></label>
        {f.type === 'saving' && (
          <label className="fl"><span>Savings pot</span>
            <input className="field" list="fin-pots" value={f.pot} onChange={set('pot')} placeholder="e.g. Emergency fund, Bike, Laptop" />
            <datalist id="fin-pots">{[...new Set([...POTS, ...pots])].map((c) => <option key={c} value={c} />)}</datalist></label>
        )}
        <label className="fl"><span>Note</span><input className="field" value={f.note} onChange={set('note')} placeholder="Optional" /></label>
        <label className="check-row" style={{ padding: 0 }} onClick={(e) => { e.preventDefault(); setF({ ...f, recurring: !f.recurring }); }}>
          <span className={`box ${f.recurring ? 'on' : ''}`}>{f.recurring && '✓'}</span>
          <span>Repeats every month <span className="meta">(can be carried over to the next month in one click)</span></span>
        </label>
        {err && <div className="err">{err}</div>}
        <button className="btn primary block" type="submit">{tx?._id ? 'Save changes' : 'Add transaction'}</button>
      </form>
    </Modal>
  );
}

export default function Finance() {
  const { user, setUser, notify } = useStore();
  const cur = user.preferences.currency || 'LKR';
  const budgets = user.preferences.budgets || {};
  const [month, setMonth] = useState(curMonth());
  const [data, setData] = useState(null);
  const [year, setYear] = useState(null);
  const [filter, setFilter] = useState('all');
  const [form, setForm] = useState(null);
  const [budgetOpen, setBudgetOpen] = useState(false);
  const [delId, setDelId] = useState(null);
  const [nlText, setNlText] = useState('');
  const [nlBusy, setNlBusy] = useState(false);
  const [insights, setInsights] = useState(null);
  const [insBusy, setInsBusy] = useState(false);
  const slipRef = useRef(null);
  const m = (n) => money(n, cur);

  const load = useCallback(async () => {
    const [d, y] = await Promise.all([api.finance.month(month), api.finance.overview(Number(month.slice(0, 4)))]);
    setData(d); setYear(y); setInsights(null);
  }, [month]);
  useEffect(() => { load().catch((e) => notify(e.message)); }, [load]); // eslint-disable-line

  const rows = useMemo(() => (data ? data.transactions.filter((t) => filter === 'all' || t.type === filter) : []), [data, filter]);
  const categories = useMemo(() => {
    const out = { income: [], expense: [], saving: [] };
    (data?.transactions || []).forEach((t) => { if (t.category && !out[t.type].includes(t.category)) out[t.type].push(t.category); });
    return out;
  }, [data]);

  if (!data || !year) return <Topbar title="Finance" />;
  const t = data.totals;
  const maxExp = Math.max(0.01, ...data.expenseByCategory.map((c) => c.amount));
  const maxBar = Math.max(1, ...year.months.flatMap((x) => [x.income, x.expense, x.saving]));
  const savedRate = t.income > 0 ? Math.round((t.saving / t.income) * 100) : 0;

  const submitPlainEnglish = async (e) => {
    e.preventDefault();
    if (!nlText.trim()) return;
    setNlBusy(true);
    try {
      const parsed = await api.ai.parseFinance(nlText.trim());
      await api.finance.create(parsed);
      setNlText('');
      const targetMonth = parsed.date.slice(0, 7);
      notify(`Added ${parsed.type}: ${m(parsed.amount)} (${parsed.category})`);
      if (targetMonth !== month) setMonth(targetMonth); else load();
    } catch (ex) { notify(ex.message); } finally { setNlBusy(false); }
  };

  const scanSlipFile = (file) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onloadend = async () => {
      const base64 = String(reader.result || '').split(',')[1];
      if (!base64) return;
      setNlBusy(true);
      try {
        const parsed = await api.ai.scanReceipt({ imageBase64: base64, mimeType: file.type || 'image/png' });
        setForm(parsed); // Opens TxForm pre-filled so you can review and save in 1 click
        notify('Receipt scanned — review & click Add transaction');
      } catch (e) { notify(e.message); } finally { setNlBusy(false); }
    };
    reader.readAsDataURL(file);
  };

  const onPasteSlip = (e) => {
    const item = [...(e.clipboardData?.items || [])].find((x) => x.type.startsWith('image/'));
    if (item) { e.preventDefault(); scanSlipFile(item.getAsFile()); }
  };

  const loadInsights = async () => {
    setInsBusy(true);
    try { setInsights(await api.ai.financeInsights({ currency: cur, monthData: data, yearData: year })); }
    catch (ex) { notify(ex.message); } finally { setInsBusy(false); }
  };

  const saveBudgets = async (nextBudgets) => {
    const u = await api.user.updatePreferences({ budgets: nextBudgets });
    setUser(u);
    notify('Monthly budgets updated');
  };

  const remove = async (id) => {
    try { await api.finance.delete(id); setDelId(null); load(); } catch (e) { notify(e.message); }
  };
  const carry = async () => {
    try {
      const r = await api.finance.carryOver(shiftMonth(month, -1), month);
      notify(r.count ? `Carried over ${r.count} recurring item${r.count > 1 ? 's' : ''} from ${monthLabel(shiftMonth(month, -1))}` : 'Nothing new to carry over (mark items as "Repeats every month" first)');
      load();
    } catch (e) { notify(e.message); }
  };
  const exportCsv = async () => {
    try { const r = await api.data.exportFinance(month); if (r.saved) notify(`Exported ${r.count} transactions`); } catch (e) { notify(e.message); }
  };

  return (
    <>
      <Topbar title="Finance" meta={cur}>
        <div className="month-nav">
          <button className="icon-btn" onClick={() => setMonth(shiftMonth(month, -1))}><ChevronLeft size={15} /></button>
          <input className="field month" type="month" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} />
          <button className="icon-btn" onClick={() => setMonth(shiftMonth(month, 1))}><ChevronRight size={15} /></button>
          {month !== curMonth() && <button className="btn" onClick={() => setMonth(curMonth())}>This month</button>}
        </div>
        <button className="ai-btn" disabled={insBusy} onClick={loadInsights}><Sparkles size={13} />{insBusy ? 'Analyzing…' : 'AI Insights'}</button>
        <button className="btn" onClick={() => setBudgetOpen(true)}><SlidersHorizontal size={14} />Budgets</button>
        <button className="btn" onClick={carry} title={`Copy recurring items from ${monthLabel(shiftMonth(month, -1))}`}><Copy size={14} />Carry over</button>
        <button className="icon-btn" onClick={exportCsv} title="Export month as CSV"><Download size={15} /></button>
        <button className="btn primary" onClick={() => setForm({})}><Plus size={14} />Add</button>
      </Topbar>

      <div className="view" onPaste={onPasteSlip}><div className="page">
        <form className="ai-bar" onSubmit={submitPlainEnglish}>
          <Sparkles size={15} style={{ color: 'var(--purple)' }} />
          <input placeholder='Plain-English or Ctrl+V receipt image: e.g. "Spent 4500 on fuel yesterday"'
            value={nlText} onChange={(e) => setNlText(e.target.value)} disabled={nlBusy} />
          <input ref={slipRef} type="file" accept="image/*" hidden onChange={(e) => scanSlipFile(e.target.files?.[0])} />
          <button className="ai-btn" type="button" disabled={nlBusy} onClick={() => slipRef.current?.click()} title="Upload receipt or bank slip image">
            <ImagePlus size={13} />Scan Slip
          </button>
          <button className="ai-btn" type="submit" disabled={nlBusy || !nlText.trim()}>{nlBusy ? 'Working…' : 'Add with AI'}</button>
        </form>

        {insights && (
          <div className="ai-box">
            <h4><Sparkles size={14} /> Monthly AI Finance Insights — Projected End Balance: {m(insights.forecastEndBalance)}</h4>
            <div style={{ fontSize: 12.5 }}>{insights.summary} <span className="meta">({insights.forecastNote})</span></div>
            <div className="ai-grid">
              <div className="ai-sec">
                <b>Unusual Spending &amp; Callouts</b>
                {insights.anomalies?.length ? insights.anomalies.map((a, i) => <div key={i}>• {a}</div>) : 'No unusual spikes detected.'}
              </div>
              <div className="ai-sec">
                <b>Recurring Charges Detected</b>
                {insights.recurringDetected?.length ? insights.recurringDetected.map((r, i) => <div key={i}>• {r}</div>) : 'No unflagged recurring charges detected.'}
              </div>
            </div>
          </div>
        )}

        <h2 className="fin-month">{monthLabel(month)}</h2>

        <div className="stats">
          <div className="stat"><div className="k">INCOME</div><div className="v pos">{m(t.income)}</div></div>
          <div className="stat"><div className="k">EXPENSES</div><div className="v neg">{m(t.expense)}</div></div>
          <div className="stat"><div className="k">SAVINGS</div><div className="v sav">{m(t.saving)}</div>
            <div className="meta" style={{ marginTop: 6 }}>{savedRate}% of income · {m(data.savingsAllTime)} saved all time</div></div>
          <div className="stat"><div className="k">LEFT OVER</div><div className={`v ${t.balance < 0 ? 'neg' : ''}`}>{m(t.balance)}</div>
            <div className="meta" style={{ marginTop: 6 }}>income − expenses − savings</div></div>
        </div>

        <div className="charts">
          <div className="panel">
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
              <h3>Transactions</h3>
              <div style={{ marginLeft: 'auto' }}><Segmented value={filter} onChange={setFilter} options={FILTERS} /></div>
            </div>
            {rows.length === 0 && (
              <div className="empty-page" style={{ padding: '30px 0' }}>
                {data.transactions.length === 0 ? `No transactions in ${monthLabel(month)} yet.` : 'Nothing matches this filter.'}
                <div style={{ marginTop: 12 }}><button className="btn primary" onClick={() => setForm({})}><Plus size={14} />Add the first one</button></div>
              </div>
            )}
            <div className="tx-list">
              {rows.map((x) => (
                <div className="tx" key={x._id}>
                  <span className="tx-date mono">{shortDate(x.date)}</span>
                  <span className={`tx-ico ${x.type}`}>{SIGN[x.type]}</span>
                  <div className="tx-main">
                    <div className="tx-top">
                      {x.category ? <span className="tag" style={tagStyle(x.category)}>{x.category}</span> : <span className="meta">{x.type}</span>}
                      {x.pot && <span className="meta">→ {x.pot}</span>}
                      {x.recurring && <Repeat size={11} className="rep" title="Repeats monthly" />}
                    </div>
                    {x.note && <div className="tx-note">{x.note}</div>}
                  </div>
                  <span className={`tx-amt mono ${x.type}`}>{x.type === 'income' ? '+' : x.type === 'expense' ? '−' : ''}{m(x.amount)}</span>
                  {delId === x._id ? (
                    <span className="tx-acts"><button className="btn danger" style={{ height: 24, padding: '0 8px' }} onClick={() => remove(x._id)}>Delete</button>
                      <button className="tb sm" onClick={() => setDelId(null)}>×</button></span>
                  ) : (
                    <span className="tx-acts">
                      <button className="tb sm" title="Edit" onClick={() => setForm(x)}><Pencil size={12} /></button>
                      <button className="tb sm" title="Delete" onClick={() => setDelId(x._id)}><Trash2 size={12} /></button>
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div className="panel">
              <h3>Where it went</h3><div className="sub-t">Expenses by category &amp; budget burn</div>
              <div style={{ marginTop: 14 }}>
                {data.expenseByCategory.length === 0 && <div className="empty">No expenses yet</div>}
                {data.expenseByCategory.map((c) => {
                  const cap = Number(budgets[c.name]) || 0;
                  const ratio = cap > 0 ? (c.amount / cap) * 100 : (c.amount / maxExp) * 100;
                  const barColor = cap > 0 ? (ratio > 100 ? 'var(--red)' : ratio >= 80 ? 'var(--amber)' : 'var(--accent)') : 'var(--red)';
                  return (
                    <div className="cat-row" key={c.name}>
                      <div className="cat-top">
                        <span>{c.name}</span>
                        <span className="mono">
                          {m(c.amount)}{cap > 0 ? ` / ${m(cap)}` : ''}
                          <em>{cap > 0 ? `${Math.round(ratio)}%` : `${t.expense ? Math.round((c.amount / t.expense) * 100) : 0}%`}</em>
                        </span>
                      </div>
                      <div className="hbar"><i style={{ width: `${Math.min(100, ratio)}%`, background: barColor }} /></div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="panel">
              <h3>Income sources</h3>
              <div style={{ marginTop: 12 }}>
                {data.incomeByCategory.length === 0 && <div className="empty">No income yet</div>}
                {data.incomeByCategory.map((c) => <div className="lg2" key={c.name}><span>{c.name}</span><span className="mono pos">{m(c.amount)}</span></div>)}
              </div>
            </div>

            <div className="panel">
              <h3>Savings pots</h3><div className="sub-t">All time</div>
              <div style={{ marginTop: 12 }}>
                {data.pots.length === 0 && <div className="empty">Add a "Saving" transaction to start a pot</div>}
                {data.pots.map((p) => <div className="lg2" key={p.name}><span>{p.name}</span><span className="mono sav">{m(p.amount)}</span></div>)}
                {data.pots.length > 0 && <div className="lg2 total"><span>Total saved</span><span className="mono sav">{m(data.savingsAllTime)}</span></div>}
              </div>
            </div>
          </div>
        </div>

        <div className="panel">
          <div style={{ display: 'flex', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
            <div><h3>{year.year} overview</h3><div className="sub-t">Click a month to open it</div></div>
            <div className="legend">
              <span><i style={{ background: 'var(--accent)' }} />Income</span>
              <span><i style={{ background: 'var(--red)' }} />Expenses</span>
              <span><i style={{ background: 'var(--blue)' }} />Savings</span>
            </div>
          </div>
          <div className="fchart">
            {year.months.map((x, i) => (
              <button key={x.month} className={`fcol ${x.month === month ? 'sel' : ''}`} onClick={() => setMonth(x.month)}
                title={`${MON[i]}: income ${m(x.income)}, expenses ${m(x.expense)}, saved ${m(x.saving)}`}>
                <div className="fbars">
                  <i style={{ height: `${(x.income / maxBar) * 100}%`, background: 'var(--accent)' }} />
                  <i style={{ height: `${(x.expense / maxBar) * 100}%`, background: 'var(--red)' }} />
                  <i style={{ height: `${(x.saving / maxBar) * 100}%`, background: 'var(--blue)' }} />
                </div>
                <span>{MON[i]}</span>
              </button>
            ))}
          </div>
          <div className="year-tot">
            <span>Income <b className="pos mono">{m(year.totals.income)}</b></span>
            <span>Expenses <b className="neg mono">{m(year.totals.expense)}</b></span>
            <span>Saved <b className="sav mono">{m(year.totals.saving)}</b></span>
            <span>Left over <b className={`mono ${year.totals.balance < 0 ? 'neg' : ''}`}>{m(year.totals.balance)}</b></span>
          </div>
        </div>
      </div></div>

      {budgetOpen && (
        <BudgetModal budgets={budgets} categories={categories.expense} cur={cur}
          onClose={() => setBudgetOpen(false)} onSave={saveBudgets} />
      )}

      {form && (
        <TxForm tx={form} month={month} categories={categories} pots={data.pots.map((p) => p.name)}
          onClose={() => setForm(null)}
          onSaved={(saved) => { setForm(null); if (saved !== month) setMonth(saved); else load(); }} />
      )}
    </>
  );
}
