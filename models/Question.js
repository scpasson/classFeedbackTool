const mongoose = require('mongoose');

// A question can belong to many sets; its position lives in QuestionSet.questions.
const questionSchema = new mongoose.Schema({
  teacherId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  questionType: { type: String, enum: ['multiple-choice', 'poll'], default: 'multiple-choice', required: true },
  prompt: { type: String, required: true }, // Supports LaTeX strings
  options: [{ type: String }], // Array of 4 choices (LaTeX supported)
  tags: [{ type: String }], // Array of tags for categorization
  shuffleOptions: { type: Boolean, default: false }, // Shuffle option order when presented
  // 0=A, 1=B, 2=C, 3=D; polls have no correct answer.
  correctAnswerIndex: {
    type: Number,
    min: 0,
    max: 3,
    required: function () { return this.questionType === 'multiple-choice'; }
  }
});

module.exports = mongoose.model('Question', questionSchema);