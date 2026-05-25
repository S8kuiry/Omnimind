import { NextResponse } from 'next/server'
import dbConnect from '@/lib/mongo'
import Chat from '@/models/Chat'

export async function POST(req: Request) {
  try {
    const { chatId, userId, title = 'New Chat' } = await req.json()

    if (!chatId || !userId) {
      return NextResponse.json({ error: 'Missing chatId or userId' }, { status: 400 })
    }

    await dbConnect()

    await Chat.findOneAndUpdate(
      { chatId },
      { $set: { userId, title }, $setOnInsert: { chatId } },
      { upsert: true, new: true },
    )

    return NextResponse.json({ success: true, chatId, title })
  } catch (error) {
    console.error('[create-chat]', error)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
