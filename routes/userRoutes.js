const express = require("express");
const User = require("../models/userModel");
const jwt = require("jsonwebtoken"); // For generating tokens
const bcrypt = require("bcrypt");
const authenticate = require("../middleware/authenticate");
const FriendList = require("../models/friendListModel");
const Group = require("../models/groupModel");
const Message = require("../models/messageModel");
const { Socket } = require("socket.io");
const multer = require("multer");
const path = require("path");
const { log } = require("console");

const router = express.Router();

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, "uploads/");
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(
      null,
      file.fieldname + "-" + uniqueSuffix + path.extname(file.originalname)
    );
    //cb(null, Date.now() + "-" + file.originalname)
  },
});

const upload = multer({ storage: storage });

router.post("/upload", authenticate, upload.array("files"), (req, res) => {
  if (!req.files || req.files.length === 0) {
    return res.status(400).json({ success: false, error: "No files uploaded" });
  }

  const fileUrls = req.files.map(
    (file) => `${process.env.FILE_URL}/${file.filename}`
  );

  res.json({ success: true, fileUrls });
});

router.post(
  "/upload-single",
  authenticate,
  upload.single("file"),
  (req, res) => {
    if (!req.file) {
      return res
        .status(400)
        .json({ success: false, error: "No files uploaded" });
    }

    const fileUrl = `${process.env.FILE_URL}/${req.file.filename}`;

    res.json({ success: true, fileUrl });
  }
);

// GET all users
router.get("/", authenticate, async (req, res) => {
  try {
    const users = await User.find();
    res.status(200).json(users);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
// POST a new user
router.post("/register", async (req, res) => {
  try {
    const { name, email, password } = req.body;

    // Check if the user already exists
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ message: "Email already registered" });
    }

    // Create a new user
    const user = new User({ name, email, password });
    await user.save();
    res.status(201).json({ message: "User registered successfully" });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    // Find user by email
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(400).json({ message: "Invalid email or password" });
    }
    // Compare password
    // const bcrypt = require("bcrypt");

    // (async () => {
    //   const password = "123456";

    //   // Generate a new salt and hash
    //   const salt = await bcrypt.genSalt(10);
    //   const hashedPassword = await bcrypt.hash(password, salt);

    //   console.log("Generated Hash:", hashedPassword); // Log the generated hash

    //   // Now compare
    //   const isMatch = await bcrypt.compare(password, hashedPassword);
    //   console.log("Password match?", isMatch); // Should log 'true'
    // })();
    const isMatch = await bcrypt.compare(password, user.password);
    //console.log(isMatch);
    if (!isMatch) {
      return res.status(400).json({ message: "Invalid email or password" });
    }

    // Generate a JWT token
    const token = jwt.sign({ userId: user._id }, process.env.JWT_SECRET, {
      expiresIn: "1d",
    });

    res
      .status(200)
      .json({ success: true, message: "Login successful", token, user });
  } catch (error) {
    res
      .status(500)
      .json({ success: true, message: "Login error", error: error.message });
  }
});

router.post("/logout", (req, res) => {
  res.clearCookie("token");
  res.json({ message: "Logged out successfully" });
});

router.put("/update", authenticate, async (req, res) => {
  try {
    const userId = req.user._id;
    const { name, email, profilePicture } = req.body;

    // Construct update object
    const updateData = {};
    if (name) updateData.name = name;
    if (email) {
      const existingUser = await User.findOne({ email });
      if (existingUser && existingUser._id.toString() !== userId.toString()) {
        return res.status(200).json({
          success: false,
          message: "Email already in use",
        });
      }
      updateData.email = email;
    }
    if (profilePicture) updateData.profilePicture = profilePicture;

    // Update user without affecting password
    const user = await User.findByIdAndUpdate(
      userId,
      { $set: updateData },
      { new: true }
    );

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    res
      .status(200)
      .json({ success: true, message: "User updated successfully", user });
  } catch (error) {
    res.status(200).json({ success: false, error: error.message });
  }
});

