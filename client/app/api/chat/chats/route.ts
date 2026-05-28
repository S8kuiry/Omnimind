import { NextResponse } from 'next/server'
import dbConnect from '@/lib/mongo'
import Chat from '@/models/Chat'
import Message from '@/models/Message'

export async function GET(req: Request) {
    try {
        const userId = new URL(req.url).searchParams.get('userId')
        if (!userId) return NextResponse.json({ error: 'Missing userId' }, { status: 400 })

        await dbConnect()

        const chats = await Chat.find({ userId })
            .sort({ createdAt: -1 }) // newest first
            .limit(20)
            .lean()

        // Only show chats that actually have messages.
        // This prevents empty "New Chat" rows from appearing on fresh load.
        const withMessages: typeof chats = []
        for (const c of chats) {
            const hasAny = await Message.exists({ chatId: c.chatId, userId })
            if (hasAny) withMessages.push(c)
        }

        return NextResponse.json({ chats: withMessages })

    } catch (error) {
        console.error('[get-chats]', error)
        return NextResponse.json({ error: 'Server error' }, { status: 500 })
    }
}