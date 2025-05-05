const mongoose = require("mongoose");

const messageSchema = new mongoose.Schema({
  senderId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
  },
  groupId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Group",
    default: null,
  },
  receiverId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    default: null,
  },
  text: { type: String, default: null },
  fileUrls: {
    type: [String], // Array of file URLs
    default: [],
  },
  isRead: { type: Number, default: 0 },
  readBy: [
    {
      userId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
      timestamp: { type: Date, default: Date.now },
    },
  ],
  timestamp: { type: Date, default: Date.now },
});

module.exports = mongoose.model("Message", messageSchema);
