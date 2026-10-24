const { Schema, model } = require('mongoose');
const { STATUSES, PRIORITIES, REPEATS } = require('./constants');

const SubTaskSchema = new Schema(
  { title: { type: String, required: true, trim: true, maxlength: 200 }, done: { type: Boolean, default: false } },
  { _id: true }
);

const TaskSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    key: { type: String, required: true },                       // "WRK-212"
    title: { type: String, required: true, trim: true, maxlength: 200 },
    description: { type: String, default: '', maxlength: 20000 }, // HTML from the rich-text editor
    status: { type: String, enum: STATUSES, default: 'backlog' },
    category: { type: String, default: '', trim: true, maxlength: 60 },   // "Axceera Dev", "Yamaha TZR"
    discipline: { type: String, default: '', trim: true, maxlength: 60 }, // "Full-Stack Dev" (analytics donut)
    priority: { type: String, enum: PRIORITIES, default: 'medium' },
    order: { type: Number, default: 0 },                         // position inside its column
    subtasks: { type: [SubTaskSchema], default: [] },
    timeLogs: [{ type: Schema.Types.ObjectId, ref: 'TimeLog' }],
    totalTrackedSeconds: { type: Number, default: 0 },           // denormalised for fast cards/analytics
    estimateMinutes: { type: Number, default: 0, min: 0 },       // "Planned" in Analytics
    completedAt: { type: Date, default: null },
    dueDate: { type: String, default: null, validate: (v) => v == null || /^\d{4}-\d{2}-\d{2}$/.test(v) }, // YYYY-MM-DD
    blockedReason: { type: String, default: '', maxlength: 300 },
    repeat: { type: String, enum: REPEATS, default: 'none' },
    spawnedNext: { type: Boolean, default: false },   // recurring: next copy already created
    goal: { type: Schema.Types.ObjectId, ref: 'LongTermGoal', default: null }, // set when promoted
  },
  { timestamps: true }
);

TaskSchema.index({ user: 1, key: 1 }, { unique: true });
TaskSchema.index({ user: 1, status: 1, order: 1 });

module.exports = model('Task', TaskSchema);
