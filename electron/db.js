const mongoose = require('mongoose');

async function connectDB() {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI is not set');
  mongoose.set('strictQuery', true);
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 8000 });
  // Make sure indexes (incl. the one-running-timer partial index) exist
  await Promise.all(Object.values(mongoose.models).map((m) => m.init()));
  console.log('[db] connected');
}

module.exports = { connectDB };