router.post("/add-friend", authenticate, async (req, res) => {
  const { friendId } = req.body; // ID of the user to be added as a friend
  const userId = req.user._id; // Current logged-in user's ID from req.user

  if (userId.toString() === friendId) {
    return res
      .status(400)
      .json({ message: "You cannot add yourself as a friend." });
  }

  try {
    // Check if the friend list already exists for the user
    let userFriendList = await FriendList.findOne({ userId });
    let friendFriendList = await FriendList.findOne({ userId: friendId });

    if (!userFriendList) {
      userFriendList = new FriendList({ userId, friends: [] });
    }

    if (!friendFriendList) {
      friendFriendList = new FriendList({ userId: friendId, friends: [] });
    }

    // Check if the friend is already added
    const isAlreadyFriend = userFriendList.friends.some(
      (friend) => friend.friendId.toString() === friendId
    );

    if (isAlreadyFriend) {
      return res
        .status(400)
        .json({ message: "This user is already in your friend list." });
    }

    // Add the friend to the list
    userFriendList.friends.push({ friendId, status: "pending" });
    friendFriendList.friends.push({ friendId: userId, status: "requested" });

    await userFriendList.save();
    await friendFriendList.save();

    res.status(201).json({ message: "Friend request sent successfully." });
  } catch (error) {
    console.error(error);
    res
      .status(500)
      .json({ message: "Something went wrong. Please try again." });
  }
});

router.post("/accept-friend", authenticate, async (req, res) => {
  const { friendId } = req.body; // ID of the user who sent the friend request
  const userId = req.user._id; // Current logged-in user's ID

  try {
    // Step 1: Update the logged-in user's FriendList to accept the request
    const userFriendList = await FriendList.findOneAndUpdate(
      { userId, "friends.friendId": friendId, "friends.status": "requested" },
      { $set: { "friends.$.status": "accepted" } },
      { new: true }
    );

    if (!userFriendList) {
      return res.status(404).json({ message: "Friend request not found." });
    }

    // Step 2: Update the friend's FriendList to mark the user as accepted
    const friendFriendList = await FriendList.findOneAndUpdate(
      {
        userId: friendId,
        "friends.friendId": userId,
        "friends.status": "pending",
      },
      { $set: { "friends.$.status": "accepted" } },
      { new: true }
    );

    if (!friendFriendList) {
      return res
        .status(404)
        .json({ message: "Friend request not found for the friend." });
    }

    res.status(200).json({ message: "Friend request accepted successfully." });
  } catch (error) {
    console.error(error);
    res
      .status(500)
      .json({ message: "Something went wrong. Please try again." });
  }
});

router.get("/friends", authenticate, async (req, res) => {
  const userId = req.user._id;

  try {
    const friendList = await FriendList.findOne({ userId }).populate(
      "friends.friendId",
      "name email"
    );

    if (!friendList) {
      return res.status(404).json({ message: "No friends found." });
    }

    res.status(200).json({ friends: friendList.friends });
  } catch (error) {
    console.error(error);
    res
      .status(500)
      .json({ message: "Something went wrong. Please try again." });
  }
});

router.get("/get-all-users", authenticate, async (req, res) => {
  try {
    const loggedInUserId = req.user._id; // Assuming `req.user` is populated by `authenticate` middleware

    // Fetch all users except the logged-in user
    const users = await User.find(
      { _id: { $ne: loggedInUserId } },
      "name email"
    );

    // Fetch the logged-in user's friend list
    const friendList = await FriendList.findOne({ userId: loggedInUserId });

    // Get a set of friend IDs for quick lookup
    const friendIds = new Set(
      friendList?.friends.map((friend) => friend.friendId.toString()) || []
    );

    // Add isFriend flag to each user
    const usersWithFriendStatus = users.map((user) => ({
      _id: user._id,
      name: user.name,
      email: user.email,
      isFriend: friendIds.has(user._id.toString()),
    }));

    res.status(200).json({ users: usersWithFriendStatus });
  } catch (error) {
    console.error(error);
    res
      .status(500)
      .json({ message: "Something went wrong. Please try again." });
  }
});

router.get("/get-friend-requests", authenticate, async (req, res) => {
  try {
    const friendRequests = await FriendList.findOne({ userId: req.user.id }) // Find friend list for logged-in user
      .populate("friends.friendId", "name email") // Populate friend details
      .select("friends"); // Only return friends array

    if (!friendRequests) {
      return res.status(404).json({ message: "No friend requests found." });
    }

    // Filter out only requested friends
    const requests = friendRequests.friends.filter(
      (friend) => friend.status === "requested"
    );

    res.status(200).json({ friendRequests: requests });
  } catch (error) {
    console.error(error);
    res
      .status(500)
      .json({ message: "Something went wrong. Please try again." });
  }
});

