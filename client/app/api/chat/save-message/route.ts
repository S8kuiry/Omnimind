import { NextResponse } from 'next/server'
import dbConnect from '@/lib/mongo'
import Chat from '@/models/Chat'
import Message from '@/models/Message'

export async function POST(req: Request) {
    try {
        const {
            chatId,
            userId,
            role,
            content,
            title,
            metadata = {}  // { sources, mode, model, latencyMs } for assistant
                           // { attachments } for user
        } = await req.json()

        if (!chatId || !userId || !role || !content) {
            return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
        }

        await dbConnect()

        // upsert chat — creates on first message, updates title/pdf info after
        // title must not appear in both $set and $setOnInsert (MongoDB code 40 conflict)
        await Chat.findOneAndUpdate(
            { chatId },
            {
                $set: {
                    userId,
                    ...(title && { title }),
                    ...(metadata.pdfName && {
                        'metadata.hasPdf': true,
                        'metadata.pdfName': metadata.pdfName,
                    }),
                },
                $setOnInsert: {
                    chatId,
                    ...(!title && { title: 'New Chat' }),
                },
            },
            { upsert: true, returnDocument: 'after' }
        )

        // save the message with its metadata
        await Message.create({ chatId, userId, role, content, metadata })

        return NextResponse.json({ success: true })

    } catch (error) {
        console.error('[save-message]', error)
        const err = error as Error & { codeName?: string }
        const isConnection =
            err.name === 'MongooseServerSelectionError' ||
            err.message?.includes('whitelist') ||
            err.message?.includes('ECONNREFUSED') ||
            err.message?.includes('ENOTFOUND')
        const msg = isConnection
            ? 'Database unavailable — check MongoDB Atlas connection and Network Access'
            : err.codeName === 'ConflictingUpdateOperators'
              ? 'Could not save chat metadata'
              : 'Server error'
        return NextResponse.json({ error: msg }, { status: 500 })
    }
}