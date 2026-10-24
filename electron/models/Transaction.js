const { Schema, model } = require('mongoose');
const { TX_TYPES } = require('./constants');

const TransactionSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    type: { type: String, enum: TX_TYPES, required: true },       // income | expense | saving
    amount: { type: Number, required: true, min: 0.01 },
    category: { type: String, default: '', trim: true, maxlength: 60 },
    note: { type: String, default: '', trim: true, maxlength: 200 },
    pot: { type: String, default: '', trim: true, maxlength: 60 }, // savings pot, e.g. "Emergency fund"
    date: { type: String, required: true },                        // YYYY-MM-DD (timezone-proof)
    month: { type: String, required: true },                       // YYYY-MM (indexed for month views)
    recurring: { type: Boolean, default: false },                  // copied by "carry over recurring"
  },
  { timestamps: true }
);

TransactionSchema.index({ user: 1, month: 1, date: -1 });
TransactionSchema.index({ user: 1, type: 1 });

module.exports = model('Transaction', TransactionSchema);
