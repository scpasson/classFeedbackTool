const mongoose = require('mongoose');

const questionSetSchema = new mongoose.Schema({
  teacherId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  title: { type: String, required: true }, // e.g., "Pythagorean Theorem Practice"
  subject: { type: String, required: true, trim: true },
  active: { type: Boolean, default: true },
  // Public sets are visible to every user; older documents without the field count as public.
  isPublic: { type: Boolean, default: true },
  tags: { type: [String], default: [] },
  // Array position is the question's order within this set.
  questions: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Question' }],
  createdAt: { type: Date, default: Date.now }
}, { timestamps: { createdAt: false, updatedAt: true } });

module.exports = mongoose.model('QuestionSet', questionSetSchema);