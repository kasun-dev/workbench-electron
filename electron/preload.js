const { contextBridge, ipcRenderer } = require('electron');

async function call(channel, payload) {
  const res = await ipcRenderer.invoke(channel, payload);
  if (!res.ok) {
    const err = new Error(res.error.message);
    err.code = res.error.code;
    throw err;
  }
  return res.data;
}

const EVENTS = ['timer:changed', 'idle:prompt', 'cmd:capture'];

contextBridge.exposeInMainWorld('api', {
  auth: {
    register: (p) => call('auth:register', p),
    login: (p) => call('auth:login', p),
    logout: () => call('auth:logout'),
    session: () => call('auth:session'),
  },
  user: {
    updateProfile: (p) => call('user:updateProfile', p),
    changePassword: (p) => call('user:changePassword', p),
    updatePreferences: (p) => call('user:updatePreferences', p),
  },
  tasks: {
    list: () => call('tasks:list'),
    get: (id) => call('tasks:get', { id }),
    create: (data) => call('tasks:create', data),
    update: (id, changes) => call('tasks:update', { id, changes }),
    move: (id, status, index) => call('tasks:move', { id, status, index }),
    delete: (id) => call('tasks:delete', { id }),
  },
  timer: {
    start: (taskId) => call('timer:start', { taskId }),
    stop: (endAt) => call('timer:stop', { endAt }),
    toggle: () => call('timer:toggle'),
    active: () => call('timer:active'),
  },
  timelogs: {
    create: (p) => call('timelogs:create', p),
    update: (p) => call('timelogs:update', p),
    delete: (id) => call('timelogs:delete', { id }),
  },
  goals: {
    list: () => call('goals:list'),
    create: (data) => call('goals:create', data),
    update: (id, changes) => call('goals:update', { id, changes }),
    delete: (id) => call('goals:delete', { id }),
    promote: (id, status) => call('goals:promote', { id, status }),
  },
  analytics: { summary: () => call('analytics:summary') },
  review: { summary: () => call('review:summary') },
  finance: {
    month: (month) => call('finance:month', { month }),
    overview: (year) => call('finance:overview', { year }),
    create: (data) => call('finance:create', data),
    update: (id, changes) => call('finance:update', { id, changes }),
    delete: (id) => call('finance:delete', { id }),
    carryOver: (from, to) => call('finance:carryOver', { from, to }),
  },
  data: {
    exportTimesheet: (p) => call('export:timesheet', p),
    exportFinance: (month) => call('export:finance', { month }),
    backup: () => call('data:backup'),
    restore: () => call('data:restore'),
  },
  system: {
    get: () => call('system:get'),
    set: (patch) => call('system:set', patch),
    toggleMini: () => call('system:toggleMini'),
  },
  ai: {
    test: () => call('ai:test'),
    parseCapture: (text) => call('ai:parseCapture', { text }),
    categorize: (title) => call('ai:categorize', { title }),
    breakdown: (p) => call('ai:breakdown', p),
    estimate: (p) => call('ai:estimate', p),
    voiceCapture: (p) => call('ai:voiceCapture', p),
    planDay: (p) => call('ai:planDay', p),
    weeklyNarrative: (reviewData) => call('ai:weeklyNarrative', { reviewData }),
    coachGoal: (goalId) => call('ai:coachGoal', { goalId }),
    unblock: (taskId) => call('ai:unblock', { taskId }),
    parseFinance: (text) => call('ai:parseFinance', { text }),
    financeInsights: (p) => call('ai:financeInsights', p),
    askData: (question) => call('ai:askData', { question }),
    agentCommand: (command) => call('ai:agentCommand', { command }),
    semanticSearch: (query) => call('ai:semanticSearch', { query }),
    summarizeTimesheet: (p) => call('ai:summarizeTimesheet', p),
    scanReceipt: (p) => call('ai:scanReceipt', p),
    imageToTask: (p) => call('ai:imageToTask', p),
    standup: () => call('ai:standup'),
    writeSpec: (p) => call('ai:writeSpec', p),
    analyticsInsights: (analyticsData) => call('ai:analyticsInsights', { analyticsData }),
  },
  events: {
    on: (channel, cb) => {
      if (!EVENTS.includes(channel)) throw new Error('Unknown event');
      const handler = (_e, payload) => cb(payload);
      ipcRenderer.on(channel, handler);
      return () => ipcRenderer.removeListener(channel, handler);
    },
  },
});
