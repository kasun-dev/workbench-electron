const { registerAuthHandlers } = require('./auth');
const { registerTaskHandlers } = require('./tasks');
const { registerTimerHandlers } = require('./timer');
const { registerTimeLogHandlers } = require('./timelogs');
const { registerGoalHandlers } = require('./goals');
const { registerAnalyticsHandlers } = require('./analytics');
const { registerReviewHandlers } = require('./review');
const { registerFinanceHandlers } = require('./finance');
const { registerDataHandlers } = require('./data');
const { registerSystemHandlers } = require('./system');

module.exports = function registerIpc() {
  registerAuthHandlers();
  registerTaskHandlers();
  registerTimerHandlers();
  registerTimeLogHandlers();
  registerGoalHandlers();
  registerAnalyticsHandlers();
  registerReviewHandlers();
  registerFinanceHandlers();
  registerDataHandlers();
  registerSystemHandlers();
};
