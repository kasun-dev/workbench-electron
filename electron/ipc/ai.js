const { Task, TimeLog, LongTermGoal, Transaction, User } = require('../models');
const localSettings = require('../localSettings');
const { handle, AppError, str, oid } = require('./helpers');
const { createTask } = require('./tasks');
const { startTimerFor, stopRunning } = require('./timer');
const { broadcast } = require('../events');

const API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const stripHtml = (s = '') => String(s).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

function getKeyAndModel() {
  const key = localSettings.getApiKey();
  if (!key) throw new AppError('Add your Gemini API key in Settings → Gemini AI first.', 'NO_API_KEY');
  const model = localSettings.get().geminiModel || 'gemini-3.5-flash-lite';
  return { key, model };
}

async function callGemini({ contents, systemInstruction, responseSchema, tools, temperature = 0.2 }) {
  const { key, model } = getKeyAndModel();
  const body = {
    contents: Array.isArray(contents) ? contents : [{ role: 'user', parts: [{ text: String(contents) }] }],
    generationConfig: { temperature },
  };
  if (systemInstruction) body.systemInstruction = { parts: [{ text: systemInstruction }] };
  if (responseSchema) {
    body.generationConfig.responseMimeType = 'application/json';
    body.generationConfig.responseSchema = responseSchema;
  }
  if (tools) body.tools = tools;

  const res = await fetch(`${API_BASE}/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new AppError(data?.error?.message || `Gemini API error (${res.status})`, 'AI_ERROR');
  return data;
}

async function generateJson(prompt, responseSchema, systemInstruction = '') {
  const data = await callGemini({ contents: prompt, responseSchema, systemInstruction });
  const text = data?.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('') || '{}';
  try { return JSON.parse(text); } catch { throw new AppError('AI returned malformed JSON', 'AI_ERROR'); }
}

async function embedTexts(texts) {
  const { key } = getKeyAndModel();
  const requests = texts.map((t) => ({
    model: 'models/gemini-embedding-001',
    content: { parts: [{ text: String(t || '').slice(0, 2000) }] },
  }));
  const res = await fetch(`${API_BASE}/gemini-embedding-001:batchEmbedContents?key=${encodeURIComponent(key)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ requests }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new AppError(data?.error?.message || 'Embedding request failed', 'AI_ERROR');
  return (data.embeddings || []).map((e) => e.values || []);
}

function cosine(a = [], b = []) {
  let dot = 0, na = 0, nb = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return na && nb ? dot / (Math.sqrt(na) * Math.sqrt(nb)) : 0;
}

async function getUserCategoryContext(userId) {
  const [tasks, goals] = await Promise.all([
    Task.find({ user: userId }).select('title category discipline estimateMinutes totalTrackedSeconds status').lean(),
    LongTermGoal.find({ user: userId }).select('title category discipline').lean(),
  ]);
  const categories = [...new Set([...tasks, ...goals].map((x) => x.category).filter(Boolean))];
  const disciplines = [...new Set([...tasks, ...goals].map((x) => x.discipline).filter(Boolean))];
  const pairs = [];
  const seen = new Set();
  for (const t of [...tasks, ...goals]) {
    if (t.category && !seen.has(t.category)) {
      seen.add(t.category);
      pairs.push({ category: t.category, discipline: t.discipline || '', sampleTitle: t.title });
    }
  }
  return { tasks, categories, disciplines, pairs };
}

async function summarizeTimeLogsForUser(userId, logs, taskMap) {
  if (!logs.length) return [];
  const items = logs.slice(0, 60).map((l, idx) => {
    const t = taskMap.get(String(l.task)) || {};
    const hrs = Math.round((l.durationSeconds / 3600) * 100) / 100;
    const subs = (t.subtasks || []).filter((s) => s.done).map((s) => s.title).join('; ');
    return {
      index: idx,
      key: t.key || '',
      title: t.title || 'Task',
      category: t.category || '',
      discipline: t.discipline || '',
      sessionNote: l.note || '',
      completedSubtasks: subs,
      hours: hrs,
      date: ymd(new Date(l.startTime)),
    };
  });
  const schema = {
    type: 'OBJECT',
    properties: {
      summaries: {
        type: 'ARRAY',
        items: {
          type: 'OBJECT',
          properties: {
            index: { type: 'INTEGER' },
            line: { type: 'STRING' },
          },
          required: ['index', 'line'],
        },
      },
    },
    required: ['summaries'],
  };
  const res = await generateJson(
    `Rewrite each raw time-tracking session into a concise, professional client-friendly timesheet line (e.g., "Refactored auth middleware and verified session handling, 2.5h"). Prefer using sessionNote and completedSubtasks when present. Keep each line under 110 characters.\n\nSessions:\n${JSON.stringify(items)}`,
    schema
  );
  const byIdx = new Map((res.summaries || []).map((s) => [s.index, s.line]));
  return logs.map((l, i) => {
    const t = taskMap.get(String(l.task)) || {};
    const h = (l.durationSeconds / 3600).toFixed(2);
    return byIdx.get(i) || `${l.note || t.title || 'Focused work'} (${h}h)`;
  });
}

function registerAiHandlers() {
  handle('ai:test', async () => {
    const res = await generateJson('Reply with {"status":"ok"}', {
      type: 'OBJECT', properties: { status: { type: 'STRING' } }, required: ['status'],
    });
    return { ok: res.status === 'ok', model: localSettings.get().geminiModel };
  });

  // 1. Natural-language Quick Capture
  handle('ai:parseCapture', async ({ userId, payload }) => {
    const text = str(payload.text, { max: 500, required: true });
    const today = ymd(new Date());
    const weekday = new Date().toLocaleDateString('en-US', { weekday: 'long' });
    const { categories, disciplines, pairs } = await getUserCategoryContext(userId);
    const schema = {
      type: 'OBJECT',
      properties: {
        mode: { type: 'STRING', enum: ['task', 'goal'] },
        title: { type: 'STRING' },
        category: { type: 'STRING' },
        discipline: { type: 'STRING' },
        priority: { type: 'STRING', enum: ['high', 'medium', 'low'] },
        dueDate: { type: 'STRING', nullable: true },
        estimateMinutes: { type: 'INTEGER' },
      },
      required: ['mode', 'title', 'category', 'discipline', 'priority', 'estimateMinutes'],
    };
    return generateJson(
      `Today is ${weekday}, ${today}.
Parse this natural-language capture input into a structured task or goal: "${text}"
Rules:
- Clean the title so metadata (like "Friday", "2h", "high", category name) is removed from the title.
- MUST reuse an existing category from this list if it matches or is close: ${JSON.stringify(categories)}.
- Existing category-to-discipline mappings: ${JSON.stringify(pairs)}. Existing disciplines: ${JSON.stringify(disciplines)}.
- Convert relative dates ("Friday", "tomorrow", "next week") into YYYY-MM-DD based on ${today} (${weekday}). Use null if no date is mentioned.
- Convert duration ("2h", "45m") into integer minutes, or 0 if not mentioned.`,
      schema
    );
  });

  // 2. Auto-categorize
  handle('ai:categorize', async ({ userId, payload }) => {
    const title = str(payload.title, { max: 300, required: true });
    const { categories, disciplines, pairs } = await getUserCategoryContext(userId);
    const schema = {
      type: 'OBJECT',
      properties: { category: { type: 'STRING' }, discipline: { type: 'STRING' } },
      required: ['category', 'discipline'],
    };
    return generateJson(
      `Given the task title "${title}", pick the best matching category and discipline from the user's history.
Existing categories (strictly prefer these): ${JSON.stringify(categories)}
Existing disciplines (strictly prefer these): ${JSON.stringify(disciplines)}
Past mappings: ${JSON.stringify(pairs)}`,
      schema
    );
  });

  // 3. Breakdown
  handle('ai:breakdown', async ({ payload }) => {
    const title = str(payload.title, { max: 300, required: true });
    const desc = stripHtml(payload.description || '');
    const kind = payload.kind === 'goal' ? 'milestones' : 'sub-tasks';
    const existing = Array.isArray(payload.existing) ? payload.existing : [];
    const schema = {
      type: 'OBJECT',
      properties: { items: { type: 'ARRAY', items: { type: 'STRING' } } },
      required: ['items'],
    };
    return generateJson(
      `Break down this ${payload.kind === 'goal' ? 'long-term goal' : 'task'} into 4 to 6 concrete, actionable ${kind} (each under 120 chars).
Title: "${title}"
Description: "${desc}"
Already existing items (do not duplicate): ${JSON.stringify(existing)}`,
      schema
    );
  });

  // 4. Smarter Estimates
  handle('ai:estimate', async ({ userId, payload }) => {
    const title = str(payload.title, { max: 300, required: true });
    const category = str(payload.category || '', { max: 60 });
    const history = await Task.find({ user: userId, totalTrackedSeconds: { $gt: 60 } })
      .sort('-updatedAt').limit(60)
      .select('key title category discipline estimateMinutes totalTrackedSeconds status').lean();
    if (!history.length) {
      return { estimateMinutes: 60, message: 'No tracked task history yet — defaulting to 1h estimate.', matchedCount: 0 };
    }
    const compact = history.map((h) => ({
      key: h.key, title: h.title, category: h.category,
      actualMinutes: Math.max(1, Math.round(h.totalTrackedSeconds / 60)),
    }));
    const schema = {
      type: 'OBJECT',
      properties: {
        estimateMinutes: { type: 'INTEGER' },
        matchedCount: { type: 'INTEGER' },
        message: { type: 'STRING' },
      },
      required: ['estimateMinutes', 'matchedCount', 'message'],
    };
    return generateJson(
      `Compare the new task "${title}" (Category: "${category}") against the user's actual tracked task history below.
Find the most similar past tasks, calculate their average actual duration, and suggest an estimate in minutes (rounded to nearest 5).
Format the message like: "Similar tasks took you about 1h 40m on average (matched 3 tasks)."
User History:\n${JSON.stringify(compact)}`,
      schema
    );
  });

  // 5. Voice Capture
  handle('ai:voiceCapture', async ({ userId, payload }) => {
    const audioBase64 = str(payload.audioBase64, { max: 15 * 1024 * 1024, required: true });
    const mimeType = str(payload.mimeType || 'audio/webm', { max: 100 });
    const today = ymd(new Date());
    const weekday = new Date().toLocaleDateString('en-US', { weekday: 'long' });
    const { categories, disciplines, pairs } = await getUserCategoryContext(userId);
    const schema = {
      type: 'OBJECT',
      properties: {
        transcript: { type: 'STRING' },
        tasks: {
          type: 'ARRAY',
          items: {
            type: 'OBJECT',
            properties: {
              title: { type: 'STRING' },
              category: { type: 'STRING' },
              discipline: { type: 'STRING' },
              priority: { type: 'STRING', enum: ['high', 'medium', 'low'] },
              dueDate: { type: 'STRING', nullable: true },
              estimateMinutes: { type: 'INTEGER' },
            },
            required: ['title', 'category', 'discipline', 'priority', 'estimateMinutes'],
          },
        },
      },
      required: ['transcript', 'tasks'],
    };
    const data = await callGemini({
      contents: [{
        role: 'user',
        parts: [
          { inlineData: { mimeType, data: audioBase64 } },
          {
            text: `Today is ${weekday}, ${today}. Listen to the user's voice note and extract 1 or more tasks.
Reuse existing categories when possible: ${JSON.stringify(categories)}.
Existing category/discipline mappings: ${JSON.stringify(pairs)} (Disciplines: ${JSON.stringify(disciplines)}).
Resolve relative dates to YYYY-MM-DD or null.`,
          },
        ],
      }],
      responseSchema: schema,
    });
    const text = data?.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('') || '{}';
    try { return JSON.parse(text); } catch { throw new AppError('Could not parse voice capture response', 'AI_ERROR'); }
  });

  // 6. Plan My Day
  handle('ai:planDay', async ({ userId, payload }) => {
    const today = ymd(new Date());
    const capacityHours = Number(payload.capacityHours || 8);
    const open = await Task.find({ user: userId, status: { $ne: 'completed' } })
      .select('_id key title status priority category dueDate estimateMinutes totalTrackedSeconds blockedReason').lean();
    const candidates = open.filter((t) =>
      t.status === 'in_progress' || t.status === 'up_next' || (t.dueDate && t.dueDate <= today)
    ).slice(0, 30).map((t) => ({
      id: String(t._id), key: t.key, title: t.title, status: t.status,
      priority: t.priority, category: t.category, dueDate: t.dueDate,
      remainingMinutes: Math.max(15, (t.estimateMinutes || 45) - Math.round((t.totalTrackedSeconds || 0) / 60)),
    }));
    const schema = {
      type: 'OBJECT',
      properties: {
        overPlanned: { type: 'BOOLEAN' },
        totalPlannedHours: { type: 'NUMBER' },
        summary: { type: 'STRING' },
        orderedTasks: {
          type: 'ARRAY',
          items: {
            type: 'OBJECT',
            properties: {
              id: { type: 'STRING' }, key: { type: 'STRING' }, title: { type: 'STRING' },
              suggestedMinutes: { type: 'INTEGER' },
              action: { type: 'STRING', enum: ['do_today', 'defer'] },
              reason: { type: 'STRING' },
            },
            required: ['id', 'key', 'title', 'suggestedMinutes', 'action', 'reason'],
          },
        },
      },
      required: ['overPlanned', 'totalPlannedHours', 'summary', 'orderedTasks'],
    };
    return generateJson(
      `Today is ${today}. The user's available capacity today is ${capacityHours} hours (${Math.round(capacityHours * 60)} minutes).
Order these tasks into a realistic daily plan. Prioritize overdue and high-priority items first.
If total time exceeds ${capacityHours}h, mark lower-priority items as "defer" and set overPlanned=true.
Tasks:\n${JSON.stringify(candidates)}`,
      schema
    );
  });

  // 7. Weekly Review Narrative
  handle('ai:weeklyNarrative', async ({ payload }) => {
    const schema = {
      type: 'OBJECT',
      properties: {
        headline: { type: 'STRING' },
        shippedRecap: { type: 'STRING' },
        accuracyAnalysis: { type: 'STRING' },
        nextWeekFocus: { type: 'STRING' },
      },
      required: ['headline', 'shippedRecap', 'accuracyAnalysis', 'nextWeekFocus'],
    };
    return generateJson(
      `Write a concise, insightful Weekly Review narrative for the user based on their last 7 days of Workbench metrics:
${JSON.stringify(payload.reviewData)}
Keep each section 1-2 sentences, concrete, referencing actual task titles/categories and numbers.`,
      schema
    );
  });

  // 8. Goal Coaching
  handle('ai:coachGoal', async ({ userId, payload }) => {
    const g = await LongTermGoal.findOne({ _id: oid(payload.goalId), user: userId }).lean();
    if (!g) throw new AppError('Goal not found', 'NOT_FOUND');
    const ageDays = Math.round((Date.now() - new Date(g.createdAt).getTime()) / 864e5);
    const schema = {
      type: 'OBJECT',
      properties: {
        recommendation: { type: 'STRING', enum: ['promote', 'split', 'drop'] },
        rationale: { type: 'STRING' },
        firstTask: {
          type: 'OBJECT',
          properties: {
            title: { type: 'STRING' },
            estimateMinutes: { type: 'INTEGER' },
            priority: { type: 'STRING', enum: ['high', 'medium', 'low'] },
            subtasks: { type: 'ARRAY', items: { type: 'STRING' } },
          },
          required: ['title', 'estimateMinutes', 'priority', 'subtasks'],
        },
        splitGoals: { type: 'ARRAY', items: { type: 'STRING' } },
      },
      required: ['recommendation', 'rationale', 'firstTask', 'splitGoals'],
    };
    return generateJson(
      `Coach the user on this Long-Term Goal:
Title: "${g.title}"
Description: "${stripHtml(g.description)}"
Category: "${g.category || 'Uncategorised'}"
Status: "${g.status}", Age: ${ageDays} days, Promoted tasks so far: ${(g.promotedTasks || []).length}, Milestones: ${JSON.stringify(g.milestones || [])}
1. Decide whether they should "promote", "split", or "drop".
2. Provide the exact first concrete task they can promote to the board right now (under 2 hours estimate).`,
      schema
    );
  });

  // 9. Unblock Suggestions
  handle('ai:unblock', async ({ userId, payload }) => {
    const t = await Task.findOne({ _id: oid(payload.taskId), user: userId }).lean();
    if (!t) throw new AppError('Task not found', 'NOT_FOUND');
    const schema = {
      type: 'OBJECT',
      properties: {
        advice: { type: 'STRING' },
        steps: { type: 'ARRAY', items: { type: 'STRING' } },
      },
      required: ['advice', 'steps'],
    };
    return generateJson(
      `This task is currently BLOCKED.
Task: "${t.title}" (${t.category || 'General'})
Description: "${stripHtml(t.description)}"
Blocked Reason: "${t.blockedReason || 'Not specified'}"
Existing subtasks: ${JSON.stringify((t.subtasks || []).map((s) => s.title))}
Suggest a short 1-sentence unblocking strategy and 3 concrete next steps (each under 100 chars) to get it moving again.`,
      schema
    );
  });

  // 10. Plain-English Finance Entry
  handle('ai:parseFinance', async ({ userId, payload }) => {
    const text = str(payload.text, { max: 400, required: true });
    const today = ymd(new Date());
    const weekday = new Date().toLocaleDateString('en-US', { weekday: 'long' });
    const recent = await Transaction.find({ user: userId }).sort('-date').limit(80).select('type category pot').lean();
    const cats = [...new Set(['Salary', 'Freelance', 'Business', 'Rent', 'Food', 'Transport', 'Fuel', 'Bills', 'Health', 'Shopping', 'Entertainment', 'Savings', ...recent.map((r) => r.category).filter(Boolean)])];
    const pots = [...new Set(['Emergency fund', 'General', ...recent.map((r) => r.pot).filter(Boolean)])];
    const schema = {
      type: 'OBJECT',
      properties: {
        type: { type: 'STRING', enum: ['income', 'expense', 'saving'] },
        amount: { type: 'NUMBER' },
        date: { type: 'STRING' },
        category: { type: 'STRING' },
        pot: { type: 'STRING' },
        note: { type: 'STRING' },
        recurring: { type: 'BOOLEAN' },
      },
      required: ['type', 'amount', 'date', 'category', 'pot', 'note', 'recurring'],
    };
    return generateJson(
      `Today is ${weekday}, ${today}. Parse this plain-English finance entry into a transaction:
"${text}"
Available categories (prefer matching these): ${JSON.stringify(cats)}
Available savings pots (only if type === "saving", otherwise ""): ${JSON.stringify(pots)}
Resolve relative dates ("yesterday", "last Friday") to YYYY-MM-DD.`,
      schema
    );
  });

  // 11. Monthly Finance Insights
  handle('ai:financeInsights', async ({ payload }) => {
    const schema = {
      type: 'OBJECT',
      properties: {
        summary: { type: 'STRING' },
        anomalies: { type: 'ARRAY', items: { type: 'STRING' } },
        recurringDetected: { type: 'ARRAY', items: { type: 'STRING' } },
        forecastEndBalance: { type: 'NUMBER' },
        forecastNote: { type: 'STRING' },
      },
      required: ['summary', 'anomalies', 'recurringDetected', 'forecastEndBalance', 'forecastNote'],
    };
    return generateJson(
      `Analyze the user's monthly finance data and yearly overview (Currency: ${payload.currency || 'LKR'}, Today: ${ymd(new Date())}).
Call out unusual spending, savings rate health, potential unflagged recurring charges, and projected end-of-month balance.
Month Data: ${JSON.stringify(payload.monthData)}
Year Overview: ${JSON.stringify(payload.yearData)}`,
      schema
    );
  });

  // 12 & Pack 3. Ask Your Data + Agentic Action Mode (Read + Write Tools)
  async function runPaletteAi(userId, question, allowWrite = false) {
    const today = ymd(new Date());
    const user = await User.findById(userId).select('preferences.currency').lean();
    const cur = user?.preferences?.currency || 'LKR';
    const { categories, disciplines } = await getUserCategoryContext(userId);
    const actionsTaken = [];
    let mutated = false;

    const declarations = [
      {
        name: 'queryTimeTracked',
        description: 'Get total hours tracked and matching tasks filtered by category, discipline, keyword, or date range (YYYY-MM-DD).',
        parameters: {
          type: 'OBJECT',
          properties: {
            category: { type: 'STRING' },
            discipline: { type: 'STRING' },
            keyword: { type: 'STRING' },
            dateFrom: { type: 'STRING' },
            dateTo: { type: 'STRING' },
          },
        },
      },
      {
        name: 'queryTasks',
        description: 'Get tasks count and list filtered by status (backlog, up_next, in_progress, blocked, completed), category, or priority.',
        parameters: {
          type: 'OBJECT',
          properties: {
            status: { type: 'STRING' },
            category: { type: 'STRING' },
            priority: { type: 'STRING' },
          },
        },
      },
      {
        name: 'queryFinance',
        description: 'Query transactions and totals for a specific month (YYYY-MM) or date range, optionally filtered by type (income, expense, saving) or category.',
        parameters: {
          type: 'OBJECT',
          properties: {
            month: { type: 'STRING' },
            dateFrom: { type: 'STRING' },
            dateTo: { type: 'STRING' },
            type: { type: 'STRING' },
            category: { type: 'STRING' },
          },
        },
      },
    ];

    if (allowWrite) {
      declarations.push(
        {
          name: 'createNewTask',
          description: 'Create a new task on the Kanban board with optional subtasks, dueDate (YYYY-MM-DD), priority, category, and estimateMinutes.',
          parameters: {
            type: 'OBJECT',
            properties: {
              title: { type: 'STRING' },
              category: { type: 'STRING' },
              discipline: { type: 'STRING' },
              priority: { type: 'STRING' },
              status: { type: 'STRING' },
              dueDate: { type: 'STRING' },
              estimateMinutes: { type: 'INTEGER' },
              subtasks: { type: 'ARRAY', items: { type: 'STRING' } },
            },
            required: ['title'],
          },
        },
        {
          name: 'bulkUpdateTasks',
          description: 'Move or update tasks matching a filter (e.g. overdue tasks, or tasks in a status/category) to a new status, dueDate, or priority.',
          parameters: {
            type: 'OBJECT',
            properties: {
              onlyOverdue: { type: 'BOOLEAN' },
              filterStatus: { type: 'STRING' },
              filterCategory: { type: 'STRING' },
              setDueDate: { type: 'STRING' },
              setStatus: { type: 'STRING' },
              setPriority: { type: 'STRING' },
            },
          },
        },
        {
          name: 'controlTimer',
          description: 'Start the focus timer on a task matching taskKeyOrTitle (or "highest_priority_today"), or stop the running timer.',
          parameters: {
            type: 'OBJECT',
            properties: {
              action: { type: 'STRING', enum: ['start', 'stop'] },
              taskQuery: { type: 'STRING' },
            },
            required: ['action'],
          },
        },
        {
          name: 'recordTransaction',
          description: 'Record an income, expense, or saving transaction in Finance.',
          parameters: {
            type: 'OBJECT',
            properties: {
              type: { type: 'STRING', enum: ['income', 'expense', 'saving'] },
              amount: { type: 'NUMBER' },
              date: { type: 'STRING' },
              category: { type: 'STRING' },
              pot: { type: 'STRING' },
              note: { type: 'STRING' },
            },
            required: ['type', 'amount', 'date', 'category'],
          },
        }
      );
    }

    async function runTool(name, args = {}) {
      if (name === 'queryTimeTracked') {
        const logFilter = { user: userId };
        if (args.dateFrom || args.dateTo) {
          logFilter.startTime = {};
          if (args.dateFrom) logFilter.startTime.$gte = new Date(`${args.dateFrom}T00:00:00`);
          if (args.dateTo) logFilter.startTime.$lte = new Date(`${args.dateTo}T23:59:59`);
        }
        const logs = await TimeLog.find(logFilter).lean();
        const taskIds = [...new Set(logs.map((l) => String(l.task)))];
        const tasks = await Task.find({ _id: { $in: taskIds }, user: userId }).select('key title category discipline').lean();
        const tm = new Map(tasks.map((t) => [String(t._id), t]));
        let totalSecs = 0;
        const byTask = new Map();
        for (const l of logs) {
          const t = tm.get(String(l.task));
          if (!t) continue;
          if (args.category && !(t.category || '').toLowerCase().includes(args.category.toLowerCase())) continue;
          if (args.discipline && !(t.discipline || '').toLowerCase().includes(args.discipline.toLowerCase())) continue;
          if (args.keyword && !`${t.key} ${t.title} ${t.category}`.toLowerCase().includes(args.keyword.toLowerCase())) continue;
          const s = l.isRunning ? Math.max(0, Math.round((Date.now() - new Date(l.startTime).getTime()) / 1000)) : l.durationSeconds;
          totalSecs += s;
          const k = `${t.key} ${t.title} (${t.category || 'Uncategorised'})`;
          byTask.set(k, (byTask.get(k) || 0) + s);
        }
        return {
          totalHours: Math.round((totalSecs / 3600) * 100) / 100,
          breakdown: [...byTask.entries()].map(([task, s]) => ({ task, hours: Math.round((s / 3600) * 100) / 100 })),
        };
      }
      if (name === 'queryTasks') {
        const q = { user: userId };
        if (args.status) q.status = args.status;
        if (args.priority) q.priority = args.priority;
        if (args.category) q.category = new RegExp(args.category, 'i');
        const list = await Task.find(q).limit(40).select('key title status priority category dueDate totalTrackedSeconds').lean();
        return { count: list.length, tasks: list.map((t) => ({ ...t, hours: Math.round((t.totalTrackedSeconds / 3600) * 10) / 10 })) };
      }
      if (name === 'queryFinance') {
        const q = { user: userId };
        if (args.month) q.month = args.month;
        if (args.type) q.type = args.type;
        if (args.category) q.category = new RegExp(args.category, 'i');
        if (args.dateFrom || args.dateTo) {
          q.date = {};
          if (args.dateFrom) q.date.$gte = args.dateFrom;
          if (args.dateTo) q.date.$lte = args.dateTo;
        }
        const txs = await Transaction.find(q).sort('-date').limit(100).lean();
        const sum = { income: 0, expense: 0, saving: 0 };
        const byCat = {};
        for (const x of txs) {
          sum[x.type] = (sum[x.type] || 0) + x.amount;
          const c = x.category || 'Uncategorised';
          byCat[c] = (byCat[c] || 0) + x.amount;
        }
        return { currency: cur, count: txs.length, totals: sum, byCategory: byCat, sample: txs.slice(0, 15) };
      }
      if (name === 'createNewTask') {
        const doc = await createTask(userId, {
          title: args.title,
          category: args.category || '',
          discipline: args.discipline || '',
          priority: ['high', 'medium', 'low'].includes(args.priority) ? args.priority : 'medium',
          status: ['backlog', 'up_next', 'in_progress', 'blocked'].includes(args.status) ? args.status : 'up_next',
          dueDate: args.dueDate || null,
          estimateMinutes: Number(args.estimateMinutes) || 0,
          subtasks: Array.isArray(args.subtasks) ? args.subtasks.map((s) => ({ title: String(s), done: false })) : [],
        });
        mutated = true;
        actionsTaken.push(`Created task ${doc.key}: ${doc.title}`);
        return { created: doc.key, title: doc.title };
      }
      if (name === 'bulkUpdateTasks') {
        const q = { user: userId, status: { $ne: 'completed' } };
        if (args.onlyOverdue) q.dueDate = { $ne: null, $lt: today };
        if (args.filterStatus) q.status = args.filterStatus;
        if (args.filterCategory) q.category = new RegExp(args.filterCategory, 'i');
        const set = {};
        if (args.setDueDate) set.dueDate = args.setDueDate;
        if (args.setStatus) set.status = args.setStatus;
        if (args.setPriority) set.priority = args.setPriority;
        const r = await Task.updateMany(q, { $set: set });
        mutated = true;
        actionsTaken.push(`Updated ${r.modifiedCount} task(s)`);
        return { modifiedCount: r.modifiedCount };
      }
      if (name === 'controlTimer') {
        if (args.action === 'stop') {
          await stopRunning(userId);
          broadcast('timer:changed');
          mutated = true;
          actionsTaken.push('Stopped timer');
          return { stopped: true };
        }
        let target = null;
        if (!args.taskQuery || args.taskQuery === 'highest_priority_today') {
          const open = await Task.find({ user: userId, status: { $ne: 'completed' } }).lean();
          const rank = { high: 0, medium: 1, low: 2 };
          open.sort((a, b) => (a.dueDate === today ? -1 : 1) - (b.dueDate === today ? -1 : 1) || (rank[a.priority] ?? 1) - (rank[b.priority] ?? 1));
          target = open[0];
        } else {
          const rx = new RegExp(args.taskQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
          target = await Task.findOne({ user: userId, status: { $ne: 'completed' }, $or: [{ key: rx }, { title: rx }, { category: rx }] }).lean();
        }
        if (!target) return { error: 'No matching task found to start timer' };
        await startTimerFor(userId, target._id);
        broadcast('timer:changed');
        mutated = true;
        actionsTaken.push(`Started timer on ${target.key} (${target.title})`);
        return { started: target.key, title: target.title };
      }
      if (name === 'recordTransaction') {
        const d = /^\d{4}-\d{2}-\d{2}$/.test(args.date) ? args.date : today;
        const tx = await Transaction.create({
          user: userId,
          type: ['income', 'expense', 'saving'].includes(args.type) ? args.type : 'expense',
          amount: Math.max(0.01, Number(args.amount) || 0),
          date: d,
          month: d.slice(0, 7),
          category: String(args.category || 'Other').slice(0, 60),
          pot: String(args.pot || '').slice(0, 60),
          note: String(args.note || '').slice(0, 200),
          recurring: false,
        });
        mutated = true;
        actionsTaken.push(`Logged ${tx.type}: ${cur} ${tx.amount} (${tx.category})`);
        return { id: String(tx._id), amount: tx.amount, category: tx.category };
      }
      return { error: 'Unknown tool' };
    }

    const contents = [{ role: 'user', parts: [{ text: question }] }];
    const sys = `You are Workbench AI. Today is ${today} (Current month: ${today.slice(0, 7)}, Currency: ${cur}).
Existing task categories: ${JSON.stringify(categories)}. Existing disciplines: ${JSON.stringify(disciplines)}.
Use the provided tools to answer questions or execute actions requested by the user, then confirm concisely in 1-2 sentences.`;

    for (let turn = 0; turn < 4; turn++) {
      const data = await callGemini({ contents, systemInstruction: sys, tools: [{ functionDeclarations: declarations }] });
      const parts = data?.candidates?.[0]?.content?.parts || [];
      const calls = parts.filter((p) => p.functionCall);
      if (!calls.length) {
        return { answer: parts.map((p) => p.text || '').join('').trim() || 'Done.', actionsTaken, mutated };
      }
      contents.push({ role: 'model', parts });
      const responseParts = [];
      for (const c of calls) {
        const res = await runTool(c.functionCall.name, c.functionCall.args || {});
        responseParts.push({ functionResponse: { name: c.functionCall.name, response: res } });
      }
      contents.push({ role: 'user', parts: responseParts });
    }
    return { answer: 'Completed requested actions.', actionsTaken, mutated };
  }

  handle('ai:askData', async ({ userId, payload }) => runPaletteAi(userId, str(payload.question, { max: 500, required: true }), false));
  handle('ai:agentCommand', async ({ userId, payload }) => runPaletteAi(userId, str(payload.command, { max: 500, required: true }), true));

  // 13. Semantic Search
  handle('ai:semanticSearch', async ({ userId, payload }) => {
    const query = str(payload.query, { max: 300, required: true });
    const tasks = await Task.find({ user: userId })
      .select('+embedding +embeddingText key title description category discipline status priority subtasks blockedReason')
      .lean();
    if (!tasks.length) return [];

    const stale = [];
    for (const t of tasks) {
      const text = `${t.key} ${t.title} ${t.category || ''} ${t.discipline || ''} ${stripHtml(t.description)} ${(t.subtasks || []).map((s) => s.title).join(' ')} ${t.blockedReason || ''}`.trim();
      t._text = text;
      if (!Array.isArray(t.embedding) || !t.embedding.length || t.embeddingText !== text) stale.push(t);
    }
    if (stale.length) {
      const batch = stale.slice(0, 40);
      const vecs = await embedTexts([query, ...batch.map((x) => x._text)]);
      const qVec = vecs[0] || [];
      const ops = [];
      batch.forEach((t, idx) => {
        t.embedding = vecs[idx + 1] || [];
        ops.push({ updateOne: { filter: { _id: t._id }, update: { $set: { embedding: t.embedding, embeddingText: t._text } } } });
      });
      if (ops.length) await Task.bulkWrite(ops);
      return tasks
        .map((t) => ({ _id: String(t._id), key: t.key, title: t.title, category: t.category, status: t.status, score: cosine(qVec, t.embedding) }))
        .filter((x) => x.score > 0.45)
        .sort((a, b) => b.score - a.score)
        .slice(0, 12);
    }

    const [qVec] = await embedTexts([query]);
    return tasks
      .map((t) => ({ _id: String(t._id), key: t.key, title: t.title, category: t.category, status: t.status, score: cosine(qVec, t.embedding) }))
      .filter((x) => x.score > 0.45)
      .sort((a, b) => b.score - a.score)
      .slice(0, 12);
  });

  // 14. Time-log summaries
  handle('ai:summarizeTimesheet', async ({ userId, payload }) => {
    const from = str(payload.from, { max: 20, required: true });
    const to = str(payload.to, { max: 20, required: true });
    const catFilter = str(payload.category || '', { max: 60 }).toLowerCase();
    const start = new Date(`${from}T00:00:00`);
    const end = new Date(`${to}T00:00:00`); end.setDate(end.getDate() + 1);
    const allLogs = await TimeLog.find({ user: userId, isRunning: false, startTime: { $gte: start, $lt: end } }).sort('startTime').lean();
    if (!allLogs.length) throw new AppError('No tracked sessions in that date range');
    const tasks = await Task.find({ _id: { $in: [...new Set(allLogs.map((l) => String(l.task)))] } })
      .select('key title category discipline subtasks').lean();
    const tm = new Map(tasks.map((t) => [String(t._id), t]));
    const logs = catFilter
      ? allLogs.filter((l) => (tm.get(String(l.task))?.category || '').toLowerCase() === catFilter)
      : allLogs;
    if (!logs.length) throw new AppError('No sessions match that category in this date range');
    const lines = await summarizeTimeLogsForUser(userId, logs, tm);
    return logs.map((l, i) => {
      const t = tm.get(String(l.task)) || {};
      return {
        date: ymd(new Date(l.startTime)),
        hours: Math.round((l.durationSeconds / 3600) * 100) / 100,
        key: t.key || '',
        title: t.title || '',
        category: t.category || 'Uncategorised',
        line: lines[i],
      };
    });
  });

  // Pack 1A. Receipt & Bank Slip Scanner (Vision -> Finance Transaction)
  handle('ai:scanReceipt', async ({ userId, payload }) => {
    const imageBase64 = str(payload.imageBase64, { max: 15 * 1024 * 1024, required: true });
    const mimeType = str(payload.mimeType || 'image/png', { max: 100 });
    const today = ymd(new Date());
    const recent = await Transaction.find({ user: userId }).sort('-date').limit(60).select('category pot').lean();
    const cats = [...new Set(['Salary', 'Freelance', 'Business', 'Rent', 'Food', 'Transport', 'Fuel', 'Bills', 'Health', 'Shopping', 'Entertainment', 'Savings', ...recent.map((r) => r.category).filter(Boolean)])];
    const pots = [...new Set(['Emergency fund', 'General', ...recent.map((r) => r.pot).filter(Boolean)])];
    const schema = {
      type: 'OBJECT',
      properties: {
        type: { type: 'STRING', enum: ['income', 'expense', 'saving'] },
        amount: { type: 'NUMBER' },
        date: { type: 'STRING' },
        category: { type: 'STRING' },
        pot: { type: 'STRING' },
        note: { type: 'STRING' },
        recurring: { type: 'BOOLEAN' },
      },
      required: ['type', 'amount', 'date', 'category', 'pot', 'note', 'recurring'],
    };
    const data = await callGemini({
      contents: [{
        role: 'user',
        parts: [
          { inlineData: { mimeType, data: imageBase64 } },
          {
            text: `Extract the transaction details from this receipt, invoice, or bank transfer slip image.
Today's date fallback (if no date is visible): ${today}.
Prefer matching one of these categories: ${JSON.stringify(cats)}.
Savings pots (only if saving): ${JSON.stringify(pots)}.
Include merchant/recipient and key items in the note.`,
          },
        ],
      }],
      responseSchema: schema,
    });
    const text = data?.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('') || '{}';
    try { return JSON.parse(text); } catch { throw new AppError('Could not read receipt image', 'AI_ERROR'); }
  });

  // Pack 1B. Screenshot-to-Task (Vision -> Task + Description + Subtasks)
  handle('ai:imageToTask', async ({ userId, payload }) => {
    const imageBase64 = str(payload.imageBase64, { max: 15 * 1024 * 1024, required: true });
    const mimeType = str(payload.mimeType || 'image/png', { max: 100 });
    const hint = str(payload.hint || '', { max: 300 });
    const { categories, disciplines, pairs } = await getUserCategoryContext(userId);
    const schema = {
      type: 'OBJECT',
      properties: {
        title: { type: 'STRING' },
        descriptionHtml: { type: 'STRING' },
        category: { type: 'STRING' },
        discipline: { type: 'STRING' },
        priority: { type: 'STRING', enum: ['high', 'medium', 'low'] },
        estimateMinutes: { type: 'INTEGER' },
        subtasks: { type: 'ARRAY', items: { type: 'STRING' } },
      },
      required: ['title', 'descriptionHtml', 'category', 'discipline', 'priority', 'estimateMinutes', 'subtasks'],
    };
    const data = await callGemini({
      contents: [{
        role: 'user',
        parts: [
          { inlineData: { mimeType, data: imageBase64 } },
          {
            text: `Analyze this screenshot (bug, error log, UI design, or diagram) and turn it into an actionable engineering/project task.
User hint: "${hint}"
Reuse existing categories when possible: ${JSON.stringify(categories)}.
Category-discipline pairs: ${JSON.stringify(pairs)} (Disciplines: ${JSON.stringify(disciplines)}).
Format descriptionHtml with clean <p>, <b>, <code>, and <ul><li> tags summarizing the problem/context, and provide 3-5 concrete subtasks.`,
          },
        ],
      }],
      responseSchema: schema,
    });
    const text = data?.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('') || '{}';
    try { return JSON.parse(text); } catch { throw new AppError('Could not parse screenshot into task', 'AI_ERROR'); }
  });

  // Pack 2A. 1-Click Daily Standup Generator
  handle('ai:standup', async ({ userId }) => {
    const now = new Date();
    const today = ymd(now);
    const since = new Date(now.getTime() - 36 * 3600 * 1000); // last 36h covers yesterday + today
    const [recentCompleted, recentLogs, openTasks] = await Promise.all([
      Task.find({ user: userId, status: 'completed', completedAt: { $gte: since } }).select('key title category').lean(),
      TimeLog.find({ user: userId, startTime: { $gte: since } }).select('task durationSeconds note startTime').lean(),
      Task.find({ user: userId, status: { $ne: 'completed' } }).select('key title status category priority dueDate blockedReason').lean(),
    ]);
    const taskIds = [...new Set(recentLogs.map((l) => String(l.task)))];
    const logTasks = await Task.find({ _id: { $in: taskIds } }).select('key title category').lean();
    const tm = new Map(logTasks.map((t) => [String(t._id), t]));
    const sessions = recentLogs.map((l) => ({
      task: `${tm.get(String(l.task))?.key || ''} ${tm.get(String(l.task))?.title || ''}`.trim(),
      minutes: Math.round((l.durationSeconds || 0) / 60),
      note: l.note || '',
    }));
    const todayPlan = openTasks.filter((t) => t.status === 'in_progress' || t.dueDate === today || (t.dueDate && t.dueDate < today));
    const blocked = openTasks.filter((t) => t.status === 'blocked');

    const schema = {
      type: 'OBJECT',
      properties: {
        yesterday: { type: 'ARRAY', items: { type: 'STRING' } },
        today: { type: 'ARRAY', items: { type: 'STRING' } },
        blockers: { type: 'ARRAY', items: { type: 'STRING' } },
        markdown: { type: 'STRING' },
      },
      required: ['yesterday', 'today', 'blockers', 'markdown'],
    };
    return generateJson(
      `Generate a crisp, developer-friendly Daily Standup update from the user's real Workbench activity:
Completed recently: ${JSON.stringify(recentCompleted)}
Recent tracked sessions & notes: ${JSON.stringify(sessions)}
In progress / Due today: ${JSON.stringify(todayPlan)}
Blocked tasks: ${JSON.stringify(blocked)}
Include task keys (e.g. WRK-105) where helpful, and provide a ready-to-paste Slack/Teams markdown string in "markdown".`,
      schema
    );
  });

  // Pack 2B. AI Technical Writer in RichEditor
  handle('ai:writeSpec', async ({ payload }) => {
    const title = str(payload.title, { max: 300, required: true });
    const notes = stripHtml(payload.html || '');
    const schema = {
      type: 'OBJECT',
      properties: { html: { type: 'STRING' } },
      required: ['html'],
    };
    return generateJson(
      `Turn the task title and rough notes below into a clean, structured technical specification or execution guide formatted in simple HTML using only <p>, <b>, <i>, <code>, <ul>, and <li> tags.
Task Title: "${title}"
Rough Notes: "${notes}"`,
      schema
    );
  });
}

module.exports = { registerAiHandlers, summarizeTimeLogsForUser };
