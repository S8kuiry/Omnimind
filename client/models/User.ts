import mongoose from 'mongoose';

const UserSchema = new mongoose.Schema({
    name: { type: String, required: true },
    email: { type: String, required: true }, // ← remove unique: true here
    method: { 
        type: String, 
        required: true, 
        enum: ["google", "email"],
    },
}, { timestamps: true })

// only this compound index — same email can exist with different methods
UserSchema.index({ email: 1, method: 1 }, { unique: true });

const User = mongoose.models.User || mongoose.model('User', UserSchema);
export default User