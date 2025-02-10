const mongoose = require("mongoose");

const friendListSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true }, // Owner of the friend list
  friends: [
    {
      friendId: { type: mongoose.Schema.Types.ObjectId, ref: "User" }, // Friend's user ID
      status: {
        type: String,
        enum: ["requested", "pending", "accepted", "blocked"],
        default: "pending",
      }, // Friendship status
      addedAt: { type: Date, default: Date.now }, // Timestamp of the request
    },
  ],
});

module.exports = mongoose.model("FriendList", friendListSchema);
