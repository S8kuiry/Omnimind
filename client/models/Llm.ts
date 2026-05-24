import mongoose from 'mongoose'

const llmSchema = new mongoose.Schema({
  userId: { type: String, required: true },
  model: { type: String, required: true },
  usage: { type: Number, default: 0 }, // Stores total count of requests
}, { 
  timestamps: true // Automatically handles createdAt and updatedAt for you!
})

// CRITICAL: This ensures a user can only have ONE document per unique model. 
// Instead of creating new rows, we will just increment the usage number.
llmSchema.index({ userId: 1, model: 1 }, { unique: true })

const Llm = mongoose.models.Llm || mongoose.model('Llm', llmSchema)
export default Llm