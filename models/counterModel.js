const mongoose = require("mongoose");

const counterSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true }, // Counter identifier
  seq: { type: Number, default: 0 }, // Sequence number
});

module.exports = mongoose.model("Counter", counterSchema);
