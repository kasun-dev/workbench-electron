const { Schema, model } = require('mongoose');

const TimeLogSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    task: { type: Schema.Types.ObjectId, ref: 'Task', required: true, index: true },
    startTime: { type: Date, required: true },
    endTime: { type: Date, default: null },
    durationSeconds: { type: Number, default: 0, min: 0 },
    isRunning: { type: Boolean, default: true },
    manual: { type: Boolean, default: false },   // added/edited by hand
  },
  { timestamps: true }
);

TimeLogSchema.index({ user: 1, startTime: -1 }); // analytics range queries

// DB-level guarantee: a user can only ever have ONE running timer.
TimeLogSchema.index(
  { user: 1 },
  { unique: true, partialFilterExpression: { isRunning: true }, name: 'one_running_timer_per_user' }
);

module.exports = model('TimeLog', TimeLogSchema);
