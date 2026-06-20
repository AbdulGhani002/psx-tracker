import { Schema, model, models, type InferSchemaType, type Model } from "mongoose";

// A subscriber account. Email is the unique login id. Passwords are scrypt
// hashes. Verification + reset use short-lived tokens. Plan gates Pro features.
const UserSchema = new Schema(
  {
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true },
    name: { type: String, default: "" },
    emailVerified: { type: Boolean, default: false },
    verifyToken: { type: String, default: "" },
    verifyTokenExp: { type: Date, default: null },
    resetToken: { type: String, default: "" },
    resetTokenExp: { type: Date, default: null },
    plan: { type: String, default: "free" }, // "free" | "pro" | "wealth"
    lastLoginAt: { type: Date, default: null },
  },
  { timestamps: true }
);

export type User = InferSchemaType<typeof UserSchema> & { _id: string };

export const UserModel: Model<User> =
  (models.User as Model<User>) || model<User>("User", UserSchema);
