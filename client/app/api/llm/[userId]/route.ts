import { NextResponse } from 'next/server'
import dbConnect from '@/lib/mongo'
import Llm from '@/models/Llm'

export async function POST(
    req: Request,
    { params }: { params: Promise<{ userId: string }> }
) {
    try {
        await dbConnect()
        const { userId } = await params
        // Get the model string sent from your frontend drop-down
        const { model } = await req.json()
        if (!model) {
            return NextResponse.json({ error: 'Model identifier missing' }, { status: 400 })
        }

        // Atomically increment model request counter by +1
        const updatedRecord = await Llm.findOneAndUpdate(
            {userId,model},
            {$inc:{usage:1}},
            { upsert: true, new: true }

        )
        return NextResponse.json({ success: true, data: updatedRecord })


    } catch (error) {
        console.error('[llm-usage]', error)
        return NextResponse.json({ error: 'Server error' }, { status: 500 })
    }
}

// ── FETCH USAGES FOR DASHBOARD STATS (GET) ──
export async function GET(
    req: Request,
    { params }: { params: Promise<{ userId: string }> }
  ) {
    try {
      await dbConnect()
      const { userId } = await params
  
     
      // Find all model stats for this particular user
      const stats = await Llm.find({ userId }).sort({ usage: -1 })
      return NextResponse.json({ success: true, stats })
    } catch (error: any) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
  }