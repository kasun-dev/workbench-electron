const { Schema, model } = require('mongoose');
const { THEMES } = require('./constants');

const num = (def, min, max) => ({ type: Number, default: def, min, max });

const UserSchema = new Schema(
  {
    email: { type: String, required: true, unique: true, lowercase: true, trim: true, maxlength: 254 },
    passwordHash: { type: String, required: true, select: false },
    displayName: { type: String, required: true, trim: true, maxlength: 80 },
    // Atomic counter used to generate WRK-101, WRK-102 ... keys per user
    taskSeq: { type: Number, default: 100 },
    preferences: {
      theme: { type: String, enum: THEMES, default: 'dark' },
      currency: { type: String, default: 'LKR', trim: true, maxlength: 8 },
      idleMinutes: num(10, 0, 240), // 0 = idle detection off
      pomodoro: {
        enabled: { type: Boolean, default: false },
        focusMinutes: num(25, 1, 180),
        shortBreakMinutes: num(5, 1, 60),
        longBreakMinutes: num(15, 1, 120),
        longBreakEvery: num(4, 2, 12),
      },
      autoStartBreaks: { type: Boolean, default: false },
      weeklyPlan: { type: [Number], default: [8, 8, 8, 8, 6, 3, 0] }, // planned hours Mon..Sun (Analytics)
    },
  },
  { timestamps: true }
);

module.exports = model('User', UserSchema);
