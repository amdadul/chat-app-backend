const express = require("express");
const mongoose = require("mongoose");
const dotenv = require("dotenv");
const http = require("http");
const { Server } = require("socket.io");
const User = require("./models/userModel");
const Message = require("./models/messageModel");
const Group = require("./models/groupModel");
const cors = require("cors");
const FriendList = require("./models/friendListModel");

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

const allowedOrigins = ["https://chat.motionsoft.com.bd"];

app.use(
  cors({
    origin: function (origin, callback) {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, origin);
      } else {
        callback(new Error("Not allowed by CORS"));
      }
    },
    credentials: true,
  })
);

// Middleware
app.use(express.json());

app.use("/uploads", express.static("uploads"));

// MongoDB connection
mongoose
  .connect(process.env.MONGO_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  })
  .then(() => console.log("MongoDB connected"))
  .catch((err) => console.error("MongoDB connection error:", err));

// Routes
const userRoutes = require("./routes/userRoutes");
const { log } = require("console");
app.use("/api/users", userRoutes);

const server = http.createServer(app);

// Start the server
// app.listen(PORT, () => {
//   console.log(`Server running on http://localhost:${PORT}`);
// });

const io = new Server(server, {
  connectionStateRecovery: {},
  cors: {
    origin: allowedOrigins,
    methods: ["GET", "POST"],
    credentials: true,
  },
});
const onlineUsers = new Map();
const onlineGroups = new Map();
let groupOnlineUsers = new Map();

function getUserIdBySocketId(socketId) {
  for (const [userId, storedSocketId] of onlineUsers.entries()) {
    if (storedSocketId === socketId) {
      return userId;
    }
  }
  return null; // Not found
}

