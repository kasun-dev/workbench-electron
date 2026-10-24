const { Schema, model } = require('mongoose');
const { GOAL_STATUSES, PRIORITIES } = require('./constants');

const MilestoneSchema = new Schema(
  { title: { type: String, required: true, trim: true, maxlength: 200 }, done: { type: Boolean, default: false } },
  { _id: true }
);

const LongTermGoalSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    title: { type: String, required: true, trim: true, maxlength: 200 },
    description: { type: String, default: '', maxlength: 20000 },
    category: { type: String, default: '', trim: true, maxlength: 60 },
    discipline: { type: String, default: '', trim: true, maxlength: 60 },
    priority: { type: String, enum: PRIORITIES, default: 'low' },
    status: { type: String, enum: GOAL_STATUSES, default: 'someday' },
    targetDate: { type: Date, default: null },
    targetCost: { type: Number, default: 0, min: 0 },
    linkedPot: { type: String, default: '', trim: true, maxlength: 60 },
    milestones: { type: [MilestoneSchema], default: [] },
    promotedTasks: [{ type: Schema.Types.ObjectId, ref: 'Task' }], // history of every promotion
  },
  { timestamps: true }
);

LongTermGoalSchema.index({ user: 1, status: 1 });

module.exports = model('LongTermGoal', LongTermGoalSchema);
