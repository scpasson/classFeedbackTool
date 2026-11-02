const mongoose = require('mongoose');

const studentSchema = new mongoose.Schema({
  classId: { type: mongoose.Schema.Types.ObjectId, ref: 'Class', required: true },
  firstName: { type: String, required: true, trim: true },
  lastName: { type: String, required: true, trim: true },
  presentedName: { type: String, trim: true, default: '' }, // Name shown on screen; falls back to first + last
  studentNumber: { type: String, trim: true, default: '' }, // School ID or roster number (optional)
  sortOrder: { type: Number, default: null }, // Teacher-chosen position, e.g. to match a gradebook
  cardId: { type: Number, required: true, min: 1, validate: Number.isInteger } // Card number printed on the card
}, {
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

studentSchema.virtual('name').get(function () {
  return this.presentedName || [this.firstName, this.lastName].filter(Boolean).join(' ');
});

module.exports = mongoose.model('Student', studentSchema);