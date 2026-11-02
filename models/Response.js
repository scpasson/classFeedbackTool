const mongoose = require('mongoose');

const responseSchema = new mongoose.Schema({
  classId: { type: mongoose.Schema.Types.ObjectId, ref: 'Class', required: true },
  questionSetId: { type: mongoose.Schema.Types.ObjectId, ref: 'QuestionSet' }, // The set the question was asked in
  questionId: { type: mongoose.Schema.Types.ObjectId, ref: 'Question', required: true },
  studentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Student', required: true },
  selectedAnswerIndex: { type: Number, required: true },
  isCorrect: { type: Boolean, default: null }, // null for poll questions
  timestamp: { type: Date, default: Date.now }
});

responseSchema.index({ classId: 1, questionSetId: 1, questionId: 1, studentId: 1 });

module.exports = mongoose.model('Response', responseSchema);