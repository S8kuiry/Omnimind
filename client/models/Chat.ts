import mongoose from 'mongoose'

const ChatSchema = new mongoose.Schema({
    chatId: { type: String, required: true, unique: true },
    userId: { type: String, required: true },
    title:  { type: String, default: 'New Chat' },
    metadata: {
        type: mongoose.Schema.Types.Mixed,
        default: {
            hasPdf: false,
            pdfName: null,
        }
    }
}, { timestamps: true })

ChatSchema.index({ userId: 1, createdAt: -1 })

const Chat = mongoose.models.Chat || mongoose.model('Chat', ChatSchema)
export default Chat