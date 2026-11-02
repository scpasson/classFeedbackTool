const mongoose = require('mongoose');

// One document per physical card; grid is 25 chars of 0/1 (1 = black), row-major, stored with answer A on top.
const cardSchema = new mongoose.Schema({
  cardId: { type: Number, required: true, unique: true, min: 1, validate: Number.isInteger },
  grid: { type: String, required: true, match: /^[01]{25}$/ }
});

module.exports = mongoose.model('Card', cardSchema);
