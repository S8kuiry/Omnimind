import { NextResponse } from 'next/server'
import dbConnect from '@/lib/mongo'
import Chat from '@/models/Chat'

export async function GET(
    req: Request,
    { params }: { params: Promise<{ chatId: string }> }
) {
    try {
        const { chatId } = await params
        const userId = new URL(req.url).searchParams.get('userId')

        if (!chatId || !userId) {
            return NextResponse.json({ error: 'Missing chatId or userId' }, { status: 400 })
        }

        await dbConnect()

        const chat = await Chat.findOne({ chatId, userId }).select('title').lean()
        if (!chat) {
            return NextResponse.json({ title: '' }, { status: 404 })
        }

        return NextResponse.json({ title: chat.title ?? '' })
    } catch (error) {
        console.error('[get-chat-name]', error)
        return NextResponse.json({ error: 'Server error' }, { status: 500 })
    }
}
