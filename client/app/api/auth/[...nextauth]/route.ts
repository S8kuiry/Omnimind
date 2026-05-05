import dbConnect from "@/lib/mongo";
import User from "@/models/User";
import NextAuth, { DefaultSession } from "next-auth";
import GoogleProvider from "next-auth/providers/google";
import CredentialsProvider from "next-auth/providers/credentials";
import Otp from "@/models/Otp";

declare module "next-auth" {
  interface Session {
    user: { id: string } & DefaultSession["user"]
  }
  interface User { id: string }
}

declare module "next-auth/jwt" {
  interface JWT { sub: string }
}

const handler = NextAuth({
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    }),

    

    CredentialsProvider({
      name: "OTP",
      credentials: {
        email: { label: "Email", type: "email" },
        username: { label: "Username", type: "text" },
        otp: { label: "OTP", type: "text" },
      },
      async authorize(credentials) {
        await dbConnect();

        const { email, username, otp } = credentials!;

        // check existing user 
        const existingUser = await User.findOne({ email });    
        if (existingUser) {
          // If the user exists but used a different method (email/otp)
          if (existingUser.method === "google") {
            throw new Error("ALREADY_EXISTS_WITH_GOOGLE");
          }
        }

        // 1. Verify OTP
        const otpRecord = await Otp.findOne({ email }).sort({ createdAt: -1 });
        if (!otpRecord || otpRecord.otp !== otp) return null;

        // 2. Find or create user
        let user = await User.findOne({ email });
        if (!user) {
          user = await User.create({ name: username, email, method: "email" });
        }

        // 3. Delete used OTP
        await Otp.deleteOne({ _id: otpRecord._id });

        return { id: user._id.toString(), name: user.name, email: user.email };
      }
    })
  ],


  session: {
    strategy: "jwt",
    maxAge: 183  * 24 * 60 * 60, // 30 days
  },

  jwt: {
    maxAge: 183  * 24 * 60 * 60, // 30 days
  },

  cookies: {
    sessionToken: {
      name: process.env.NODE_ENV === 'production' 
        ? '__Secure-next-auth.session-token' 
        : 'next-auth.session-token',
      options: {
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
        secure: process.env.NODE_ENV === 'production',
      }
    }
  },

  callbacks: {
    async redirect({ url, baseUrl }) {
      // after sign in always go to dashboard
      if (url.startsWith(baseUrl)) return `${baseUrl}/dashboard`
      return `${baseUrl}/dashboard`
  },


    async signIn({ user, account }) {
      if (account?.provider === "google") {
        await dbConnect();
        
        const existingUser = await User.findOne({ email: user.email });
    
        if (existingUser) {
          // user exists — just check method and attach ID, never try to create
          if (existingUser.method === "email") {
            return '/?error=ALREADY_EXISTS_WITH_EMAIL'
          }
          user.id = existingUser._id.toString();
          return true; // ← stops here, never reaches creation code
        }
    
        // only reaches here if user truly doesn't exist yet
        try {
          const newUser = await User.create({ 
            name: user.name, 
            email: user.email, 
            method: "google" 
          });
          user.id = newUser._id.toString();
          return true;
        } catch (error) {
          console.error("Creation error:", error);
          return false;
        }
      }
      return true;
    },
    async jwt({ token, user }) {
      if (user) token.sub = user.id;
      return token;
    },

    async session({ session, token }) {
      if (session.user && token.sub) session.user.id = token.sub;
      return session;
    },
  },

  pages: { signIn: '/dashboard',error: '/' }
});

export { handler as GET, handler as POST };