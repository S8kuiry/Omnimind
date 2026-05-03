import mongoose from 'mongoose'

const MessageSchema = new mongoose.Schema({
    chatId:  { type: String, required: true },
    userId:  { type: String, required: true },
    role:    { type: String, enum: ['user', 'assistant'], required: true },
    content: { type: String, required: true },
    metadata: {
        type: mongoose.Schema.Types.Mixed,
        default: {}
        // user message:      { attachments: [{ name, size }] }
        // assistant message: { sources: [{ source, page }], mode, model, latencyMs }
    }
}, { timestamps: true })

MessageSchema.index({ chatId: 1, createdAt: 1 })

const Message = mongoose.models.Message || mongoose.model('Message', MessageSchema)
export default Message