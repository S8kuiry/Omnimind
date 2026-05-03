import { NextResponse } from 'next/server'
import dbConnect from '@/lib/mongo'
import Chat from '@/models/Chat'

export async function GET(req: Request) {
    try {
        const userId = new URL(req.url).searchParams.get('userId')
        if (!userId) return NextResponse.json({ error: 'Missing userId' }, { status: 400 })

        await dbConnect()

        const chats = await Chat.find({ userId })
            .sort({ createdAt: -1 }) // newest first
            .limit(20)
            .lean()

        return NextResponse.json({ chats })

    } catch (error) {
        console.error('[get-chats]', error)
        return NextResponse.json({ error: 'Server error' }, { status: 500 })
    }
}