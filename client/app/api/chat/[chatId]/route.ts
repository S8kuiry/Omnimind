import { NextResponse } from 'next/server'
import dbConnect from '@/lib/mongo'
import Message from '@/models/Message'
import Chat from '@/models/Chat'

export async function GET(
    req: Request,
    { params }: { params: Promise<{ chatId: string }> }
) {
    try {
        const { chatId } = await params  // 👈 await params
        const userId = new URL(req.url).searchParams.get('userId')

        if (!chatId || !userId) {
            return NextResponse.json({ error: 'Missing chatId or userId' }, { status: 400 })
        }

        await dbConnect()

        const chat = await Chat.findOne({ chatId, userId })
        if (!chat) {
            return NextResponse.json({ messages: [], chat: null })
        }

        const messages = await Message.find({ chatId, userId })
            .sort({ createdAt: 1 })
            .lean()

        return NextResponse.json({ messages, chat })

    } catch (error) {
        console.error('[get-chat]', error)
        return NextResponse.json({ error: 'Server error' }, { status: 500 })
    }
}


export async function PATCH(
    req:Request,
    {params}:{params: Promise<{ chatId: string }>}
){
    try {
        const { chatId } = await params
        const body = await req.json()

        await dbConnect()

        const userId = new URL(req.url).searchParams.get('userId') || body.userId
        const set: Record<string, any> = {}
        if (body?.metadata?.pdfNames) set['metadata.pdfNames'] = body.metadata.pdfNames
        if (typeof body?.title === 'string' && body.title.trim()) set['title'] = body.title.trim()

        if (!Object.keys(set).length) {
            return NextResponse.json({ success: true })
        }

        await Chat.findOneAndUpdate(
            userId ? { chatId, userId } : { chatId },
            { $set: set }
        )

        return NextResponse.json({ success: true })

    } catch (error) {
        return NextResponse.json({ error: 'Server error' }, { status: 500 })
    }
}




export async function DELETE(
    req: Request,
    { params }: { params: Promise<{ chatId: string }> }
) {
    try {
        const { chatId } = await params  // 👈 await params
        const userId = new URL(req.url).searchParams.get('userId')

        if (!chatId || !userId) {
            return NextResponse.json({ error: 'Missing fields' }, { status: 400 })
        }

        await dbConnect()
        await Chat.deleteOne({ chatId, userId })
        await Message.deleteMany({ chatId, userId })

        return NextResponse.json({ success: true })

    } catch (error) {
        return NextResponse.json({ error: 'Server error' }, { status: 500 })
    }
}