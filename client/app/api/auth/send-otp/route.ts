import { NextResponse } from "next/server";
import dbConnect from "@/lib/mongo";
import Otp from "@/models/Otp";
import nodemailer from "nodemailer";
import User from "@/models/User";


export async function POST(req: Request) {

    try {
        const { email } = await req.json();
        await dbConnect();

        const existingUser = await User.findOne({ email });
if (existingUser && existingUser.method === "google") {
    return NextResponse.json({ error: "This email is already registered with Google" }, { status: 400 });
}

        // 1. Generate 6-digit OTP
        const otp = Math.floor(100000 + Math.random() * 900000).toString();

        // 2. Save to DB (overwrite if email already exists)

        await Otp.findOneAndUpdate(
            { email },
            { otp, createdAt: new Date() },
            { upsert: true }
        );


        // 3. Configure Nodemailer (Use Gmail App Password)
        const transporter = nodemailer.createTransport({
            service: "gmail",
            auth: {
                user: process.env.EMAIL_USER,
                pass: process.env.EMAIL_PASS, // This is an "App Password," not your login pass
            },
        });

        // 4. Send the Email
        await transporter.sendMail({
            from: '"OmniMind" <noreply@omnimind.com>',
            to: email,
            subject: "Your Verification Code",
            text: `Your OTP is ${otp}. It expires in 5 minutes.`,
            html: `<b>Your OTP is ${otp}</b><p>It expires in 5 minutes.</p>`,
        });

        return NextResponse.json({ message: `OTP sent successfully to ${email}` }, { status: 200 });


    } catch (error) {

        console.error(error);
        return NextResponse.json({ error: "Failed to send OTP" }, { status: 500 });

    }

}