// Socket.IO events
io.on("connection", (socket) => {
  console.log("A user connected:", socket.id);

  socket.on("userOnline", async (userId) => {
    onlineUsers.set(userId, socket.id);
    const groups = await Group.find({ "members.userId": userId }).select("_id");
    const groupIds = groups.map((group) => group._id.toString());
    groupIds.forEach((groupId) => {
      if (!groupOnlineUsers.has(groupId)) {
        groupOnlineUsers.set(groupId, []);
      }
      if (!groupOnlineUsers.get(groupId).includes(userId)) {
        groupOnlineUsers.get(groupId).push(userId);
      }
    });

    groupOnlineUsers.forEach((users, groupId) => {
      if (users.length > 1) {
        onlineGroups.set(groupId, users);
        io.emit("updateGroupOnlineStatus", { groupId, status: true });
      }
    });

    io.emit("updateOnlineStatus", { userId, status: true }); // Notify all clients
    socket.emit("allOnlineUsers", Array.from(onlineUsers.keys()));
    socket.emit("allOnlineGroups", Array.from(onlineGroups.keys()));
  });

  // Listen for custom events, e.g., 'message'
  socket.on("message", (data) => {
    console.log("Message received:", data);
    // Emit the message to all connected clients
    io.emit("message", data);
  });

  socket.on(
    "sendP2PMessage",
    async ({ senderId, receiverId, message, groupId, fileUrls }) => {
      try {
        // Fetch sender's details
        const sender = await User.findById(senderId);
        if (!sender) {
          console.error("Sender not found");
          return;
        }

        if (groupId) {
          // Group message logic
          const messageModel = new Message({
            senderId,
            groupId,
            text: message,
            fileUrls,
          });

          await messageModel.save();

          // Fetch group with populated members
          const group = await Group.findById(groupId).populate(
            "members.userId"
          );
          if (!group) {
            console.error("Group not found");
            return;
          }

          // Loop through all group members and send the message
          group.members.forEach((member) => {
            const memberId = member.userId._id.toString().trim(); // Convert ObjectId to string

            if (memberId !== senderId) {
              const receiverSocketId = onlineUsers.get(memberId);

              if (receiverSocketId) {
                io.to(receiverSocketId).emit("receiveGroupMessage", {
                  message,
                  fileUrls,
                  senderId,
                  receiverId,
                  senderName: sender.name,
                  groupId,
                  timestamp: new Date(),
                });

                io.to(receiverSocketId).emit("playNotification", {
                  senderId,
                  groupId,
                });

                // 💡 Emit messageUpdate for conversation list sorting
                io.to(receiverSocketId).emit("messageUpdate", {
                  type: "group",
                  id: groupId,
                  name: group.name,
                  text: message,
                  timestamp: new Date(),
                });

                const senderSocketId = onlineUsers.get(senderId);
                if (senderSocketId) {
                  io.to(senderSocketId).emit("messageUpdate", {
                    type: "group",
                    id: receiverId,
                    name: "", // Can be filled from cached UI
                    text: message,
                    timestamp: new Date(),
                  });
                }
              }
            }
          });
        } else {
          // Private message logic
          const messageModel = new Message({
            senderId,
            receiverId,
            text: message,
            fileUrls,
          });
          await messageModel.save();

          const receiverSocketId = onlineUsers.get(receiverId);
          if (receiverSocketId) {
            io.to(receiverSocketId).emit("receiveMessage", {
              message,
              fileUrls,
              senderId,
              receiverId,
              senderName: sender.name,
              timestamp: new Date(),
            });

            io.to(receiverSocketId).emit("playNotification", {
              senderId,
              groupId,
            });

            // 💡 Emit messageUpdate for conversation list sorting
            io.to(receiverSocketId).emit("messageUpdate", {
              type: "friend",
              id: senderId,
              name: sender.name,
              text: message,
              timestamp: new Date(),
            });

            const senderSocketId = onlineUsers.get(senderId);
            if (senderSocketId) {
              io.to(senderSocketId).emit("messageUpdate", {
                type: "friend",
                id: receiverId,
                name: "", // Can be filled from cached UI
                text: message,
                timestamp: new Date(),
              });
            }
          }
        }
      } catch (error) {
        console.error("Error sending message:", error);
      }
    }
  );

  socket.on("mark-as-read", async ({ friendId, groupId, readerId }) => {
    try {
      const filter = groupId
        ? {
            groupId,
            senderId: { $ne: readerId },
            "readBy.userId": { $ne: readerId },
          }
        : {
            senderId: friendId,
            receiverId: readerId,
            isRead: false,
          };

      const update = groupId
        ? {
            $addToSet: {
              readBy: { userId: readerId, timestamp: new Date() },
            },
            $set: { isRead: true },
          }
        : { isRead: true };

      await Message.updateMany(filter, update);

      // 📨 Notify original sender (or group members)
      if (groupId) {
        io.to(groupId).emit("messages-read-by", {
          readerId,
          groupId,
        });
      } else {
        io.to(friendId).emit("messages-read-by", {
          readerId,
          friendId,
        });
      }

      const senderSocketId = onlineUsers.get(readerId);
      io.to(senderSocketId).emit("messageUpdate", {
        type: "group",
        id: groupId,
        timestamp: new Date(),
      });

      const receiverSocketId = onlineUsers.get(friendId);
      io.to(receiverSocketId).emit("readMessageUpdate", {
        type: "friend",
        id: friendId,
      });
    } catch (err) {
      console.error("Socket read update error:", err);
    }
  });

  socket.on("accept-friend-request", async ({ friendId, userId }, callback) => {
    try {
      const userFriendList = await FriendList.findOneAndUpdate(
        {
          userId,
        },
        {
          $set: {
            "friends.$[elem].status": "accepted",
          },
        },
        {
          new: true,
          arrayFilters: [
            {
              "elem.friendId": friendId,
              "elem.status": "requested",
            },
          ],
        }
      );

      if (!userFriendList) {
        return callback({ status: 404, message: "Friend request not found." });
      }

      // Step 2: Update the friend's FriendList to mark the user as accepted

      const friendFriendList = await FriendList.findOneAndUpdate(
        {
          userId: friendId,
        },
        {
          $set: {
            "friends.$[elem].status": "accepted",
          },
        },
        {
          new: true,
          arrayFilters: [
            {
              "elem.friendId": userId, // userId is already an ObjectId
              "elem.status": "pending",
            },
          ],
        }
      );

      const receiverSocketId = onlineUsers.get(friendId);
      io.to(receiverSocketId).emit("messageUpdate", {
        type: "friend",
        id: friendId,
        timestamp: new Date(),
      });

      if (!friendFriendList) {
        return callback({
          status: 404,
          message: "Friend request not found for the friend.",
        });
      }

      return callback({
        status: 200,
        message: "Friend request accepted successfully.",
      });
    } catch (err) {
      console.error("Socket read update error:", err);
      callback({
        status: 500,
        message: "An error occurred while processing the friend request.",
      });
    }
  });

  socket.on("call-user", ({ to, offer }) => {
    console.log("call to - ", to);

    const receiverSocketId = onlineUsers.get(to);
    //const senderId = getUserIdBySocketId(socket.id);
    io.to(receiverSocketId).emit("incoming-call", { from: socket.id, offer });
  });

  socket.on("answer-call", ({ to, answer }) => {
    console.log("answer to - ", to);
    //const receiverSocketId = onlineUsers.get(to);
    //const senderId = getUserIdBySocketId(socket.id);
    io.to(to).emit("call-answered", { from: socket.id, answer });
  });

  socket.on("ice-candidate", ({ to, candidate }) => {
    console.log("ice-candidate - ", to);
    //const receiverSocketId = onlineUsers.get(to);
    //const senderId = getUserIdBySocketId(socket.id);
    io.to(to).emit("ice-candidate", {
      from: socket.id,
      candidate,
    });
  });

  // Listen for disconnect event
  socket.on("disconnect", async () => {
    for (const [userId, socketId] of onlineUsers.entries()) {
      if (socketId === socket.id) {
        onlineUsers.delete(userId);
        io.emit("updateOnlineStatus", { userId, status: false }); // Notify all clients

        const groups = await Group.find({ "members.userId": userId }).select(
          "_id"
        );
        const groupIds = groups.map((group) => group._id.toString());

        // Remove the user from each group in groupOnlineUsers
        groupIds.forEach((groupId) => {
          if (groupOnlineUsers.has(groupId)) {
            const users = groupOnlineUsers.get(groupId);
            const updatedUsers = users.filter((user) => user !== userId); // Remove the disconnected user

            if (updatedUsers.length === 0) {
              groupOnlineUsers.delete(groupId); // Remove the group from groupOnlineUsers if no users are online
            } else {
              groupOnlineUsers.set(groupId, updatedUsers); // Update the group with the remaining users
            }

            // If the group still has online users, add it to onlineGroups
            if (updatedUsers.length > 1) {
              onlineGroups.set(groupId, updatedUsers);
            } else {
              onlineGroups.delete(groupId); // Remove group from onlineGroups if only 1 or no user is online
              io.emit("updateGroupOnlineStatus", { groupId, status: false });
            }
          }
        });

        break;
      }
    }
    console.log("A user disconnected:", socket.id);
  });

  if (!socket.recovered) {
    // if the connection state recovery was not successful
    try {
      socket.emit("allOnlineUsers", Array.from(onlineUsers.keys()));
    } catch (e) {
      // something went wrong
    }
  }
});

// Start the server
server.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on http://0.0.0.0:${PORT}`);
});
