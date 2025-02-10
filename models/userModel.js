const mongoose = require("mongoose");
const getNextSequence = require("../helpers/getNextSequence");
const bcrypt = require("bcrypt");

const userSchema = new mongoose.Schema({
  userId: { type: Number, unique: true },
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  socketId: {
    type: String,
    default: null, // Store the socket ID of the connected user
  },
  profilePicture: {
    type: String,
    default: null, // Store the socket ID of the connected user
  },
});

// Pre-save middleware to set the auto-incremented ID
userSchema.pre("save", async function (next) {
  if (!this.userId) {
    this.userId = await getNextSequence("userId");
  }
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});

module.exports = mongoose.model("User", userSchema);
