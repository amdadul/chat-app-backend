const express = require("express");
const mongoose = require("mongoose");
const dotenv = require("dotenv");
const http = require("http");
const { Server } = require("socket.io");
const User = require("./models/userModel");
const Message = require("./models/messageModel");
const Group = require("./models/groupModel");

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

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
    origin: "*", // Replace with your frontend URL in production
    methods: ["GET", "POST"],
  },
});
const onlineUsers = new Map();
const onlineGroups = new Map();
let groupOnlineUsers = new Map();

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
    console.log(onlineUsers);
    console.log("group", onlineGroups);
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
                console.log(`Sending to: ${memberId} -> ${receiverSocketId}`);

                io.to(receiverSocketId).emit("receiveGroupMessage", {
                  message,
                  fileUrls,
                  senderId,
                  senderName: sender.name,
                  groupId,
                  timestamp: new Date(),
                });
              }
            }
          });

          console.log("Group message sent:", message);
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
              senderName: sender.name,
              timestamp: new Date(),
            });
          }

          console.log("Private message sent:", message);
        }
      } catch (error) {
        console.error("Error sending message:", error);
      }
    }
  );

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
server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
