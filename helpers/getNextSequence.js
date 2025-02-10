const Counter = require("../models/counterModel");

const getNextSequence = async (counterId) => {
  const counter = await Counter.findOneAndUpdate(
    { id: counterId },
    { $inc: { seq: 1 } },
    { new: true, upsert: true } // Create if it doesn't exist
  );
  return counter.seq;
};

module.exports = getNextSequence;