// router.get("/friends-and-groups", authenticate, async (req, res) => {
//   const userId = req.user._id;

//   try {
//     // Fetch friends
//     const friendList = await FriendList.findOne({ userId }).populate(
//       "friends.friendId",
//       "name email"
//     );

//     // Fetch groups
//     const groups = await Group.find({ members: userId }).select("name");

//     res.status(200).json({
//       friends: friendList?.friends || [],
//       groups: groups || [],
//     });
//   } catch (error) {
//     console.error(error);
//     res.status(500).json({ message: "Something went wrong." });
//   }
// });

router.get("/friends-and-groups", authenticate, async (req, res) => {
  try {
    const userId = req.user._id;

    // Fetch friends
    const friendList = await FriendList.findOne({ userId }).populate(
      "friends.friendId",
      "name email profilePicture"
    );

    const friends = friendList
      ? friendList.friends
          .filter((f) => f.status === "accepted") // ✅ Only accepted friends
          .map((f) => f.friendId)
      : [];

    // Fetch groups where the user is a member
    const groups = await Group.find({ "members.userId": userId }).select(
      "name"
    );

    // Fetch last message for each friend
    const friendMessages = await Promise.all(
      friends.map(async (friend) => {
        const [lastMessage, unreadCount] = await Promise.all([
          Message.findOne({
            $or: [
              { senderId: userId, receiverId: friend._id },
              { senderId: friend._id, receiverId: userId },
            ],
          })
            .sort({ timestamp: -1 })
            .limit(1)
            .lean(),

          Message.countDocuments({
            senderId: friend._id,
            receiverId: userId,
            isRead: false,
          }),
        ]);

        return {
          type: "friend",
          id: friend._id,
          name: friend.name,
          profilePicture: friend.profilePicture,
          lastMessage: lastMessage ? lastMessage.text : "No messages yet",
          lastMessageTime: lastMessage ? lastMessage.timestamp : null,
          unreadCount,
        };
      })
    );

    // Fetch last message for each group
    const groupMessages = await Promise.all(
      groups.map(async (group) => {
        const [lastMessage, unreadCount] = await Promise.all([
          Message.findOne({ groupId: group._id })
            .sort({ timestamp: -1 })
            .limit(1)
            .lean(),

          Message.countDocuments({
            groupId: group._id,
            isRead: false,
            // Optional: if you're using read-tracking per member:
            // "readBy.userId": { $ne: userId }
          }),
        ]);

        return {
          type: "group",
          id: group._id,
          name: group.name,
          profilePicture: null,
          lastMessage: lastMessage ? lastMessage.text : "No messages yet",
          lastMessageTime: lastMessage ? lastMessage.timestamp : null,
          unreadCount,
        };
      })
    );

    // Combine friends and groups and sort by lastMessageTime
    const conversations = [...friendMessages, ...groupMessages].sort(
      (a, b) => new Date(b.lastMessageTime) - new Date(a.lastMessageTime)
    );

    res.status(200).json({ conversations });
  } catch (error) {
    console.error(error);
    res
      .status(500)
      .json({ message: "Something went wrong. Please try again." });
  }
});

router.delete("/remove-friend", authenticate, async (req, res) => {
  const { friendId } = req.body; // ID of the friend to remove
  const userId = req.user._id; // Logged-in user's ID

  try {
    // Remove the friend from the logged-in user's friend list
    const userFriendList = await FriendList.findOneAndUpdate(
      { userId },
      { $pull: { friends: { friendId } } }, // Remove the friend from the array
      { new: true } // Return the updated document
    );

    if (!userFriendList) {
      return res
        .status(404)
        .json({ message: "Friend not found in your friend list." });
    }

    // Remove the logged-in user from the friend's friend list
    const friendFriendList = await FriendList.findOneAndUpdate(
      { userId: friendId },
      { $pull: { friends: { friendId: userId } } }, // Remove the user from the friend's array
      { new: true } // Return the updated document
    );

    if (!friendFriendList) {
      return res
        .status(404)
        .json({ message: "You were not found in the friend's friend list." });
    }

    res.status(200).json({ message: "Friend removed successfully." });
  } catch (error) {
    console.error(error);
    res
      .status(500)
      .json({ message: "Something went wrong. Please try again." });
  }
});

