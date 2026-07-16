import bcrypt from "bcrypt";
import User from "../models/User.js";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { AppError } from "../utils/AppError.js";

export const listUsers = asyncHandler(async (_req, res) => {
  const users = await User.find().sort({ name: 1 });
  res.json({ data: users });
});

export const createUser = asyncHandler(async (req, res) => {
  const { name, email, password, role, area, active } = req.body;
  if (!name || !email || !password || !role) {
    throw new AppError(400, "Name, email, password, and role are required.");
  }
  const existing = await User.findOne({ email: String(email).toLowerCase() });
  if (existing) throw new AppError(409, "A user with this email already exists.");

  const user = await User.create({
    name,
    email,
    role,
    area,
    active,
    passwordHash: await bcrypt.hash(password, 10)
  });
  res.status(201).json({ data: user });
});

export const updateUser = asyncHandler(async (req, res) => {
  const payload = { ...req.body };
  if (payload.password) {
    payload.passwordHash = await bcrypt.hash(payload.password, 10);
    delete payload.password;
  }

  const user = await User.findByIdAndUpdate(req.params.id, payload, {
    new: true,
    runValidators: true
  });
  if (!user) throw new AppError(404, "User not found.");
  res.json({ data: user });
});

export const deleteUser = asyncHandler(async (req, res) => {
  const user = await User.findByIdAndUpdate(req.params.id, { active: false }, { new: true });
  if (!user) throw new AppError(404, "User not found.");
  res.json({ data: user });
});