router.get("/messages", async (req, res) => {
  const { senderId, receiverId, groupId } = req.query;

  if (!senderId || (!receiverId && !groupId)) {
    return res
      .status(400)
      .json({ message: "Sender ID, Receiver ID or Group ID is required" });
  }

  try {
    let query = {};

    // If groupId is provided, fetch group messages
    if (groupId) {
      query.groupId = groupId;
    }
    // If receiverId is provided, fetch individual messages
    else {
      query.$or = [
        { senderId, receiverId },
        { senderId: receiverId, receiverId: senderId },
      ];
    }

    // Fetch messages with sender's data (populate senderId)
    const messages = await Message.find(query)
      .populate("senderId", "name") // Populate senderId with 'name' field
      .sort({ timestamp: 1 });

    // Add sender flag to each message and include sender's name
    const messagesWithSenderFlagAndName = messages.map((msg) => ({
      ...msg.toObject(),
      sender: msg.senderId._id.toString() === senderId, // Mark sender as true if senderId matches
      senderName: msg.senderId.name, // Add sender's name
    }));

    res.json(messagesWithSenderFlagAndName);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Error fetching messages" });
  }
});

// Route: POST /api/messages/mark-as-read
router.post("/messages/mark-as-read", authenticate, async (req, res) => {
  const { friendId, groupId } = req.body;
  const userId = req.user._id;
  console.log(req.body);
  try {
    if (groupId) {
      const query = {
        groupId,
        senderId: { $ne: userId }, // only messages sent by others
        "readBy.userId": { $ne: userId }, // not already read by this user
      };

      const update = {
        $addToSet: {
          readBy: { userId, timestamp: new Date() },
        },
        $set: {
          isRead: true,
        },
      };

      const result = await Message.updateMany(query, update);
      console.log("Updated group messages:", result.modifiedCount);
    } else if (friendId) {
      const query = {
        senderId: friendId,
        receiverId: userId,
        isRead: 0,
      };

      const messages = await Message.find(query);
      console.log("Found private messages to update:", messages.length);

      const update = { isRead: 1 };
      await Message.updateMany(query, update);
    }

    res.status(200).json({ message: "Messages marked as read" });
  } catch (error) {
    console.error("Mark as read error:", error);
    res.status(500).json({ message: "Failed to mark messages as read" });
  }
});

router.post("/create-group", async (req, res) => {
  try {
    const { name, adminId, memberIds } = req.body;

    const currentTime = new Date();

    // Format members with join date
    const members = [...memberIds, adminId].map((userId) => ({
      userId,
      joinedAt: currentTime, // Assign the current timestamp
    }));

    const newGroup = new Group({
      name,
      members, // Store members with joinedAt timestamp
      admins: [adminId],
    });

    await newGroup.save();
    res
      .status(201)
      .json({ message: "Group created successfully", group: newGroup });
  } catch (error) {
    res.status(500).json({ error: "Failed to create group" });
  }
});

router.post("/add-group-member", async (req, res) => {
  try {
    const { groupId, userId } = req.body;

    const group = await Group.findById(groupId);
    if (!group) return res.status(404).json({ error: "Group not found" });

    if (!group.members.includes(userId)) {
      group.members.push(userId);
      await group.save();
    }

    res.status(200).json({ message: "Member added successfully", group });
  } catch (error) {
    res.status(500).json({ error: "Failed to add member" });
  }
});

router.post("/add-group-admin", async (req, res) => {
  try {
    const { groupId, userId } = req.body;

    const group = await Group.findById(groupId);
    if (!group) return res.status(404).json({ error: "Group not found" });

    if (!group.admins.includes(userId)) {
      group.admins.push(userId);
      await group.save();
    }

    res.status(200).json({ message: "Admin added successfully", group });
  } catch (error) {
    res.status(500).json({ error: "Failed to assign admin" });
  }
});

router.get("/groups/:userId", async (req, res) => {
  try {
    const groups = await Group.find({ members: req.params.userId }).populate(
      "members admins"
    );
    res.status(200).json(groups);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch groups" });
  }
});

module.exports = router;
